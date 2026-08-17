'use strict';

/**
 * Persistenz fuer Tagwerk.
 *
 * Bewusst eine einzige JSON-Datei statt SQLite:
 *  - keine nativen Abhaengigkeiten (kein Rebuild bei Electron-Updates)
 *  - die Datei laesst sich im Zweifel mit dem Editor reparieren
 *  - fuer ein paar tausend Aufgaben pro Jahr voellig ausreichend
 *
 * Geschrieben wird gebuendelt (Debounce) und atomar (tmp + rename), damit ein
 * Absturz mitten im Schreiben die Daten nicht zerstoert. Zusaetzlich liegt
 * immer die letzte gute Fassung als .bak daneben.
 */

const fs = require('fs');
const path = require('path');

const CURRENT_VERSION = 1;
const SAVE_DEBOUNCE_MS = 400;

function emptyData() {
  return { version: CURRENT_VERSION, items: [] };
}

function newId() {
  return 'itm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function nowIso() {
  return new Date().toISOString();
}

class Store {
  /** @param {string} filePath Pfad zur JSON-Datei */
  constructor(filePath) {
    this.filePath = filePath;
    this.backupPath = filePath + '.bak';
    this.tmpPath = filePath + '.tmp';
    this.data = emptyData();
    this._timer = null;
    this._listeners = new Set();
  }

  // ---------------------------------------------------------------- Laden

  load() {
    const fromMain = this._readFile(this.filePath);
    if (fromMain) {
      this.data = migrate(fromMain);
      return this;
    }

    const fromBackup = this._readFile(this.backupPath);
    if (fromBackup) {
      console.warn('[store] Hauptdatei defekt oder fehlend - Backup wird verwendet.');
      this.data = migrate(fromBackup);
      this._saveNow();
      return this;
    }

    this.data = emptyData();
    return this;
  }

  _readFile(p) {
    try {
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, 'utf8');
      if (!raw.trim()) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch (err) {
      console.error(`[store] ${p} konnte nicht gelesen werden:`, err.message);
      return null;
    }
  }

  // -------------------------------------------------------------- Speichern

  /** Aenderung vormerken; das eigentliche Schreiben passiert gebuendelt. */
  _touch() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._saveNow(), SAVE_DEBOUNCE_MS);
    for (const fn of this._listeners) fn(this.data);
  }

  /** Sofort schreiben (z.B. beim Beenden). */
  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._saveNow();
  }

  _saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const json = JSON.stringify(this.data, null, 2);

      fs.writeFileSync(this.tmpPath, json, 'utf8');
      // Vorherige Fassung sichern, bevor sie ueberschrieben wird
      if (fs.existsSync(this.filePath)) {
        try {
          fs.copyFileSync(this.filePath, this.backupPath);
        } catch (err) {
          console.warn('[store] Backup fehlgeschlagen:', err.message);
        }
      }
      fs.renameSync(this.tmpPath, this.filePath);
    } catch (err) {
      console.error('[store] Speichern fehlgeschlagen:', err.message);
    }
  }

  /** Wird nach jeder Aenderung aufgerufen (fuer das Broadcast an die Fenster). */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  // ------------------------------------------------------------------ API

  snapshot() {
    return { version: this.data.version, items: this.data.items };
  }

  find(id) {
    return this.data.items.find((i) => i.id === id) || null;
  }

  /** Neue Aufgabe anlegen. Erwartet bereits geparste Felder. */
  add(input) {
    const ts = nowIso();
    const item = normalize(
      {
        id: newId(),
        createdAt: ts,
        updatedAt: ts,
        doneAt: null,
        ...input,
      },
      ts
    );
    if (!item.title) return null;
    this.data.items.push(item);
    this._touch();
    return item;
  }

  /** Vorhandene Aufgabe aendern. */
  update(id, patch) {
    const item = this.find(id);
    if (!item) return null;

    const next = { ...item, ...patch, id: item.id, createdAt: item.createdAt };

    // doneAt automatisch mitfuehren
    if (patch.status && patch.status !== item.status) {
      next.doneAt = patch.status === 'erledigt' ? nowIso() : null;
    }
    next.updatedAt = nowIso();

    const clean = normalize(next, item.createdAt);
    Object.assign(item, clean);
    this._touch();
    return item;
  }

  /** Loeschen. Gibt das geloeschte Item zurueck, damit die UI ein Undo anbieten kann. */
  remove(id) {
    const idx = this.data.items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const [removed] = this.data.items.splice(idx, 1);
    this._touch();
    return removed;
  }

  /** Zuvor geloeschte Items zurueckholen (Undo). */
  restore(items) {
    const list = Array.isArray(items) ? items : [items];
    let count = 0;
    for (const raw of list) {
      if (!raw || !raw.id || this.find(raw.id)) continue;
      this.data.items.push(normalize(raw, raw.createdAt || nowIso()));
      count++;
    }
    if (count) this._touch();
    return count;
  }

  /** Mehrere Aufgaben auf einen anderen Tag schieben. */
  moveToDay(ids, day) {
    let count = 0;
    for (const id of ids) {
      const item = this.find(id);
      if (!item || item.day === day) continue;
      item.day = day;
      item.updatedAt = nowIso();
      count++;
    }
    if (count) this._touch();
    return count;
  }

  /** Alle erledigten Aufgaben eines Tages entfernen. */
  clearDone(day) {
    const before = this.data.items.length;
    const removed = this.data.items.filter((i) => i.status === 'erledigt' && (!day || i.day === day));
    this.data.items = this.data.items.filter((i) => !removed.includes(i));
    if (this.data.items.length !== before) this._touch();
    return removed;
  }

  /** Kompletten Datensatz ersetzen (Import). */
  replaceAll(items) {
    this.data.items = items.map((i) => normalize(i, i.createdAt || nowIso())).filter((i) => i.title);
    this._touch();
    return this.data.items.length;
  }

  /** Items aus einem Import ergaenzen, vorhandene IDs ueberspringen. */
  merge(items) {
    let added = 0;
    for (const raw of items) {
      if (!raw || !raw.title) continue;
      const id = raw.id && !this.find(raw.id) ? raw.id : newId();
      this.data.items.push(normalize({ ...raw, id }, raw.createdAt || nowIso()));
      added++;
    }
    if (added) this._touch();
    return added;
  }
}

/** Fehlende/kaputte Felder auffuellen, damit die UI sich auf das Schema verlassen kann. */
function normalize(item, fallbackTs) {
  const ts = fallbackTs || nowIso();
  const priority = Number(item.priority);
  return {
    id: String(item.id || newId()),
    title: String(item.title || '').trim(),
    notes: String(item.notes || ''),
    source: String(item.source || 'sonstiges'),
    status: String(item.status || 'offen'),
    priority: Number.isFinite(priority) ? Math.max(0, Math.min(2, Math.round(priority))) : 0,
    ref: item.ref ? String(item.ref) : null,
    tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
    day: /^\d{4}-\d{2}-\d{2}$/.test(item.day || '') ? item.day : ts.slice(0, 10),
    createdAt: item.createdAt || ts,
    updatedAt: item.updatedAt || ts,
    doneAt: item.status === 'erledigt' ? item.doneAt || ts : null,
  };
}

/** Platzhalter fuer spaetere Schema-Aenderungen. */
function migrate(data) {
  const out = { version: CURRENT_VERSION, items: [] };
  const version = Number(data.version) || 0;

  if (version > CURRENT_VERSION) {
    console.warn('[store] Datei stammt aus einer neueren Version - wird unveraendert uebernommen.');
  }

  out.items = (data.items || []).map((i) => normalize(i, i.createdAt)).filter((i) => i.title);
  return out;
}

module.exports = { Store, CURRENT_VERSION, newId, normalize };
