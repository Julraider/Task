'use strict';

/**
 * Alle IPC-Handler an einem Ort.
 *
 * Konvention: jeder Handler antwortet mit { ok: true, ... } oder
 * { ok: false, error: 'Text' }. Der Renderer muss dadurch nie
 * try/catch um jeden Aufruf legen.
 *
 * Alles, was ueber die Bruecke kommt, wird hier als unbekannt behandelt und
 * strukturell geprueft. Ein Tippfehler in der Oberflaeche soll eine saubere
 * Fehlermeldung ergeben und keinen halb geschriebenen Datensatz.
 */

const fs = require('fs');
const path = require('path');
const { ipcMain, app, dialog, clipboard, shell, BrowserWindow } = require('electron');

const Dates = require('../shared/dates');
const Parse = require('../shared/parse');
const Exporter = require('../shared/export');
const { describeFsError } = require('./store');

/** Payload-Helfer: nehmen alles entgegen und liefern etwas Brauchbares. */
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const asText = (v) => (typeof v === 'string' ? v : '');
const asId = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null);
const asIds = (v) => (Array.isArray(v) ? v.filter((id) => asId(id)) : []).slice(0, 5000);
const asList = (v) => (Array.isArray(v) ? v.slice(0, 5000) : []);

function registerIpc({ store, settings, api }) {
  /** Kleiner Wrapper: Fehler landen nie als unhandled rejection im Renderer. */
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        const result = await fn(asObject(payload), event);
        return result === undefined ? { ok: true } : result;
      } catch (err) {
        console.error(`[ipc] ${channel}:`, err);
        return { ok: false, error: describeFsError(err) };
      }
    });
  };

  /** Aus einer Eingabezeile wird ein Item - fuer Hauptfenster und Schnellerfassung gleich. */
  const addFromText = (text, day, notes) => {
    const base = Dates.isValidKey(day) ? day : Dates.todayKey();
    const parsed = Parse.parseCapture(asText(text), base);
    if (parsed.isEmpty) return { ok: false, error: 'Kein Text angegeben.' };

    const item = store.add({
      title: parsed.title,
      source: parsed.source,
      tags: parsed.tags,
      priority: parsed.priority,
      ref: parsed.ref,
      day: parsed.day,
      notes: asText(notes),
      status: 'offen',
    });
    if (!item) return { ok: false, error: 'Die Aufgabe konnte nicht angelegt werden.' };
    return { ok: true, item };
  };

  // ------------------------------------------------------------------ Daten

  handle('data:get', () => ({ ok: true, data: store.snapshot() }));

  /**
   * Aufgabe aus einer Eingabezeile anlegen.
   * { text: 'Drucker tauschen @teams !', day: '2026-08-17' }
   */
  handle('items:add', ({ text, day, notes }) => addFromText(text, day, notes));

  handle('items:update', ({ id, patch }) => {
    if (!asId(id)) return { ok: false, error: 'Keine Aufgabe angegeben.' };
    const item = store.update(id, asObject(patch));
    if (!item) return { ok: false, error: 'Aufgabe nicht gefunden.' };
    return { ok: true, item };
  });

  /** Dieselbe Aenderung fuer mehrere Aufgaben (Mehrfachauswahl, Status umschalten). */
  handle('items:updateMany', ({ ids, patch }) => {
    const list = asIds(ids);
    if (!list.length) return { ok: false, error: 'Keine Aufgaben angegeben.' };
    return { ok: true, count: store.updateMany(list, asObject(patch)) };
  });

  handle('items:remove', ({ id }) => {
    if (!asId(id)) return { ok: false, error: 'Keine Aufgabe angegeben.' };
    const removed = store.remove(id);
    if (!removed) return { ok: false, error: 'Aufgabe nicht gefunden.' };
    return { ok: true, item: removed };
  });

  handle('items:removeMany', ({ ids }) => {
    const removed = store.removeMany(asIds(ids));
    return { ok: true, items: removed, count: removed.length };
  });

  handle('items:restore', ({ items }) => ({ ok: true, count: store.restore(asList(items)) }));

  handle('items:move', ({ ids, day }) => {
    if (!Dates.isValidKey(day)) return { ok: false, error: 'Ungültiges Datum.' };
    return { ok: true, count: store.moveToDay(asIds(ids), day) };
  });

  handle('items:clearDone', ({ day }) => {
    if (day != null && !Dates.isValidKey(day)) return { ok: false, error: 'Ungültiges Datum.' };
    const removed = store.clearDone(day || null);
    return { ok: true, items: removed, count: removed.length };
  });

  /**
   * Aufraeumen: erledigte Aufgaben vor einem Stichtag entfernen. Passiert nur
   * auf ausdrueckliche Ansage - vorher legt der Store eine Sicherung an.
   */
  handle('items:purgeDone', ({ before }) => {
    if (!Dates.isValidKey(before)) return { ok: false, error: 'Ungültiges Datum.' };
    return store.purgeDoneBefore(before);
  });

  handle('stats:get', ({ today }) => ({ ok: true, stats: store.stats(Dates.isValidKey(today) ? today : undefined) }));

  // ----------------------------------------------------------- Einstellungen

  handle('settings:get', () => ({ ok: true, settings: settings.get() }));

  handle('settings:set', (patch) => {
    const before = settings.get();
    const next = settings.set(patch);
    // Sofort sichern: die Folgeaufrufe unten setzen ihrerseits Einstellungen
    // und wuerden die Liste der verworfenen Werte ueberschreiben.
    const rejected = [...(settings.lastRejected || [])];

    if (patch.theme && next.theme !== before.theme) api.applyTheme(next.theme);
    if (next.backupKeepDays !== before.backupKeepDays) store.setKeepDaily(next.backupKeepDays);

    let shortcut = { ok: true, registered: !!next.globalShortcutEnabled };
    if (patch.globalShortcut !== undefined || patch.globalShortcutEnabled !== undefined) {
      shortcut = api.registerGlobalShortcut();
      api.refreshTrayMenu();
    }

    let launch = null;
    if (patch.launchAtLogin !== undefined) {
      launch = api.setLaunchAtLogin(next.launchAtLogin);
      // Wenn das System den Autostart nicht uebernimmt, darf die Einstellung
      // nicht das Gegenteil behaupten.
      if (launch && launch.enabled !== next.launchAtLogin) settings.set({ launchAtLogin: launch.enabled });
    }

    if (patch.zoom !== undefined && next.zoom !== before.zoom) api.setZoom(next.zoom);

    const current = settings.get();
    api.broadcast('settings:changed', current);
    // `rejected` nennt die Schluessel, deren Wert die Pruefung nicht bestanden
    // hat - die Oberflaeche kann den alten Wert wieder anzeigen und es sagen,
    // statt so zu tun, als waere die Einstellung uebernommen.
    return { ok: true, settings: current, shortcut, launch, rejected };
  });

  handle('theme:get', () => ({ ok: true, theme: api.currentTheme() }));

  // ------------------------------------------------------------ Tageswechsel

  /**
   * Auf welchem Tag steht die App gerade? Der Renderer rechnet zwar selbst mit
   * Dates.todayKey(), soll sich aber nach langem Ruhezustand am Main-Prozess
   * ausrichten koennen - der prueft den Tageswechsel aktiv und meldet ihn ueber
   * 'day:changed'.
   */
  handle('day:get', () => {
    api.checkDayChange('abfrage');
    return { ok: true, today: api.today() };
  });

  // -------------------------------------------------------------------- Zoom

  handle('zoom:get', () => ({ ok: true, zoom: api.currentZoom() }));

  /** { level: -3 .. 3 } - halbe Schritte, alles andere wird gerundet/begrenzt. */
  handle('zoom:set', ({ level }) => {
    const n = Number(level);
    if (!Number.isFinite(n)) return { ok: false, error: 'Ungültige Zoomstufe.' };
    api.setZoom(n);
    return { ok: true, zoom: api.currentZoom() };
  });

  // ------------------------------------------------------------------ Status

  handle('status:get', () => ({ ok: true, status: api.appStatus() }));

  handle('status:dismiss', ({ code }) => ({ ok: true, dismissed: api.dismissNotice(asText(code)) }));

  // ------------------------------------------------------------ Sicherungen

  handle('backup:list', () => ({ ok: true, backups: store.backups(), dir: store.backupDir }));

  handle('backup:create', ({ reason }) => {
    const made = store.createBackup(asText(reason) || 'manuell');
    return { ok: true, name: made.name, path: made.file };
  });

  handle('backup:restore', ({ name }) => store.restoreBackup(asText(name)));

  // ------------------------------------------------------------------ Export

  /**
   * Text und - falls vorhanden - HTML in die Zwischenablage. Outlook nimmt die
   * HTML-Fassung und stellt den Bericht formatiert dar; alles andere greift auf
   * den Text zurueck.
   */
  handle('clipboard:write', ({ text, html }) => {
    const plain = asText(text);
    const markup = asText(html);
    if (markup) clipboard.write({ text: plain || markup, html: markup });
    else clipboard.writeText(plain);
    return { ok: true, html: !!markup };
  });

  /**
   * Export in eine Datei.
   * { format: Id aus Exporter.FORMATS, dayKeys: [...], scope: 'tag' | 'woche' | 'alle',
   *   options: { groupBy, title, subtitle, ... } }
   */
  handle('export:save', async ({ format, dayKeys, scope, options }) => {
    const items = store.snapshot().items;
    const keys = asList(dayKeys).filter((k) => Dates.isValidKey(k));
    const alles = scope === 'alle';
    // Ohne Tagesliste erzeugt der Exporter den Bericht ueber alles
    const selection = alles ? null : keys.length ? keys : [Dates.todayKey()];

    const spec = Exporter.formatById(asText(format));
    const content = Exporter.build(spec.id, items, selection, {
      version: store.snapshot().version,
      ...asObject(options),
    });

    const first = selection ? selection[0] : null;
    let suggested = `tagwerk-alle.${spec.ext}`;
    if (selection && selection.length === 1) {
      suggested = `tagwerk-${first}.${spec.ext}`;
    } else if (selection) {
      suggested = `tagwerk-${Dates.isoWeekLabel(first).replace(' ', '')}-${Dates.isoWeek(first).year}.${spec.ext}`;
    }

    const parent = api.getMainWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(parent || undefined, {
      title: 'Export speichern',
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [{ name: spec.ext.toUpperCase(), extensions: [spec.ext] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (err) {
      return { ok: false, error: `Export fehlgeschlagen: ${describeFsError(err)}` };
    }
    const count = selection ? items.filter((i) => selection.includes(i.day)).length : items.length;
    return { ok: true, path: filePath, format: spec.id, count };
  });

  // ------------------------------------------------------------------ Import

  handle('data:import', async ({ mode }) => {
    const parent = api.getMainWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(parent || undefined, {
      title: 'Tagwerk-Daten importieren',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    } catch (err) {
      return { ok: false, error: `Die Datei ließ sich nicht lesen: ${describeFsError(err)}` };
    }

    const items = Array.isArray(raw) ? raw : raw && raw.items;
    if (!Array.isArray(items)) return { ok: false, error: 'Datei enthält keine Aufgabenliste.' };

    // Ein Import kann alles ersetzen - vorher der aktuelle Stand als Sicherung.
    let backup = null;
    try {
      if (store.snapshot().items.length) backup = store.createBackup('vor-import').name;
    } catch (err) {
      return { ok: false, error: `Vor dem Import ließ sich keine Sicherung anlegen: ${describeFsError(err)}` };
    }

    const count = mode === 'replace' ? store.replaceAll(items) : store.merge(items);
    return { ok: true, count, backup, mode: mode === 'replace' ? 'ersetzt' : 'ergänzt' };
  });

  // -------------------------------------------------------- Schnellerfassung

  handle('quick:submit', ({ text }) => {
    const result = addFromText(text, Dates.todayKey(), '');
    if (result.ok) api.hideQuickWindow();
    return result;
  });

  handle('quick:close', () => {
    api.hideQuickWindow();
    return { ok: true };
  });

  handle('quick:open', () => {
    api.showQuickWindow();
    return { ok: true };
  });

  // -------------------------------------------------------------- Allgemeines

  handle('app:info', () => ({
    ok: true,
    info: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      dataPath: app.getPath('userData'),
      dataFile: store.filePath,
      backupDir: store.backupDir,
      isDev: api.isDev,
      packaged: app.isPackaged,
    },
  }));

  handle('app:openDataFolder', async () => {
    const problem = await shell.openPath(app.getPath('userData'));
    return problem ? { ok: false, error: problem } : { ok: true };
  });

  handle('app:openExternal', async ({ url }) => {
    if (!/^https?:\/\//i.test(asText(url))) return { ok: false, error: 'Nur http(s)-Links erlaubt.' };
    await shell.openExternal(url);
    return { ok: true };
  });

  handle('window:minimize', (_p, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
    return { ok: true };
  });
}

module.exports = { registerIpc };
