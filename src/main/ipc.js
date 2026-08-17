'use strict';

/**
 * Alle IPC-Handler an einem Ort.
 *
 * Konvention: jeder Handler antwortet mit { ok: true, ... } oder
 * { ok: false, error: 'Text' }. Der Renderer muss dadurch nie
 * try/catch um jeden Aufruf legen.
 */

const fs = require('fs');
const path = require('path');
const { ipcMain, app, dialog, clipboard, shell, BrowserWindow } = require('electron');

const Dates = require('../shared/dates');
const Parse = require('../shared/parse');
const Exporter = require('../shared/export');

function registerIpc({ store, settings, api }) {
  /** Kleiner Wrapper: Fehler landen nie als unhandled rejection im Renderer. */
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        const result = await fn(payload, event);
        return result === undefined ? { ok: true } : result;
      } catch (err) {
        console.error(`[ipc] ${channel}:`, err);
        return { ok: false, error: err.message || String(err) };
      }
    });
  };

  // ------------------------------------------------------------------ Daten

  handle('data:get', () => ({ ok: true, data: store.snapshot() }));

  /**
   * Aufgabe aus einer Eingabezeile anlegen.
   * { text: 'Drucker tauschen @teams !', day: '2026-08-17' }
   */
  handle('items:add', ({ text, day, notes }) => {
    const parsed = Parse.parseCapture(text, day || Dates.todayKey());
    if (parsed.isEmpty) return { ok: false, error: 'Kein Text angegeben.' };

    const item = store.add({
      title: parsed.title,
      source: parsed.source,
      tags: parsed.tags,
      priority: parsed.priority,
      ref: parsed.ref,
      day: parsed.day,
      notes: notes || '',
      status: 'offen',
    });
    return { ok: true, item };
  });

  handle('items:update', ({ id, patch }) => {
    const item = store.update(id, patch || {});
    if (!item) return { ok: false, error: 'Aufgabe nicht gefunden.' };
    return { ok: true, item };
  });

  handle('items:remove', ({ id }) => {
    const removed = store.remove(id);
    if (!removed) return { ok: false, error: 'Aufgabe nicht gefunden.' };
    return { ok: true, item: removed };
  });

  handle('items:restore', ({ items }) => ({ ok: true, count: store.restore(items) }));

  handle('items:move', ({ ids, day }) => {
    if (!Dates.isValidKey(day)) return { ok: false, error: 'Ungültiges Datum.' };
    return { ok: true, count: store.moveToDay(ids || [], day) };
  });

  handle('items:clearDone', ({ day }) => {
    const removed = store.clearDone(day || null);
    return { ok: true, items: removed, count: removed.length };
  });

  // ----------------------------------------------------------- Einstellungen

  handle('settings:get', () => ({ ok: true, settings: settings.get() }));

  handle('settings:set', (patch) => {
    const before = settings.get();
    const next = settings.set(patch || {});

    if (patch.theme && patch.theme !== before.theme) api.applyTheme(next.theme);

    let shortcut = { ok: true, registered: settings.get('globalShortcutEnabled') };
    if (patch.globalShortcut !== undefined || patch.globalShortcutEnabled !== undefined) {
      shortcut = api.registerGlobalShortcut();
      api.refreshTrayMenu();
    }
    if (patch.launchAtLogin !== undefined) api.setLaunchAtLogin(patch.launchAtLogin);

    api.broadcast('settings:changed', next);
    return { ok: true, settings: next, shortcut };
  });

  handle('theme:get', () => ({ ok: true, theme: api.currentTheme() }));

  // ------------------------------------------------------------------ Export

  handle('clipboard:write', ({ text }) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  /**
   * Export in eine Datei.
   * { format: 'md' | 'csv' | 'json', dayKeys: [...], scope: 'tag' | 'woche' | 'alle' }
   */
  handle('export:save', async ({ format, dayKeys, scope }) => {
    const items = store.snapshot().items;
    const keys = Array.isArray(dayKeys) && dayKeys.length ? dayKeys : [Dates.todayKey()];

    let content;
    let ext;
    if (format === 'csv') {
      const subset = scope === 'alle' ? items : items.filter((i) => keys.includes(i.day));
      content = Exporter.csv(subset);
      ext = 'csv';
    } else if (format === 'json') {
      const subset = scope === 'alle' ? items : items.filter((i) => keys.includes(i.day));
      content = JSON.stringify({ version: store.snapshot().version, items: subset }, null, 2);
      ext = 'json';
    } else {
      content = keys.length === 1 ? Exporter.dayMarkdown(items, keys[0]) : Exporter.weekMarkdown(items, keys);
      ext = 'md';
    }

    const suggested =
      keys.length === 1
        ? `tagwerk-${keys[0]}.${ext}`
        : `tagwerk-${Dates.isoWeekLabel(keys[0]).replace(' ', '')}-${Dates.isoWeek(keys[0]).year}.${ext}`;

    const parent = api.getMainWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(parent || undefined, {
      title: 'Export speichern',
      defaultPath: path.join(app.getPath('documents'), scope === 'alle' ? `tagwerk-alle.${ext}` : suggested),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true, path: filePath };
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

    const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    const items = Array.isArray(raw) ? raw : raw.items;
    if (!Array.isArray(items)) return { ok: false, error: 'Datei enthält keine Aufgabenliste.' };

    const count = mode === 'replace' ? store.replaceAll(items) : store.merge(items);
    return { ok: true, count, mode: mode === 'replace' ? 'ersetzt' : 'ergänzt' };
  });

  // -------------------------------------------------------- Schnellerfassung

  handle('quick:submit', ({ text }) => {
    const parsed = Parse.parseCapture(text, Dates.todayKey());
    if (parsed.isEmpty) return { ok: false, error: 'Kein Text angegeben.' };

    const item = store.add({
      title: parsed.title,
      source: parsed.source,
      tags: parsed.tags,
      priority: parsed.priority,
      ref: parsed.ref,
      day: parsed.day,
      status: 'offen',
    });
    api.hideQuickWindow();
    return { ok: true, item };
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
      isDev: api.isDev,
      packaged: app.isPackaged,
    },
  }));

  handle('app:openDataFolder', async () => {
    await shell.openPath(app.getPath('userData'));
    return { ok: true };
  });

  handle('app:openExternal', async ({ url }) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: 'Nur http(s)-Links erlaubt.' };
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
