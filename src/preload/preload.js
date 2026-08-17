'use strict';

/**
 * Bruecke zwischen Renderer und Main.
 *
 * Der Renderer bekommt ausschliesslich diese Funktionen zu sehen - kein
 * `require`, kein Node-Zugriff, kein `ipcRenderer` direkt. Damit bleibt
 * contextIsolation wirksam.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Mehrere Renderer-Module hoeren auf dieselben Kanaele (Daten, Status, Thema,
// Tageswechsel). Ohne diese Zeile warnt Node ab dem elften Zuhoerer in der
// Konsole des Renderers - eine Warnung, die nach einem Leck aussieht, aber
// keins ist.
ipcRenderer.setMaxListeners(0);

/** Event-Listener registrieren und eine Abmeldefunktion zurueckgeben. */
function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  // --- Daten ---------------------------------------------------------------
  getData: () => ipcRenderer.invoke('data:get'),
  onDataChanged: (cb) => on('data:changed', cb),

  addItem: (text, day, notes) => ipcRenderer.invoke('items:add', { text, day, notes }),
  updateItem: (id, patch) => ipcRenderer.invoke('items:update', { id, patch }),
  updateItems: (ids, patch) => ipcRenderer.invoke('items:updateMany', { ids, patch }),
  removeItem: (id) => ipcRenderer.invoke('items:remove', { id }),
  removeItems: (ids) => ipcRenderer.invoke('items:removeMany', { ids }),
  restoreItems: (items) => ipcRenderer.invoke('items:restore', { items }),
  moveItems: (ids, day) => ipcRenderer.invoke('items:move', { ids, day }),
  clearDone: (day) => ipcRenderer.invoke('items:clearDone', { day }),
  /** Erledigtes vor `before` (Tagesschluessel) endgueltig entfernen - nur auf Nutzerwunsch. */
  purgeDone: (before) => ipcRenderer.invoke('items:purgeDone', { before }),
  getStats: (today) => ipcRenderer.invoke('stats:get', { today }),

  // --- Zustand der Ablage --------------------------------------------------
  // Meldet defekte Dateien, fehlende Schreibrechte, Notablagen. Der Renderer
  // kann das anzeigen; passiert nichts, meldet sich der Main-Prozess selbst.
  getStatus: () => ipcRenderer.invoke('status:get'),
  onStatusChanged: (cb) => on('status:changed', cb),
  dismissProblem: (code) => ipcRenderer.invoke('status:dismiss', { code }),

  // --- Sicherungen ---------------------------------------------------------
  listBackups: () => ipcRenderer.invoke('backup:list'),
  createBackup: (reason) => ipcRenderer.invoke('backup:create', { reason }),
  restoreBackup: (name) => ipcRenderer.invoke('backup:restore', { name }),

  // --- Einstellungen -------------------------------------------------------
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onSettingsChanged: (cb) => on('settings:changed', cb),

  getTheme: () => ipcRenderer.invoke('theme:get'),
  onThemeChanged: (cb) => on('theme:changed', cb),

  // --- Tageswechsel --------------------------------------------------------
  // Die App laeuft nachts durch: um Mitternacht (und nach dem Aufwachen aus dem
  // Ruhezustand) meldet der Main-Prozess den neuen Tag. Wer 'heute' anzeigt,
  // muss darauf hoeren - sonst steht morgens noch der gestrige Tag im Fenster.
  /** @returns {Promise<{ok: boolean, today: string}>} */
  getToday: () => ipcRenderer.invoke('day:get'),
  /** cb({ today: 'YYYY-MM-DD', previous: 'YYYY-MM-DD'|null, reason: string }) */
  onDayChanged: (cb) => on('day:changed', cb),

  // --- Zoomstufe -----------------------------------------------------------
  // Wird gemerkt und beim naechsten Start wiederhergestellt.
  getZoom: () => ipcRenderer.invoke('zoom:get'),
  setZoom: (level) => ipcRenderer.invoke('zoom:set', { level }),
  onZoomChanged: (cb) => on('zoom:changed', cb),

  // --- Export / Import -----------------------------------------------------
  // `html` ist optional: nur damit landet ein Bericht formatiert in einer
  // Outlook-Mail statt als Rohtext mit sichtbaren Auszeichnungen.
  copyToClipboard: (text, html) => ipcRenderer.invoke('clipboard:write', { text, html }),
  exportFile: (format, dayKeys, scope, options) =>
    ipcRenderer.invoke('export:save', { format, dayKeys, scope, options }),
  importFile: (mode) => ipcRenderer.invoke('data:import', { mode }),

  // --- Schnellerfassung ----------------------------------------------------
  quickSubmit: (text) => ipcRenderer.invoke('quick:submit', { text }),
  quickClose: () => ipcRenderer.invoke('quick:close'),
  quickOpen: () => ipcRenderer.invoke('quick:open'),
  onQuickFocus: (cb) => on('quick:focus', cb),

  // --- Allgemein -----------------------------------------------------------
  appInfo: () => ipcRenderer.invoke('app:info'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', { url }),
  minimize: () => ipcRenderer.invoke('window:minimize'),
};

contextBridge.exposeInMainWorld('tagwerk', api);
