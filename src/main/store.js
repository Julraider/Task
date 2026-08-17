'use strict';

/**
 * Persistenz fuer Tagwerk.
 *
 * Bewusst eine einzige JSON-Datei statt SQLite:
 *  - keine nativen Abhaengigkeiten (kein Rebuild bei Electron-Updates)
 *  - die Datei laesst sich im Zweifel mit dem Editor reparieren
 *  - fuer ein paar tausend Aufgaben pro Jahr voellig ausreichend
 *
 * Geschrieben wird gebuendelt (Debounce) und atomar: erst in die .tmp-Datei,
 * dann fsync, dann umbenennen. Das fsync ist der Punkt, an dem sich "atomar"
 * entscheidet - ohne steht nach einem Stromausfall zwar der richtige Dateiname
 * da, moeglicherweise aber mit leerem Inhalt.
 *
 * Sicherungen liegen im Unterordner 'backups':
 *   tag-JJJJ-MM-TT.json        taeglich beim Start, die letzten N Tage
 *   sicherung-<zeit>-<grund>   vor riskanten Aktionen (Import, Aufraeumen)
 *   konflikt-/defekt-<zeit>    weggesicherte Fremd- oder Schrottfassungen
 * Aufgeraeumt wird dort nur nach Alter bzw. Anzahl - eine Sicherung, die der
 * einzige Traeger eines Standes sein koennte, wird nie geloescht.
 */

const fs = require('fs');
const path = require('path');

const Dates = require('../shared/dates');
const Model = require('../shared/model');

const CURRENT_VERSION = 1;
const SAVE_DEBOUNCE_MS = 400;
const DEFAULT_KEEP_DAILY = 14;

/** Wie viele Dateien je Sicherungsart aufgehoben werden. */
const KEEP_OTHER = { sicherung: 12, konflikt: 8, defekt: 8, 'nicht-gespeichert': 8 };

const STATUS_IDS = new Set(Model.STATUSES.map((s) => s.id));
const SOURCE_IDS = new Set(Model.SOURCES.map((s) => s.id));
const KNOWN_FIELDS = new Set([
  'id', 'title', 'notes', 'source', 'status', 'priority',
  'ref', 'tags', 'day', 'createdAt', 'updatedAt', 'doneAt',
]);

function emptyData() {
  return { version: CURRENT_VERSION, items: [] };
}

function newId() {
  return 'itm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function nowIso() {
  return new Date().toISOString();
}

/** '2026-08-17T09-14-02' in lokaler Zeit - sortierbar und als Dateiname erlaubt. */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${Dates.keyOf(d)}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Schreibt und wartet, bis die Daten wirklich auf dem Datentraeger stehen. */
function writeDurable(file, text) {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Nach dem Umbenennen zusaetzlich das Verzeichnis synchronisieren, sonst kann
 * der neue Name bei einem Stromausfall wieder verschwinden. Unter Windows
 * lassen sich Verzeichnisse nicht oeffnen - dort entfaellt der Schritt.
 */
function fsyncDir(dir) {
  let fd = null;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    /* nicht moeglich (Windows, Netzlaufwerk) - kein Beinbruch */
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* egal */
      }
    }
  }
}

/** Technische Fehlercodes in einen Satz uebersetzen, den man dem Nutzer zeigen kann. */
function describeFsError(err) {
  switch (err && err.code) {
    case 'EACCES':
    case 'EPERM':
      return 'Keine Schreibrechte für die Datei.';
    case 'EROFS':
      return 'Der Datenträger ist schreibgeschützt.';
    case 'ENOSPC':
      return 'Kein Platz mehr auf dem Datenträger.';
    case 'EDQUOT':
      return 'Das Speicherkontingent ist erschöpft.';
    case 'EBUSY':
    case 'ETXTBSY':
      return 'Die Datei ist von einem anderen Programm gesperrt.';
    case 'ENOENT':
      return 'Der Datenordner ist nicht erreichbar.';
    case 'EIO':
      return 'Der Datenträger meldet einen Lesefehler.';
    default:
      return (err && err.message) || String(err);
  }
}

class Store {
  /**
   * @param {string} filePath Pfad zur JSON-Datei
   * @param {{keepDaily?: number, autoBackup?: boolean}} [options]
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.backupPath = filePath + '.bak';
    this.tmpPath = filePath + '.tmp';
    this.backupDir = path.join(path.dirname(filePath), 'backups');

    this.keepDaily = clampKeep(options.keepDaily);
    this.autoBackup = options.autoBackup !== false;

    this.data = emptyData();
    this._timer = null;
    this._listeners = new Set();
    this._statusListeners = new Set();

    this._dirty = false;
    this._lastWrite = null; // Stat der zuletzt von uns geschriebenen Datei
    this._mainTrusted = false; // Hauptdatei enthaelt einen Stand, den wir kennen
    this._rescueFile = null; // Ablage, wenn regulaeres Speichern gesperrt ist
    this._problems = new Map();
    this._state = {
      loadedFrom: 'leer',
      readOnly: false,
      readOnlyReason: null,
      lastSaveAt: null,
      lastError: null,
    };
  }

  // ---------------------------------------------------------------- Laden

  load() {
    const main = this._read(this.filePath);
    if (main.data) {
      this._adopt(main.data, 'datei');
      this._mainTrusted = true;
      this._lastWrite = this._statOf(this.filePath);
      this._afterLoad();
      return this;
    }

    if (main.io) {
      // Die Datei ist da, laesst sich aber nicht lesen (Rechte, Sperre, Laufwerk
      // weg). Anfassen waere jetzt das Schlimmste: der Inhalt kann intakt sein.
      this._state.readOnly = true;
      this._state.readOnlyReason = `Die Datendatei ließ sich nicht lesen (${main.error}). Änderungen werden nur im Ordner „backups" abgelegt.`;
      this._problem('lesefehler', 'error', this._state.readOnlyReason);
    } else if (main.exists) {
      // Vorhanden, aber inhaltlich Schrott: wegsichern statt ueberschreiben -
      // die Datei ist die einzige Spur, falls doch noch etwas darin steckt
      // (halber Schreibvorgang, fremdes Werkzeug, Virenscanner).
      const kept = this._quarantine(this.filePath, 'defekt');
      this._problem(
        'defekt',
        'error',
        `Die Datendatei war unbrauchbar (${main.error || 'unbekannt'})` +
          (kept ? `. Sie liegt jetzt als „${kept}" im Ordner „backups".` : '.')
      );
    }

    const fallback = this._loadFallback();
    if (fallback) {
      this._adopt(fallback.data, fallback.from);
      this._problem('wiederhergestellt', 'warn', fallback.message);
      if (!this._state.readOnly) {
        this._dirty = true;
        this._saveNow();
      }
      this._afterLoad();
      return this;
    }

    this._adopt(emptyData(), 'leer');
    this._afterLoad();
    return this;
  }

  /** Reihenfolge der Rettungsanker: .bak zuerst, dann die neueste Tagessicherung. */
  _loadFallback() {
    const bak = this._read(this.backupPath);
    if (bak.data) {
      console.warn('[store] Hauptdatei defekt oder fehlend - .bak wird verwendet.');
      return {
        data: bak.data,
        from: 'backup',
        message: 'Die Aufgaben wurden aus der Sicherungsdatei (.bak) wiederhergestellt.',
      };
    }

    for (const entry of this.backups()) {
      if (!entry.readable) continue;
      const read = this._read(path.join(this.backupDir, entry.name));
      if (!read.data) continue;
      console.warn('[store] Weder Hauptdatei noch .bak lesbar - nutze', entry.name);
      return {
        data: read.data,
        from: 'sicherung',
        message: `Die Aufgaben stammen aus der Sicherung „${entry.name}".`,
      };
    }
    return null;
  }

  /**
   * Eine unbrauchbare oder fremde Fassung in den Sicherungsordner schieben.
   * @param {boolean} [copyOnly] true = Original bleibt liegen (es wird gleich ersetzt)
   */
  _quarantine(file, kind, copyOnly) {
    const target = path.join(this.backupDir, `${kind}-${stamp()}.json`);
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      if (copyOnly) {
        fs.copyFileSync(file, target);
      } else {
        try {
          fs.renameSync(file, target);
        } catch {
          fs.copyFileSync(file, target);
          fs.unlinkSync(file);
        }
      }
      this._prune();
      return path.basename(target);
    } catch (err) {
      console.warn('[store] Wegsichern fehlgeschlagen:', err.message);
      return null;
    }
  }

  /** Geladene Rohdaten uebernehmen und dabei pruefen, ob wir sie ueberhaupt schreiben duerfen. */
  _adopt(raw, from) {
    const version = Number(raw && raw.version) || 0;
    this.data = migrate(raw);
    this._state.loadedFrom = from;

    if (version > CURRENT_VERSION) {
      // Schreiben wuerde die Datei auf unser aelteres Schema eindampfen -
      // also lieber gar nicht anfassen und den Nutzer warnen.
      this._state.readOnly = true;
      this._state.readOnlyReason = `Die Datei stammt aus einer neueren Version (${version}). Änderungen werden nicht in die Datendatei geschrieben.`;
      this._problem('neuere-version', 'error', this._state.readOnlyReason);
    }
  }

  _afterLoad() {
    if (!this.autoBackup) return;
    try {
      this.backupDaily();
    } catch (err) {
      console.warn('[store] Tagessicherung fehlgeschlagen:', err.message);
    }
  }

  /**
   * `io` unterscheidet den Fall "Datei nicht lesbar" (Rechte, Sperre) von
   * "Inhalt unbrauchbar" - nur beim zweiten darf die Datei angefasst werden.
   * @returns {{exists: boolean, io: boolean, data: object|null, error: string|null}}
   */
  _read(p) {
    let raw;
    try {
      raw = fs.readFileSync(p, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { exists: false, io: false, data: null, error: null };
      console.error(`[store] ${p} konnte nicht gelesen werden:`, err.message);
      return { exists: true, io: true, data: null, error: describeFsError(err) };
    }

    const fail = (error) => ({ exists: true, io: false, data: null, error });
    if (!raw.trim()) return fail('die Datei ist leer');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail('kein gültiges JSON');
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
      return fail('kein Tagwerk-Datensatz');
    }
    return { exists: true, io: false, data: parsed, error: null };
  }

  _statOf(p) {
    try {
      const st = fs.statSync(p);
      return { size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------- Speichern

  /** Aenderung vormerken; das eigentliche Schreiben passiert gebuendelt. */
  _touch() {
    this._dirty = true;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._saveNow(), SAVE_DEBOUNCE_MS);
    if (typeof this._timer.unref === 'function') this._timer.unref();
    for (const fn of this._listeners) fn(this.data);
  }

  /** Sofort schreiben (z.B. beim Beenden). Gibt zurueck, ob es geklappt hat. */
  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    return this._saveNow();
  }

  _saveNow() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._dirty && this._lastWrite) return true;
    if (this._state.readOnly) return this._rescue();

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const json = JSON.stringify(this.data, null, 2);

      this._checkForeignWrite();
      writeDurable(this.tmpPath, json);
      this._rotateBak();
      fs.renameSync(this.tmpPath, this.filePath);
      fsyncDir(path.dirname(this.filePath));

      this._dirty = false;
      this._mainTrusted = true;
      this._lastWrite = this._statOf(this.filePath);
      this._state.lastSaveAt = nowIso();
      if (this._state.lastError) {
        this._state.lastError = null;
        this._problems.delete('schreibfehler');
        this._emitStatus();
      }
      return true;
    } catch (err) {
      this._cleanupTmp();
      console.error('[store] Speichern fehlgeschlagen:', err.message);
      this._state.lastError = { message: describeFsError(err), code: err.code || null, at: nowIso() };
      this._problem(
        'schreibfehler',
        'error',
        `Die Daten konnten nicht gespeichert werden: ${describeFsError(err)} Die Eingaben von heute stehen noch im Fenster – bitte exportieren, bevor Tagwerk beendet wird.`
      );
      this._rescue();
      return false;
    }
  }

  /**
   * Die vorherige Fassung als .bak sichern - aber nur, wenn wir wissen, dass
   * sie in Ordnung ist. Sonst wuerde eine kaputte Hauptdatei die letzte gute
   * Sicherung ueberschreiben.
   */
  _rotateBak() {
    if (!this._mainTrusted) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      fs.copyFileSync(this.filePath, this.backupPath);
    } catch (err) {
      console.warn('[store] Backup fehlgeschlagen:', err.message);
    }
  }

  /**
   * Hat jemand anderes die Datei angefasst (zweite Instanz, Cloud-Ordner,
   * Editor)? Dann erst deren Fassung wegsichern - unser Schreibvorgang wuerde
   * sie sonst spurlos ueberbuegeln.
   */
  _checkForeignWrite() {
    if (!this._lastWrite) return;
    const now = this._statOf(this.filePath);
    if (!now) return;
    if (now.size === this._lastWrite.size && now.mtimeMs === this._lastWrite.mtimeMs) return;

    const kept = this._quarantine(this.filePath, 'konflikt', true);
    this._mainTrusted = false; // fremder Inhalt darf nicht ins .bak
    this._problem(
      'fremdaenderung',
      'warn',
      'Die Datendatei wurde von außerhalb geändert' +
        (kept ? `. Diese Fassung liegt als ${kept} im Ordner „backups".` : '.')
    );
  }

  _cleanupTmp() {
    try {
      if (fs.existsSync(this.tmpPath)) fs.unlinkSync(this.tmpPath);
    } catch {
      /* dann bleibt die .tmp eben liegen, sie stoert niemanden */
    }
  }

  /**
   * Notausgang: wenn die Hauptdatei nicht geschrieben werden darf oder kann,
   * landet der Stand wenigstens im Sicherungsordner. Besser eine Datei zu viel
   * als ein verlorener Arbeitstag.
   */
  _rescue() {
    if (!this._dirty) return false;
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      if (!this._rescueFile) this._rescueFile = path.join(this.backupDir, `nicht-gespeichert-${stamp()}.json`);
      writeDurable(this._rescueFile, JSON.stringify(this.data, null, 2));
      this._problem(
        'notablage',
        'warn',
        `Die Änderungen liegen als „${path.basename(this._rescueFile)}" im Ordner „backups".`
      );
      return false;
    } catch (err) {
      console.error('[store] Auch die Notablage schlug fehl:', err.message);
      return false;
    }
  }

  // ------------------------------------------------------------ Sicherungen

  /** Einmal pro Tag beim Start; aeltere Tagessicherungen fallen weg. */
  backupDaily() {
    if (!this.data.items.length) return null;
    const name = `tag-${Dates.todayKey()}.json`;
    const file = path.join(this.backupDir, name);
    if (fs.existsSync(file)) return null;

    fs.mkdirSync(this.backupDir, { recursive: true });
    writeDurable(file, JSON.stringify(this.data, null, 2));
    this._prune();
    return name;
  }

  /**
   * Sicherung auf Zuruf - vor Import, vor dem Aufraeumen oder weil der Nutzer
   * es so will.
   * @param {string} [reason] kurzes Kennwort, taucht im Dateinamen auf
   */
  createBackup(reason) {
    const tag = String(reason || 'manuell')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'manuell';
    const name = `sicherung-${stamp()}-${tag}.json`;
    const file = path.join(this.backupDir, name);
    fs.mkdirSync(this.backupDir, { recursive: true });
    writeDurable(file, JSON.stringify(this.data, null, 2));
    this._prune();
    return { name, file };
  }

  /** Vorhandene Sicherungen, neueste zuerst. */
  backups() {
    let names;
    try {
      names = fs.readdirSync(this.backupDir);
    } catch {
      return [];
    }

    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(this.backupDir, name);
      const st = this._statOf(file);
      if (!st) continue;
      const read = this._read(file);
      out.push({
        name,
        kind: name.split('-')[0],
        size: st.size,
        modifiedAt: new Date(st.mtimeMs).toISOString(),
        count: read.data ? read.data.items.length : null,
        readable: !!read.data,
      });
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  /**
   * Eine Sicherung zurueckholen. Der aktuelle Stand wird vorher weggeschrieben,
   * damit auch dieser Schritt umkehrbar bleibt.
   */
  restoreBackup(name) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+\.json$/.test(name)) {
      return { ok: false, error: 'Ungültiger Name der Sicherung.' };
    }
    const file = path.join(this.backupDir, name);
    if (path.dirname(path.resolve(file)) !== path.resolve(this.backupDir)) {
      return { ok: false, error: 'Ungültiger Name der Sicherung.' };
    }

    const read = this._read(file);
    if (!read.data) return { ok: false, error: `Die Sicherung ist nicht lesbar (${read.error || 'unbekannt'}).` };

    if (this.data.items.length) this.createBackup('vor-wiederherstellung');
    const migrated = migrate(read.data);
    this.data.items = migrated.items;
    this._touch();
    return { ok: true, count: migrated.items.length };
  }

  /** Alte Dateien nach Alter (Tagessicherung) bzw. Anzahl (Rest) entfernen. */
  _prune() {
    let names;
    try {
      names = fs.readdirSync(this.backupDir);
    } catch {
      return;
    }

    const groups = new Map();
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const kind = name.startsWith('tag-') ? 'tag' : name.split('-')[0];
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(name);
    }

    for (const [kind, list] of groups) {
      const keep = kind === 'tag' ? this.keepDaily : KEEP_OTHER[kind];
      if (!keep || list.length <= keep) continue;
      list.sort((a, b) => b.localeCompare(a)); // Zeitstempel im Namen sortiert richtig
      for (const name of list.slice(keep)) {
        try {
          fs.unlinkSync(path.join(this.backupDir, name));
        } catch {
          /* Datei gesperrt - beim naechsten Mal wieder */
        }
      }
    }
  }

  setKeepDaily(days) {
    this.keepDaily = clampKeep(days);
    return this.keepDaily;
  }

  // -------------------------------------------------------------- Meldungen

  /** Wird nach jeder Aenderung aufgerufen (fuer das Broadcast an die Fenster). */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Zustandsmeldungen: defekte Datei, fehlende Rechte, Notablage. */
  onStatus(fn) {
    this._statusListeners.add(fn);
    return () => this._statusListeners.delete(fn);
  }

  _problem(code, level, message) {
    const before = this._problems.get(code);
    this._problems.set(code, {
      code,
      level,
      message,
      at: nowIso(),
      count: before ? before.count + 1 : 1,
    });
    if (level === 'error') console.error(`[store] ${message}`);
    this._emitStatus();
  }

  /** Meldung wegklicken (der Nutzer hat sie gesehen). */
  dismissProblem(code) {
    const had = this._problems.delete(code);
    if (had) this._emitStatus();
    return had;
  }

  _emitStatus() {
    const snapshot = this.status();
    for (const fn of this._statusListeners) fn(snapshot);
  }

  status() {
    return {
      dataPath: this.filePath,
      backupDir: this.backupDir,
      loadedFrom: this._state.loadedFrom,
      readOnly: this._state.readOnly,
      readOnlyReason: this._state.readOnlyReason,
      lastSaveAt: this._state.lastSaveAt,
      lastError: this._state.lastError,
      pendingChanges: this._dirty,
      rescueFile: this._rescueFile,
      keepDaily: this.keepDaily,
      problems: [...this._problems.values()],
    };
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
    if (!input || typeof input !== 'object') return null;
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
    this._apply(item, patch);
    this._touch();
    return item;
  }

  /** Dieselbe Aenderung auf mehrere Aufgaben - ein Schreibvorgang, ein Broadcast. */
  updateMany(ids, patch) {
    const list = Array.isArray(ids) ? ids : [ids];
    let count = 0;
    for (const id of list) {
      const item = this.find(id);
      if (!item) continue;
      this._apply(item, patch);
      count++;
    }
    if (count) this._touch();
    return count;
  }

  _apply(item, patch) {
    const clean = patch && typeof patch === 'object' ? patch : {};
    const next = { ...item, ...clean, id: item.id, createdAt: item.createdAt };

    // doneAt automatisch mitfuehren
    if (clean.status && clean.status !== item.status) {
      next.doneAt = clean.status === 'erledigt' ? nowIso() : null;
    }
    next.updatedAt = nowIso();

    Object.assign(item, normalize(next, item.createdAt));
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

  /** Mehrere loeschen; die Rueckgabe ist das Material fuer ein Undo. */
  removeMany(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
    if (!wanted.size) return [];
    const removed = [];
    this.data.items = this.data.items.filter((i) => {
      if (!wanted.has(i.id)) return true;
      removed.push(i);
      return false;
    });
    if (removed.length) this._touch();
    return removed;
  }

  /** Zuvor geloeschte Items zurueckholen (Undo). */
  restore(items) {
    const list = Array.isArray(items) ? items : [items];
    let count = 0;
    for (const raw of list) {
      if (!raw || !raw.id || this.find(raw.id)) continue;
      const item = normalize(raw, raw.createdAt || nowIso());
      if (!item.title) continue;
      this.data.items.push(item);
      count++;
    }
    if (count) this._touch();
    return count;
  }

  /** Mehrere Aufgaben auf einen anderen Tag schieben. */
  moveToDay(ids, day) {
    if (!Dates.isValidKey(day)) return 0;
    const list = Array.isArray(ids) ? ids : [ids];
    let count = 0;
    for (const id of list) {
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
    const hit = (i) => i.status === 'erledigt' && (!day || i.day === day);
    const removed = this.data.items.filter(hit);
    if (!removed.length) return [];
    this.data.items = this.data.items.filter((i) => !hit(i));
    this._touch();
    return removed;
  }

  /**
   * Sehr alte erledigte Aufgaben wegraeumen - ausschliesslich auf ausdrueckliche
   * Ansage des Nutzers. Vorher wird gesichert, damit auch das umkehrbar bleibt.
   * @param {string} beforeDay Tagesschluessel; alles davor faellt weg
   */
  purgeDoneBefore(beforeDay) {
    if (!Dates.isValidKey(beforeDay)) return { ok: false, error: 'Ungültiges Datum.' };
    const hit = (i) => i.status === 'erledigt' && i.day < beforeDay;
    const removed = this.data.items.filter(hit);
    if (!removed.length) return { ok: true, count: 0, items: [] };

    let backup = null;
    try {
      backup = this.createBackup('vor-aufraeumen').name;
    } catch (err) {
      return { ok: false, error: `Vor dem Aufräumen ließ sich keine Sicherung anlegen: ${describeFsError(err)}` };
    }

    this.data.items = this.data.items.filter((i) => !hit(i));
    this._touch();
    return { ok: true, count: removed.length, items: removed, backup };
  }

  /** Kompletten Datensatz ersetzen (Import). */
  replaceAll(items) {
    const list = Array.isArray(items) ? items : [];
    this.data.items = list.map((i) => normalize(i, (i && i.createdAt) || nowIso())).filter((i) => i.title);
    this._touch();
    return this.data.items.length;
  }

  /** Items aus einem Import ergaenzen, vorhandene IDs ueberspringen. */
  merge(items) {
    const list = Array.isArray(items) ? items : [];
    let added = 0;
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || !raw.title) continue;
      const id = raw.id && !this.find(raw.id) ? raw.id : newId();
      const item = normalize({ ...raw, id }, raw.createdAt || nowIso());
      if (!item.title) continue;
      this.data.items.push(item);
      added++;
    }
    if (added) this._touch();
    return added;
  }

  // ---------------------------------------------------------------- Zahlen

  /** Schlanke Zahlen fuer Tray-Tooltip und Kopfzeile. */
  counts(today) {
    const ref = Dates.isValidKey(today) ? today : Dates.todayKey();
    const out = { total: this.data.items.length, open: 0, done: 0, overdue: 0, today: 0 };
    for (const i of this.data.items) {
      if (i.status === 'erledigt') {
        out.done++;
        continue;
      }
      out.open++;
      if (i.day < ref) out.overdue++;
      else if (i.day === ref) out.today++;
    }
    return out;
  }

  /** Kennzahlen fuer eine spaetere Statistik ("woher kommt die meiste Arbeit?"). */
  stats(today) {
    const ref = Dates.isValidKey(today) ? today : Dates.todayKey();
    const since = Dates.addDays(ref, -6);
    const out = {
      ...this.counts(ref),
      byStatus: {},
      bySource: {},
      byPriority: { 0: 0, 1: 0, 2: 0 },
      topTags: [],
      firstDay: null,
      lastDay: null,
      dayCount: 0,
      last7: { created: 0, done: 0 },
      medianDoneMinutes: null,
    };

    const tags = new Map();
    const days = new Set();
    const durations = [];

    for (const i of this.data.items) {
      out.byStatus[i.status] = (out.byStatus[i.status] || 0) + 1;
      out.bySource[i.source] = (out.bySource[i.source] || 0) + 1;
      out.byPriority[i.priority] = (out.byPriority[i.priority] || 0) + 1;
      for (const t of i.tags) tags.set(t, (tags.get(t) || 0) + 1);

      days.add(i.day);
      if (!out.firstDay || i.day < out.firstDay) out.firstDay = i.day;
      if (!out.lastDay || i.day > out.lastDay) out.lastDay = i.day;

      if (i.day >= since && i.day <= ref) out.last7.created++;
      if (i.doneAt) {
        const doneDay = String(i.doneAt).slice(0, 10);
        if (doneDay >= since && doneDay <= ref) out.last7.done++;
        const ms = new Date(i.doneAt) - new Date(i.createdAt);
        if (Number.isFinite(ms) && ms >= 0) durations.push(ms / 60000);
      }
    }

    out.dayCount = days.size;
    out.topTags = [...tags.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 20);

    if (durations.length) {
      durations.sort((a, b) => a - b);
      const mid = Math.floor(durations.length / 2);
      const median = durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
      out.medianDoneMinutes = Math.round(median);
    }
    return out;
  }
}

function clampKeep(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return DEFAULT_KEEP_DAILY;
  return Math.max(1, Math.min(365, Math.round(n)));
}

/**
 * Werte aus fremden Dateien duerfen alles Moegliche sein. Uebernommen wird nur,
 * was sich sicher wieder als JSON schreiben laesst - sonst legt ein einziger
 * Zirkelbezug das Speichern dauerhaft lahm.
 */
function jsonSafe(value, depth) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value) ? value : undefined;
  if (depth <= 0 || t !== 'object') return undefined;
  if (Array.isArray(value)) {
    const arr = [];
    for (const v of value.slice(0, 200)) {
      const clean = jsonSafe(v, depth - 1);
      if (clean !== undefined) arr.push(clean);
    }
    return arr;
  }
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, 50)) {
    const clean = jsonSafe(v, depth - 1);
    if (clean !== undefined) out[k] = clean;
  }
  return out;
}

/** Fehlende/kaputte Felder auffuellen, damit die UI sich auf das Schema verlassen kann. */
function normalize(item, fallbackTs) {
  const src = item && typeof item === 'object' ? item : {};
  const ts = fallbackTs || nowIso();
  const priority = Number(src.priority);
  const status = String(src.status || 'offen');
  const source = String(src.source || 'sonstiges');

  // Unbekannte Felder bleiben erhalten: eine Datei aus einer neueren Version
  // soll durch das blosse Oeffnen nichts verlieren.
  const extra = {};
  for (const [key, value] of Object.entries(src)) {
    if (KNOWN_FIELDS.has(key)) continue;
    const clean = jsonSafe(value, 4);
    if (clean !== undefined) extra[key] = clean;
  }

  return {
    ...extra,
    id: String(src.id || newId()),
    title: String(src.title || '').trim(),
    notes: String(src.notes || ''),
    source: SOURCE_IDS.has(source) ? source : Model.DEFAULT_SOURCE,
    status: STATUS_IDS.has(status) ? status : Model.DEFAULT_STATUS,
    priority: Number.isFinite(priority) ? Math.max(0, Math.min(2, Math.round(priority))) : 0,
    ref: src.ref ? String(src.ref) : null,
    tags: Array.isArray(src.tags) ? [...new Set(src.tags.map(String).filter(Boolean))] : [],
    day: Dates.isValidKey(src.day) ? src.day : ts.slice(0, 10),
    createdAt: src.createdAt || ts,
    updatedAt: src.updatedAt || ts,
    doneAt: status === 'erledigt' ? src.doneAt || ts : null,
  };
}

/** Platzhalter fuer spaetere Schema-Aenderungen. */
function migrate(data) {
  const out = { version: CURRENT_VERSION, items: [] };
  const version = Number(data && data.version) || 0;

  if (version > CURRENT_VERSION) {
    console.warn('[store] Datei stammt aus einer neueren Version - wird nur gelesen.');
  }

  const items = data && Array.isArray(data.items) ? data.items : [];
  const seen = new Set();
  for (const raw of items) {
    const item = normalize(raw, raw && raw.createdAt);
    if (!item.title) continue;
    // Doppelte IDs machen Bearbeiten und Loeschen unvorhersehbar
    if (seen.has(item.id)) item.id = newId();
    seen.add(item.id);
    out.items.push(item);
  }
  return out;
}

module.exports = {
  Store,
  CURRENT_VERSION,
  SAVE_DEBOUNCE_MS,
  newId,
  normalize,
  migrate,
  // von settings.js mitbenutzt - beide schreiben nach demselben Muster
  describeFsError,
  writeDurable,
  fsyncDir,
  jsonSafe,
};
