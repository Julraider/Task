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
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, screen,
  nativeTheme, shell, dialog, powerMonitor, session,
} = require('electron');

const Dates = require('../shared/dates');
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

// Wunschmasse des Hauptfensters. Auf kleinen Bildschirmen (Netbook, 1024x600,
// oder 200 % Skalierung) wird daraus das, was der Arbeitsbereich hergibt -
// ein Fenster mit minHeight groesser als der Bildschirm laesst sich sonst nicht
// mehr auf den Bildschirm schieben.
const MIN_WIDTH = 760;
const MIN_HEIGHT = 520;

/** Prueftakt der Tagesueberwachung: nie laenger als eine Minute schlafen. */
const DAY_TICK_MS = 60 * 1000;

let mainWindow = null;
let quickWindow = null;
let quickReady = null;
let tray = null;
let store = null;
let settings = null;
let quitting = false;

/** Tag, auf dem die App gerade steht - fuer den Tageswechsel um Mitternacht. */
let currentDay = null;
let dayTimer = null;

/** Fensterposition wird gebuendelt gespeichert; beim Beenden muss der Rest raus. */
let flushBounds = null;

/** Zeitpunkt, an dem die Schnellerfassung zuletzt gezeigt wurde (Fokus-Rennen). */
let quickShownAt = 0;

/** Absturzbremse: ein dauerhaft abstuerzender Renderer darf keine Endlosschleife werden. */
const crashes = { count: 0, since: 0 };

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
  currentDay = Dates.todayKey();

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
  nativeTheme.on('updated', () => {
    broadcast('theme:changed', currentTheme());
    // Auch die Fensterfarbe nachziehen: sonst blitzt beim naechsten Hervorholen
    // aus dem Infobereich kurz die alte, helle Flaeche auf.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(themeBackground());
  });

  createMainWindow();
  createTray();
  registerGlobalShortcut(); // meldet sich bei Misserfolg selbst
  buildAppMenu();
  syncLaunchAtLogin();
  watchDayChange();
  watchPower();
  watchDisplays();
  reportProblems();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showMainWindow();
  });

  // Wer das Fenster nach Stunden wieder anfasst, soll sofort den richtigen Tag
  // sehen - ohne auf den naechsten Prueftakt zu warten.
  app.on('browser-window-focus', () => checkDayChange('fokus'));
}

// ------------------------------------------------------------- Tageswechsel

/**
 * Die App laeuft ueber Nacht durch. Ohne diese Ueberwachung stuende morgens
 * immer noch der gestrige Tag im Fenster, „Heute" waere falsch beschriftet und
 * die liegengebliebenen Aufgaben von gestern fehlten in der Liste.
 *
 * Absichtlich kein einzelner Timer bis Mitternacht: waehrend des Ruhezustands
 * laufen Timer nicht weiter (bzw. feuern erst Stunden spaeter), eine Zeitumstellung
 * oder eine korrigierte Systemuhr verschiebt den Zielpunkt. Stattdessen wird
 * hoechstens eine Minute geschlafen und danach schlicht das Datum verglichen -
 * das ist gegen alle drei Faelle immun und kostet praktisch nichts.
 */
function watchDayChange() {
  if (dayTimer) clearTimeout(dayTimer);
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2, 0);
  const wait = Math.max(1000, Math.min(DAY_TICK_MS, nextMidnight - now));

  dayTimer = setTimeout(() => {
    checkDayChange('uhr');
    watchDayChange();
  }, wait);
  if (typeof dayTimer.unref === 'function') dayTimer.unref();
}

/**
 * Ist ein neuer Tag angebrochen? Dann alle Fenster benachrichtigen, den Tray
 * neu beschriften (aus „heute offen" wird ueber Nacht „ueberfaellig") und die
 * Tagessicherung des neuen Tages anlegen - die gab es sonst nur beim Start,
 * also bei einer wochenlang laufenden App nie wieder.
 */
function checkDayChange(reason) {
  const today = Dates.todayKey();
  if (!currentDay) currentDay = today;
  if (today === currentDay) return false;

  const previous = currentDay;
  currentDay = today;
  console.log(`[main] Tageswechsel ${previous} -> ${today} (${reason})`);

  broadcast('day:changed', { today, previous, reason: String(reason || '') });
  refreshTrayMenu();
  try {
    if (store) store.backupDaily();
  } catch (err) {
    console.warn('[main] Tagessicherung nach Tageswechsel fehlgeschlagen:', err.message);
  }
  broadcast('status:changed', appStatus());
  return true;
}

/**
 * Ruhezustand und Abmelden: vor dem Einschlafen alles auf die Platte, nach dem
 * Aufwachen sofort pruefen, ob inzwischen ein neuer Tag angefangen hat.
 */
function watchPower() {
  const safe = (event, fn) => {
    try {
      powerMonitor.on(event, fn);
    } catch (err) {
      console.warn(`[main] powerMonitor '${event}' nicht verfuegbar:`, err.message);
    }
  };

  safe('suspend', () => flushAll());
  safe('shutdown', () => {
    quitting = true;
    flushAll();
  });
  safe('lock-screen', () => flushAll());
  safe('resume', () => {
    checkDayChange('aufwachen');
    watchDayChange(); // Zeitgeber koennen den Schlaf nicht ueberlebt haben
  });
  safe('unlock-screen', () => checkDayChange('entsperrt'));
  safe('user-did-become-active', () => checkDayChange('aktiv'));
}

// ------------------------------------------------------------- Hauptfenster

function createMainWindow() {
  const bounds = sanitizeBounds(settings.get('window'));

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x ?? undefined,
    y: bounds.y ?? undefined,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    show: false,
    backgroundColor: themeBackground(),
    icon: path.join(ASSETS, 'icon.png'),
    title: 'Tagwerk',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      // Die gespeicherte Zoomstufe gilt fuer dieses Fenster, nicht global fuer
      // alle file://-Seiten - sonst zoomt die Schnellerfassung mit und passt
      // nicht mehr in ihren Rahmen.
      zoomFactor: zoomFactorOf(settings.get('zoom')),
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
    // Nach jedem Laden (auch nach Strg+R) die gemerkte Zoomstufe wieder setzen -
    // Chromium faengt sonst bei 100 % an.
    applyZoom(mainWindow, settings.get('zoom'));
    mainWindow.webContents.send('status:changed', appStatus());
    mainWindow.webContents.send('day:changed', { today: Dates.todayKey(), previous: null, reason: 'start' });
  });

  // Strg+Mausrad zoomt nur, wenn wir es selbst umsetzen - und nur dann wissen
  // wir auch, was wir uns merken muessen.
  mainWindow.webContents.on('zoom-changed', (_event, direction) => {
    setZoom(currentZoom().level + (direction === 'zoomIn' ? 0.5 : -0.5));
  });

  // Strg + Plus/Minus/Null selbst abfangen: die Menue-Kuerzel greifen nicht auf
  // jeder Tastaturbelegung (auf der deutschen liegt „+" ohne Umschalt, auf der
  // amerikanischen darunter „="), und der Ziffernblock kommt als eigene Taste.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt) return;
    if (!(input.control || input.meta)) return;
    const key = String(input.key);
    let level = null;
    if (key === '+' || key === '=') level = currentZoom().level + 0.5;
    else if (key === '-' || key === '_') level = currentZoom().level - 0.5;
    else if (key === '0') level = 0;
    if (level === null) return;
    event.preventDefault(); // sonst zoomt zusaetzlich das Menue-Kuerzel
    setZoom(level);
  });

  const persistBounds = debounce(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    const isMax = mainWindow.isMaximized();
    const b = mainWindow.getNormalBounds();
    settings.set({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized: isMax } });
  }, 500);
  // Beim Beenden darf die letzte Verschiebung nicht im Debounce haengen bleiben:
  // sonst startet die App an der vorletzten Position.
  flushBounds = persistBounds.flush;

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
    // Der Debounce zeigt sonst auf ein Fenster, das es nicht mehr gibt.
    if (flushBounds === persistBounds.flush) flushBounds = null;
    persistBounds.cancel();
    mainWindow = null;
  });
  // Externe Links oeffnet der Browser des Systems - siehe hardenWebContents().
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
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
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

  // Auf einem kleinen oder stark skalierten Bildschirm darf die Mindestgroesse
  // nicht groesser sein als der Arbeitsbereich - sonst ragt das Fenster
  // unverrueckbar unter die Taskleiste.
  out.minWidth = Math.min(MIN_WIDTH, area.width);
  out.minHeight = Math.min(MIN_HEIGHT, area.height);

  out.width = Math.max(out.minWidth, Math.min(out.width, area.width));
  out.height = Math.max(out.minHeight, Math.min(out.height, area.height));
  if (out.x != null) out.x = Math.max(area.x, Math.min(out.x, area.x + area.width - out.width));
  if (out.y != null) out.y = Math.max(area.y, Math.min(out.y, area.y + area.height - out.height));
  return out;
}

/**
 * Fenster wieder auf einen vorhandenen Bildschirm holen. Noetig, wenn zwischen
 * zwei Sichtbarkeiten der Docking-Monitor abgezogen wurde: das Fenster liegt
 * dann auf Koordinaten, die es nicht mehr gibt, und waere unerreichbar.
 */
function ensureOnScreen(win) {
  if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return;
  const b = win.getBounds();
  const fits = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    return w > 80 && h > 40;
  });
  if (fits) return;

  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(b.width, area.width);
  const height = Math.min(b.height, area.height);
  win.setBounds({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
  });
}

/**
 * Mindestgroesse an den Bildschirm anpassen, auf dem das Fenster gerade liegt.
 * Nach dem Wechsel vom 27-Zoll-Monitor auf das Notebook mit 125 % Skalierung
 * bleibt sonst eine Mindesthoehe stehen, die dort gar nicht mehr hinpasst.
 */
function applyMinSize(win) {
  if (!win || win.isDestroyed()) return;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  win.setMinimumSize(Math.min(MIN_WIDTH, area.width), Math.min(MIN_HEIGHT, area.height));
}

/**
 * Bildschirme kommen und gehen (Notebook aus der Dockingstation). Danach kann
 * das Hauptfenster im Nichts liegen - auch dann, wenn es gerade im Infobereich
 * versteckt war und der Nutzer es Stunden spaeter wieder hervorholt.
 */
function watchDisplays() {
  const recheck = debounce(() => {
    applyMinSize(mainWindow);
    ensureOnScreen(mainWindow);
    if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) {
      quickWindow.setBounds(quickBounds());
    }
  }, 400);

  screen.on('display-removed', recheck);
  screen.on('display-added', recheck);
  screen.on('display-metrics-changed', recheck);
}

// -------------------------------------------------------------------- Zoom

/** Electron-Zoomstufe -> Faktor (jede Stufe etwa 20 %). */
function zoomFactorOf(level) {
  const n = Number(level);
  return Number.isFinite(n) ? Math.pow(1.2, Math.max(-3, Math.min(3, n))) : 1;
}

function applyZoom(win, level) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  wc.setZoomLevel(Number(level) || 0);
  // Pinch-Zoom wuerde eine zweite, nicht gespeicherte Zoomstufe einfuehren -
  // die Oberflaeche saehe nach dem Neustart anders aus als vorher.
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
}

/**
 * Zoomstufe setzen und merken. Die Schnellerfassung zieht mit: Chromium fuehrt
 * den Zoom je Herkunft (hier: file://) und nicht je Fenster, ein Alleingang
 * waere also ohnehin nicht durchzuhalten - stattdessen waechst ihr Rahmen mit.
 */
function setZoom(level) {
  const next = settings.set({ zoom: level }).zoom;
  applyZoom(mainWindow, next);
  if (quickWindow && !quickWindow.isDestroyed()) {
    applyZoom(quickWindow, next);
    quickWindow.setBounds(quickBounds());
  }
  broadcast('zoom:changed', { level: next, factor: zoomFactorOf(next) });
  return next;
}

function currentZoom() {
  const level = settings ? Number(settings.get('zoom')) || 0 : 0;
  return { level, factor: zoomFactorOf(level) };
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    mainWindow.once('ready-to-show', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  // Zwischen Verstecken und Hervorholen koennen Stunden liegen - in der Zeit
  // wird umgesteckt, abgemeldet, der Beamer abgezogen.
  ensureOnScreen(mainWindow);
  mainWindow.show();
  focusHard(mainWindow);
  checkDayChange('fenster');
}

/**
 * Unter Windows darf ein Hintergrundprozess den Fokus nicht einfach nehmen:
 * das Fenster kaeme dann nur blinkend in der Taskleiste hoch. Ein kurzes
 * „immer im Vordergrund" umgeht das, ohne das Fenster dauerhaft oben zu halten.
 */
function focusHard(win) {
  if (!win || win.isDestroyed()) return;
  win.focus();
  if (process.platform !== 'win32' || win.isFocused()) return;
  const wasOnTop = win.isAlwaysOnTop();
  win.setAlwaysOnTop(true);
  win.moveTop();
  win.focus();
  if (!wasOnTop) win.setAlwaysOnTop(false);
}

/** Fensterfarbe passend zum Thema - gegen das weisse Aufblitzen beim Start. */
function themeBackground() {
  return nativeTheme.shouldUseDarkColors ? '#14161c' : '#f4f5f8';
}

let lastTrayToggle = 0;

function toggleMainWindow() {
  // Windows schickt beim Doppelklick auf das Symbol zwei 'click' und danach
  // 'double-click' - ohne diese Sperre wuerde das Fenster dabei flackern.
  const now = Date.now();
  if (now - lastTrayToggle < 400) return;
  lastTrayToggle = now;

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
    // Transparente Fenster duerfen unter Windows nicht groessenveraenderbar
    // sein - sonst zeichnet Chromium einen schwarzen Rahmen.
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      zoomFactor: zoomFactorOf(settings.get('zoom')),
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
    const guard = setTimeout(resolve, 4000);
    if (typeof guard.unref === 'function') guard.unref();
  });

  quickWindow.loadFile(path.join(RENDERER, 'quick.html'));

  quickWindow.webContents.on('did-finish-load', () => {
    if (!quickWindow || quickWindow.isDestroyed()) return;
    applyZoom(quickWindow, settings.get('zoom'));
  });

  // Klick daneben schliesst das Fenster wieder - ausser die Entwicklertools
  // sind offen, sonst kann man dort nichts anklicken.
  quickWindow.on('blur', () => {
    if (!quickWindow || quickWindow.isDestroyed()) return;
    if (quickWindow.webContents.isDevToolsOpened()) return;
    // Unter Windows kommt direkt nach show() haeufig noch ein blur des
    // vorherigen Fokuswechsels an. Ohne diese Schonfrist verschwindet die
    // Schnellerfassung im selben Moment, in dem sie aufgeht.
    if (Date.now() - quickShownAt < 350) return;
    quickWindow.hide();
  });

  quickWindow.on('closed', () => {
    quickWindow = null;
    quickReady = null;
  });
}

/**
 * Mittig oben auf dem Bildschirm, auf dem gerade die Maus steht. Die Masse
 * wachsen mit der Zoomstufe, weil Chromium den Zoom je Herkunft fuehrt und die
 * Karte sonst aus ihrem Rahmen liefe. Alle Werte sind DIP - eine Skalierung
 * ungleich 100 % rechnet Electron selbst um.
 */
function quickBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const factor = zoomFactorOf(settings ? settings.get('zoom') : 0);
  const width = Math.round(Math.min(QUICK_WIDTH * factor, Math.max(320, area.width - 40)));
  const height = Math.round(Math.min(QUICK_HEIGHT * factor, area.height));
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(Math.min(area.y + area.height * 0.22, area.y + area.height - height)),
  };
}

async function showQuickWindow() {
  try {
    if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
    // Beim allerersten Aufruf ist der Inhalt noch nicht da; ohne das Warten
    // ginge der Fokus-Befehl ins Leere und das Feld bliebe tot.
    await quickReady;
    if (!quickWindow || quickWindow.isDestroyed()) return;

    quickShownAt = Date.now();
    quickWindow.setBounds(quickBounds());
    quickWindow.show();
    // Zweites Mal nach dem Anzeigen: wandert das Fenster auf einen Bildschirm
    // mit anderer Skalierung, rechnet Windows die Groesse beim Anzeigen um.
    quickWindow.setBounds(quickBounds());
    focusHard(quickWindow);
    quickWindow.webContents.send('quick:focus');
    checkDayChange('schnellerfassung');
  } catch (err) {
    // Der Aufruf haengt am globalen Kuerzel - ein Fehler darf hier nicht als
    // unbehandelte Ablehnung im Nichts landen.
    console.error('[main] Schnellerfassung liess sich nicht oeffnen:', err.message);
    notice('schnellerfassung', 'warn', `Die Schnellerfassung ließ sich nicht öffnen: ${err.message}`);
  }
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
  const clear = () => {
    // Die alte Warnung muss weg, sobald es wieder klappt - und zwar in allen
    // Fenstern, nicht erst beim naechsten zufaelligen Statuswechsel.
    if (notices.delete('kuerzel')) broadcast('status:changed', appStatus());
  };

  if (!settings.get('globalShortcutEnabled')) {
    clear();
    return { ok: true, registered: false };
  }

  const accelerator = settings.get('globalShortcut');
  if (!accelerator) {
    clear();
    return { ok: true, registered: false };
  }

  const fail = (reason) => {
    notice(
      'kuerzel',
      'warn',
      `Das globale Tastenkürzel „${accelerator}" ließ sich nicht belegen (${reason}). ` +
        'In den Einstellungen lässt sich ein anderes wählen.'
    );
    return { ok: false, registered: false, reason };
  };

  try {
    const ok = globalShortcut.register(accelerator, showQuickWindow);
    if (!ok) {
      console.warn(`[main] Tastenkuerzel ${accelerator} ist belegt.`);
      return fail('belegt');
    }
    clear();
    return { ok: true, registered: true };
  } catch (err) {
    console.error('[main] Tastenkuerzel ungueltig:', err.message);
    return fail('ungültig');
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
        // Bewusst nicht die Standard-Rollen: die aendern den Zoom nur fluechtig.
        // So merkt sich die App die Stufe und stellt sie beim naechsten Start
        // wieder her - wichtig fuer alle, die 125 % brauchen.
        { label: 'Zoom zurücksetzen', accelerator: 'CmdOrCtrl+0', click: () => setZoom(0) },
        { label: 'Größer', accelerator: 'CmdOrCtrl+Plus', click: () => setZoom(currentZoom().level + 0.5) },
        { label: 'Größer ', accelerator: 'CmdOrCtrl+=', visible: false, click: () => setZoom(currentZoom().level + 0.5) },
        { label: 'Kleiner', accelerator: 'CmdOrCtrl+-', click: () => setZoom(currentZoom().level - 0.5) },
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
  const own = notices.delete(code);
  // Ohne die Meldung an alle Fenster bliebe die weggeklickte Warnung im zweiten
  // Fenster stehen - und nach einem Neuladen auch im ersten wieder.
  if (own) broadcast('status:changed', appStatus());
  return own || (store ? store.dismissProblem(code) : false);
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
  // Waehrend des Beendens waere ein Dialog nur noch im Weg - und blockierte
  // im schlimmsten Fall den letzten Schreibvorgang.
  if (quitting) return;
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
  // Einmal pro Sitzung statt einmal pro Fenster: die Handler haengen an der
  // Sitzung, mehrfaches Setzen wuerde sich nur gegenseitig ersetzen.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      // Auch innerhalb von file:// nur unsere eigenen Seiten - ein versehentlich
      // angeklickter Pfad soll nicht den Rest der Festplatte in die App holen.
      const allowed = url.startsWith('file://') && insideRenderer(url);
      if (allowed) return;
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    });

    // Neue Fenster gibt es nicht - Links gehen in den Browser des Systems.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());

    contents.on('render-process-gone', (_e, details) => {
      console.error('[main] Renderer beendet:', details.reason);
      if (quitting) return;
      if (contents !== (mainWindow && mainWindow.webContents)) return;

      // Neu laden hilft bei einem einmaligen Absturz. Stuerzt der Renderer aber
      // reproduzierbar beim Laden ab, wuerde dieselbe Zeile eine Endlosschleife
      // aus Absturz und Neustart bauen - dann lieber stehen bleiben und es sagen.
      const now = Date.now();
      if (now - crashes.since > 60000) {
        crashes.since = now;
        crashes.count = 0;
      }
      crashes.count++;
      if (crashes.count > 3) {
        notice(
          'absturz',
          'error',
          'Die Oberfläche ist mehrfach hintereinander abgestürzt. Bitte Tagwerk neu starten; ' +
            'die Daten liegen unverändert im Datenordner.'
        );
        return;
      }
      contents.reload();
    });
  });
}

/** Liegt die URL innerhalb unseres Renderer-Ordners? */
function insideRenderer(url) {
  try {
    let name = decodeURIComponent(new URL(url).pathname);
    // Unter Windows steht in pathname '/C:/...' - der fuehrende Schraegstrich muss weg.
    if (/^\/[A-Za-z]:/.test(name)) name = name.slice(1);
    const file = path.resolve(name);
    const root = path.resolve(RENDERER);
    return file === root || file.startsWith(root + path.sep);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------- Hilfsmittel

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * Gebuendelter Aufruf. `.flush()` zieht einen ausstehenden Aufruf sofort vor -
 * ohne das ginge beim Beenden die letzte Aenderung verloren, weil der Zeitgeber
 * mit dem Prozess stirbt.
 */
function debounce(fn, ms) {
  let timer = null;
  let pending = null;
  const run = (...args) => {
    if (timer) clearTimeout(timer);
    pending = args;
    timer = setTimeout(() => {
      timer = null;
      const call = pending;
      pending = null;
      fn(...call);
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
  };
  run.flush = () => {
    if (!timer) return false;
    clearTimeout(timer);
    timer = null;
    const call = pending || [];
    pending = null;
    try {
      fn(...call);
    } catch (err) {
      console.warn('[main] Nachziehen fehlgeschlagen:', err.message);
    }
    return true;
  };
  run.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return run;
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
    // Tageswechsel: der Renderer fragt beim Start einmal nach und bekommt
    // danach 'day:changed' geschickt.
    today: () => Dates.todayKey(),
    checkDayChange,
    setZoom,
    currentZoom,
    applyZoom,
  };
}

// ------------------------------------------------------------- App-Lifecycle

/** Alles Ausstehende auf die Platte. Mehrfach aufrufbar - beides ist idempotent. */
function flushAll() {
  try {
    // Zuerst die noch nicht uebernommene Fenstergroesse: sie landet ueber
    // settings.set() in den Werten, die gleich geschrieben werden.
    if (flushBounds) flushBounds();
  } catch (err) {
    console.warn('[main] Fensterposition konnte nicht uebernommen werden:', err.message);
  }
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
  if (dayTimer) clearTimeout(dayTimer);
  dayTimer = null;
  // Zeitgeber und Listener abraeumen: sonst kann ein spaeter Wiederholungs-
  // versuch des Stores noch waehrend des Beendens Dateien anfassen.
  try {
    if (store) store.dispose();
  } catch {
    /* egal, der Prozess geht ohnehin */
  }
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
