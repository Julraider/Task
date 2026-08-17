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
const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, screen, nativeTheme, shell, dialog } = require('electron');

const { Store } = require('./store');
const { Settings } = require('./settings');
const { registerIpc } = require('./ipc');

const isDev = process.argv.includes('--dev') || !app.isPackaged;
// Beim Autostart wird die App mit --hidden gestartet: nur Tray, kein Fenster.
const startHidden = process.argv.includes('--hidden');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

const QUICK_WIDTH = 680;
const QUICK_HEIGHT = 108; // genau so hoch wie die Karte - der Rest waere unsichtbar klickbar

let mainWindow = null;
let quickWindow = null;
let quickReady = null;
let tray = null;
let store = null;
let settings = null;
let quitting = false;

/** Meldungen aus dem Main-Prozess selbst (Kuerzel belegt, Autostart nicht moeglich, ...). */
const notices = new Map();
/** Welche Probleme dem Nutzer schon als Dialog gezeigt wurden - nur einmal pro Sitzung. */
const shown = new Set();

// Nur eine Instanz: ein zweiter Start holt das vorhandene Fenster nach vorne.
// Wichtig auch fuer die Daten - zwei Instanzen auf derselben Datei wuerden sich
// gegenseitig ueberschreiben.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (Array.isArray(argv) && argv.includes('--quick')) showQuickWindow();
    else showMainWindow();
  });
  app.whenReady().then(bootstrap);
}

function bootstrap() {
  const userData = app.getPath('userData');
  settings = new Settings(path.join(userData, 'settings.json')).load();
  store = new Store(path.join(userData, 'tagwerk-data.json'), {
    keepDaily: settings.get('backupKeepDays'),
  }).load();

  applyTheme(settings.get('theme'));
  hardenWebContents();

  registerIpc({ store, settings, api: publicApi() });

  // Jede Datenaenderung sofort an alle offenen Fenster melden
  store.onChange(() => {
    broadcast('data:changed', store.snapshot());
    refreshTrayLater();
  });
  store.onStatus(() => {
    broadcast('status:changed', appStatus());
    reportProblems();
  });
  nativeTheme.on('updated', () => broadcast('theme:changed', currentTheme()));

  createMainWindow();
  createTray();
  const shortcut = registerGlobalShortcut();
  if (!shortcut.ok) {
    notice(
      'kuerzel',
      'warn',
      `Das globale Tastenkürzel „${settings.get('globalShortcut')}" ließ sich nicht belegen (${shortcut.reason}). ` +
        'In den Einstellungen lässt sich ein anderes wählen.'
    );
  }
  buildAppMenu();
  syncLaunchAtLogin();
  reportProblems();

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

  // Der Renderer meldet sich frueh - offene Probleme sollen ihn erreichen,
  // auch wenn sie schon beim Laden der Datei entstanden sind.
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('status:changed', appStatus());
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

/**
 * Fenster darf nicht ausserhalb aller Bildschirme liegen (Monitor abgesteckt?)
 * und nicht groesser sein als der Bildschirm, auf dem es landet - sonst haengt
 * die Titelleiste nach einem Wechsel vom Docking-Monitor zum Notebook oben raus.
 */
function sanitizeBounds(win) {
  const src = win && typeof win === 'object' ? win : {};
  const out = {
    width: Number(src.width) > 0 ? Math.round(src.width) : 1080,
    height: Number(src.height) > 0 ? Math.round(src.height) : 760,
    x: Number.isFinite(src.x) ? Math.round(src.x) : null,
    y: Number.isFinite(src.y) ? Math.round(src.y) : null,
    maximized: !!src.maximized,
  };

  const displays = screen.getAllDisplays();
  const overlap = (d) => {
    const a = d.workArea;
    if (out.x == null || out.y == null) return 0;
    const w = Math.min(out.x + out.width, a.x + a.width) - Math.max(out.x, a.x);
    const h = Math.min(out.y + out.height, a.y + a.height) - Math.max(out.y, a.y);
    return w > 0 && h > 0 ? w * h : 0;
  };

  // Mindestens ein Zipfel muss sichtbar sein, sonst waere das Fenster weg
  const home = displays.reduce((best, d) => (overlap(d) > overlap(best) ? d : best), displays[0]);
  const area = home ? home.workArea : { x: 0, y: 0, width: out.width, height: out.height };

  if (!home || overlap(home) < 120 * 60) {
    out.x = null;
    out.y = null;
  }

  out.width = Math.max(760, Math.min(out.width, area.width));
  out.height = Math.max(520, Math.min(out.height, area.height));
  if (out.x != null) out.x = Math.max(area.x, Math.min(out.x, area.x + area.width - out.width));
  if (out.y != null) out.y = Math.max(area.y, Math.min(out.y, area.y + area.height - out.height));
  return out;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    mainWindow.once('ready-to-show', () => mainWindow.show());
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
  const place = quickBounds();

  quickWindow = new BrowserWindow({
    ...place,
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

  // Ueber Vollbild-Anwendungen und Bildschirmschoner-Ebene: sonst verschwindet
  // das Fenster unter der praesentierenden Teams-Sitzung, aus der die Aufgabe kommt.
  quickWindow.setAlwaysOnTop(true, 'screen-saver');
  quickWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  quickReady = new Promise((resolve) => {
    quickWindow.once('ready-to-show', resolve);
    // Falls 'ready-to-show' ausbleibt (transparente Fenster, exotische WMs),
    // darf das Kuerzel nicht dauerhaft blockiert sein.
    setTimeout(resolve, 4000);
  });

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
    quickReady = null;
  });
}

/** Mittig oben auf dem Bildschirm, auf dem gerade die Maus steht. */
function quickBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const width = Math.min(QUICK_WIDTH, Math.max(320, area.width - 40));
  return {
    width,
    height: QUICK_HEIGHT,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height * 0.22),
  };
}

async function showQuickWindow() {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  // Beim allerersten Aufruf ist der Inhalt noch nicht da; ohne das Warten
  // ginge der Fokus-Befehl ins Leere und das Feld bliebe tot.
  await quickReady;
  if (!quickWindow || quickWindow.isDestroyed()) return;

  quickWindow.setBounds(quickBounds());
  quickWindow.show();
  quickWindow.focus();
  quickWindow.webContents.send('quick:focus');
}

function hideQuickWindow() {
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide();
}

// -------------------------------------------------------------------- Tray

function createTray() {
  try {
    const image = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  } catch (err) {
    // Manche Linux-Desktops haben keinen Infobereich - dann laeuft die App
    // eben nur mit Fenster weiter.
    console.warn('[main] Tray nicht verfuegbar:', err.message);
    notice('tray', 'warn', 'Der Infobereich steht auf diesem System nicht zur Verfügung.');
    return;
  }
  tray.on('click', toggleMainWindow);
  tray.on('double-click', showMainWindow);
  refreshTrayMenu();
}

/** Tooltip + Menue neu aufbauen; zeigt die offenen Aufgaben ohne Umweg ueber das Fenster. */
function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const c = store ? store.counts() : { open: 0, overdue: 0, today: 0 };
  const lines = ['Tagwerk', c.open === 1 ? '1 offene Aufgabe' : `${c.open} offene Aufgaben`];
  if (c.overdue) lines.push(`${c.overdue} davon aus früheren Tagen`);
  tray.setToolTip(lines.join('\n'));

  const shortcut = settings.get('globalShortcutEnabled') ? settings.get('globalShortcut') : '';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Heute offen: ${c.today} · Älteres: ${c.overdue}`, enabled: false },
      { type: 'separator' },
      { label: 'Tagwerk öffnen', click: showMainWindow },
      { label: 'Schnellerfassung', accelerator: shortcut || undefined, click: showQuickWindow },
      { type: 'separator' },
      {
        label: 'Datenordner öffnen',
        click: () => shell.openPath(app.getPath('userData')),
      },
      {
        label: 'Sicherung jetzt anlegen',
        click: () => {
          try {
            const made = store.createBackup('manuell');
            notice('sicherung', 'info', `Sicherung „${made.name}" angelegt.`);
          } catch (err) {
            notice('sicherung', 'error', `Sicherung fehlgeschlagen: ${err.message}`);
          }
        },
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

const refreshTrayLater = debounce(refreshTrayMenu, 400);

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
    notices.delete('kuerzel');
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
        {
          label: 'Sicherung jetzt anlegen',
          click: () => {
            try {
              const made = store.createBackup('manuell');
              notice('sicherung', 'info', `Sicherung „${made.name}" angelegt.`);
            } catch (err) {
              notice('sicherung', 'error', `Sicherung fehlgeschlagen: ${err.message}`);
            }
          },
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

// ------------------------------------------------------------- Autostart

/**
 * Die Einstellung und das, was das Betriebssystem tatsaechlich eingetragen hat,
 * koennen auseinanderlaufen (Neuinstallation, aufgeraeumter Autostart-Ordner).
 * Beim Start wird das einmal begradigt.
 */
function syncLaunchAtLogin() {
  if (!app.isPackaged) return;
  if (!['win32', 'darwin'].includes(process.platform)) return;
  const wanted = !!settings.get('launchAtLogin');
  try {
    if (app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin !== wanted) {
      app.setLoginItemSettings({ openAtLogin: wanted, args: ['--hidden'] });
    }
  } catch (err) {
    console.warn('[main] Autostart konnte nicht geprueft werden:', err.message);
  }
}

function setLaunchAtLogin(enabled) {
  if (!app.isPackaged) return { ok: true, enabled: !!enabled, supported: false, reason: 'Nur in der installierten Version wirksam.' };
  if (!['win32', 'darwin'].includes(process.platform)) {
    return { ok: false, enabled: false, supported: false, reason: 'Autostart wird auf diesem System nicht unterstützt.' };
  }
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] });
    return { ok: true, enabled: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin, supported: true };
  } catch (err) {
    return { ok: false, enabled: false, supported: true, reason: err.message };
  }
}

// ------------------------------------------------------------------ Status

/** Meldung des Main-Prozesses vormerken (gleiche Form wie die des Stores). */
function notice(code, level, message) {
  notices.set(code, { code, level, message, at: new Date().toISOString(), count: 1 });
  broadcast('status:changed', appStatus());
  reportProblems();
}

function dismissNotice(code) {
  return notices.delete(code) || (store ? store.dismissProblem(code) : false);
}

/** Alles, was die Oberflaeche ueber den Zustand der Ablage wissen sollte. */
function appStatus() {
  const base = store
    ? store.status()
    : { problems: [], readOnly: false, dataPath: null, backupDir: null, pendingChanges: false };
  return {
    ...base,
    counts: store ? store.counts() : null,
    settingsError: settings ? settings.lastError : null,
    problems: [...base.problems, ...notices.values()],
  };
}

/**
 * Wenn die Ablage klemmt, darf das nicht nur im Log stehen: der Renderer kann
 * die Meldung anzeigen, aber verlassen wollen wir uns darauf nicht - harte
 * Fehler bekommen zusaetzlich einen Systemdialog, einmal pro Sitzung.
 */
function reportProblems() {
  for (const problem of appStatus().problems) {
    if (problem.level !== 'error' || shown.has(problem.code)) continue;
    shown.add(problem.code);
    // Bewusst showMessageBox statt showErrorBox: das blockiert den Main-Prozess
    // nicht, waehrend im Hintergrund weiter gespeichert wird.
    dialog
      .showMessageBox({
        type: 'error',
        title: 'Tagwerk',
        message: 'Problem mit der Datenablage',
        detail: problem.message,
        buttons: ['OK'],
        noLink: true,
      })
      .catch(() => {});
  }
}

// ------------------------------------------------------------- Absicherung

/**
 * Der Renderer darf nirgendwo hin navigieren und braucht keine Berechtigungen.
 * Beides gilt zwar schon durch CSP und contextIsolation - doppelt haelt besser.
 */
function hardenWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) {
        event.preventDefault();
        if (/^https?:/.test(url)) shell.openExternal(url);
      }
    });
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    contents.on('render-process-gone', (_e, details) => {
      console.error('[main] Renderer beendet:', details.reason);
      if (contents === (mainWindow && mainWindow.webContents) && !quitting) contents.reload();
    });
  });
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
    appStatus,
    notice,
    dismissNotice,
    isDev,
    getMainWindow: () => mainWindow,
    setLaunchAtLogin,
  };
}

// ------------------------------------------------------------- App-Lifecycle

/** Alles Ausstehende auf die Platte. Mehrfach aufrufbar - beides ist idempotent. */
function flushAll() {
  try {
    if (store) store.flush();
  } catch (err) {
    console.error('[main] Store-Flush fehlgeschlagen:', err.message);
  }
  try {
    if (settings) settings.flush();
  } catch (err) {
    console.error('[main] Settings-Flush fehlgeschlagen:', err.message);
  }
}

app.on('before-quit', () => {
  quitting = true;
  flushAll();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  flushAll();
  if (tray && !tray.isDestroyed()) tray.destroy();
});

// Letzte Rettung: bei app.exit(), Strg+C oder Abmelden laeuft 'before-quit'
// nicht immer durch. flushAll() ist synchron und darf hier stehen.
process.on('exit', flushAll);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    quitting = true;
    flushAll();
    app.quit();
  });
}

app.on('window-all-closed', () => {
  // Tray-App: laeuft weiter, ausser auf macOS gilt die uebliche Konvention
  if (process.platform === 'darwin') return;
  if (!settings || !settings.get('closeToTray') || !tray) app.quit();
});
