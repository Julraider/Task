'use strict';

/**
 * Tagwerk - Einstiegspunkt des Main-Prozesses.
 *
 * Aufgaben hier:
 *  - Hauptfenster + Schnellerfassungs-Fenster erzeugen
 *  - Tray-Icon und globales Tastenkuerzel
 *  - Daten laden/speichern und Aenderungen an alle Fenster verteilen
 *
 * Die eigentliche Logik steckt in store.js / settings.js / ipc.js.
 */

const path = require('path');
const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, screen, nativeTheme, shell } = require('electron');

const { Store } = require('./store');
const { Settings } = require('./settings');
const { registerIpc } = require('./ipc');

const isDev = process.argv.includes('--dev') || !app.isPackaged;
// Beim Autostart wird die App mit --hidden gestartet: nur Tray, kein Fenster.
const startHidden = process.argv.includes('--hidden');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

let mainWindow = null;
let quickWindow = null;
let tray = null;
let store = null;
let settings = null;
let quitting = false;

// Nur eine Instanz: ein zweiter Start holt das vorhandene Fenster nach vorne.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.whenReady().then(bootstrap);
}

function bootstrap() {
  const userData = app.getPath('userData');
  settings = new Settings(path.join(userData, 'settings.json')).load();
  store = new Store(path.join(userData, 'tagwerk-data.json')).load();

  applyTheme(settings.get('theme'));

  registerIpc({ store, settings, api: publicApi() });

  // Jede Datenaenderung sofort an alle offenen Fenster melden
  store.onChange(() => broadcast('data:changed', store.snapshot()));
  nativeTheme.on('updated', () => broadcast('theme:changed', currentTheme()));

  createMainWindow();
  createTray();
  registerGlobalShortcut();
  buildAppMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showMainWindow();
  });
}

// ------------------------------------------------------------- Hauptfenster

function createMainWindow() {
  const bounds = sanitizeBounds(settings.get('window'));

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x ?? undefined,
    y: bounds.y ?? undefined,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161c' : '#f4f5f8',
    icon: path.join(ASSETS, 'icon.png'),
    title: 'Tagwerk',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  if (bounds.maximized) mainWindow.maximize();
  mainWindow.loadFile(path.join(RENDERER, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
    if (isDev && process.argv.includes('--devtools')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  const persistBounds = debounce(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    const isMax = mainWindow.isMaximized();
    const b = mainWindow.getNormalBounds();
    settings.set({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized: isMax } });
  }, 500);

  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);
  mainWindow.on('maximize', persistBounds);
  mainWindow.on('unmaximize', persistBounds);

  // Schliessen legt das Fenster in den Tray, statt die App zu beenden
  mainWindow.on('close', (event) => {
    if (!quitting && settings.get('closeToTray')) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Externe Links im echten Browser oeffnen, nicht in der App
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** Fenster darf nicht ausserhalb aller Bildschirme liegen (Monitor abgesteckt?). */
function sanitizeBounds(win) {
  const out = { width: win.width || 1080, height: win.height || 760, x: win.x, y: win.y, maximized: !!win.maximized };
  if (out.x == null || out.y == null) return out;

  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return out.x < a.x + a.width && out.x + out.width > a.x && out.y < a.y + a.height && out.y + out.height > a.y;
  });
  if (!visible) {
    out.x = null;
    out.y = null;
  }
  return out;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showMainWindow();
}

// ------------------------------------------------------- Schnellerfassung

/**
 * Kleines, randloses Fenster oben am Bildschirm: per globalem Kuerzel aufrufbar,
 * eine Zeile tippen, Enter - weg ist es. Damit landet auch der Zuruf vom Flur
 * in der Liste, ohne dass man die App sucht.
 */
function createQuickWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 680;
  const height = 108; // genau so hoch wie die Karte - der Rest waere unsichtbar klickbar
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2);
  const y = Math.round(display.workArea.y + display.workArea.height * 0.22);

  quickWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  quickWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  quickWindow.loadFile(path.join(RENDERER, 'quick.html'));

  // Klick daneben schliesst das Fenster wieder - ausser die Entwicklertools
  // sind offen, sonst kann man dort nichts anklicken.
  quickWindow.on('blur', () => {
    if (!quickWindow || quickWindow.isDestroyed()) return;
    if (quickWindow.webContents.isDevToolsOpened()) return;
    quickWindow.hide();
  });

  quickWindow.on('closed', () => {
    quickWindow = null;
  });
}

function showQuickWindow() {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [width, height] = quickWindow.getSize();
  quickWindow.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    Math.round(display.workArea.y + display.workArea.height * 0.22)
  );

  quickWindow.show();
  quickWindow.focus();
  quickWindow.webContents.send('quick:focus');
}

function hideQuickWindow() {
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide();
}

// -------------------------------------------------------------------- Tray

function createTray() {
  const image = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Tagwerk');
  refreshTrayMenu();
  tray.on('click', toggleMainWindow);
  tray.on('double-click', showMainWindow);
}

function refreshTrayMenu() {
  if (!tray) return;
  const shortcut = settings.get('globalShortcutEnabled') ? settings.get('globalShortcut') : '';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Tagwerk öffnen', click: showMainWindow },
      { label: 'Schnellerfassung', accelerator: shortcut || undefined, click: showQuickWindow },
      { type: 'separator' },
      {
        label: 'Datenordner öffnen',
        click: () => shell.openPath(app.getPath('userData')),
      },
      { type: 'separator' },
      {
        label: 'Beenden',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
}

// -------------------------------------------------------- Globales Kuerzel

function registerGlobalShortcut() {
  globalShortcut.unregisterAll();
  if (!settings.get('globalShortcutEnabled')) return { ok: true, registered: false };

  const accelerator = settings.get('globalShortcut');
  if (!accelerator) return { ok: true, registered: false };

  try {
    const ok = globalShortcut.register(accelerator, showQuickWindow);
    if (!ok) {
      console.warn(`[main] Tastenkuerzel ${accelerator} ist belegt.`);
      return { ok: false, registered: false, reason: 'belegt' };
    }
    return { ok: true, registered: true };
  } catch (err) {
    console.error('[main] Tastenkuerzel ungueltig:', err.message);
    return { ok: false, registered: false, reason: 'ungültig' };
  }
}

// ------------------------------------------------------------------- Menue

function buildAppMenu() {
  // Ohne Menue funktionieren Strg+C/V in Eingabefeldern unter Windows/Linux nicht
  // zuverlaessig - deshalb ein schlankes Menue mit den Standard-Rollen.
  const template = [
    {
      label: 'Datei',
      submenu: [
        { label: 'Schnellerfassung', accelerator: 'CmdOrCtrl+Shift+N', click: showQuickWindow },
        { type: 'separator' },
        {
          label: 'Datenordner öffnen',
          click: () => shell.openPath(app.getPath('userData')),
        },
        { type: 'separator' },
        {
          label: 'Beenden',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rückgängig' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'toggleDevTools', label: 'Entwicklertools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom zurücksetzen' },
        { role: 'zoomIn', label: 'Größer' },
        { role: 'zoomOut', label: 'Kleiner' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({ role: 'appMenu' });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ Themes

function applyTheme(theme) {
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';
}

function currentTheme() {
  return {
    source: nativeTheme.themeSource,
    dark: nativeTheme.shouldUseDarkColors,
  };
}

// --------------------------------------------------------------- Hilfsmittel

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Wird an ipc.js gereicht, damit die Handler Fenster steuern koennen. */
function publicApi() {
  return {
    showMainWindow,
    showQuickWindow,
    hideQuickWindow,
    registerGlobalShortcut,
    refreshTrayMenu,
    applyTheme,
    currentTheme,
    broadcast,
    isDev,
    getMainWindow: () => mainWindow,
    setLaunchAtLogin(enabled) {
      if (!app.isPackaged) return false; // im Dev-Modus sinnlos
      app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] });
      return app.getLoginItemSettings().openAtLogin;
    },
  };
}

// ------------------------------------------------------------- App-Lifecycle

app.on('before-quit', () => {
  quitting = true;
  if (store) store.flush();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Tray-App: laeuft weiter, ausser auf macOS gilt die uebliche Konvention
  if (process.platform === 'darwin') return;
  if (!settings || !settings.get('closeToTray')) app.quit();
});
