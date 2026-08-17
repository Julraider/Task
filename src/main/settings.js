'use strict';

/**
 * Einstellungen + Fensterposition, gespeichert als eigene JSON-Datei
 * (getrennt von den Aufgaben, damit ein kaputter Datensatz nicht die
 * Einstellungen mitreisst und umgekehrt).
 *
 * Geschrieben wird wie beim Store atomar (tmp + fsync + rename) und gebuendelt:
 * beim Ziehen eines Fensters kommen sonst dutzende Schreibvorgaenge pro Sekunde
 * zusammen. Beim Beenden sorgt flush() dafuer, dass nichts liegen bleibt.
 */

const fs = require('fs');
const path = require('path');

const { describeFsError, writeDurable, fsyncDir, jsonSafe } = require('./store');

const SAVE_DEBOUNCE_MS = 250;

const DEFAULTS = {
  theme: 'system', // 'system' | 'light' | 'dark'
  globalShortcut: 'CommandOrControl+Alt+T',
  globalShortcutEnabled: true,
  showWeekend: false, // Wochenansicht: Mo-Fr oder Mo-So
  closeToTray: true, // Fenster schliessen = in den Tray legen
  launchAtLogin: false,
  confirmDelete: false,
  backupKeepDays: 14, // Tagessicherungen, die aufgehoben werden
  window: { width: 1080, height: 760, x: null, y: null, maximized: false },
};

const bool = (v) => (typeof v === 'boolean' ? v : undefined);

function int(min, max) {
  return (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(min, Math.min(max, Math.round(n)));
  };
}

function coord(v) {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/**
 * Bekannte Schluessel werden geprueft, unbekannte durchgereicht - so kann die
 * Oberflaeche neue Einstellungen einfuehren, ohne dass hier etwas nachgezogen
 * werden muss. Ein ungueltiger Wert wird verworfen, nicht uebernommen: eine
 * kaputte Einstellung ist schlimmer als der Standardwert.
 */
const CHECKS = {
  theme: (v) => (['system', 'light', 'dark'].includes(v) ? v : undefined),
  globalShortcut: (v) => (typeof v === 'string' && v.length <= 100 ? v.trim() : undefined),
  globalShortcutEnabled: bool,
  showWeekend: bool,
  closeToTray: bool,
  launchAtLogin: bool,
  confirmDelete: bool,
  backupKeepDays: int(1, 365),
};

function sanitizeWindow(win, current) {
  const src = win && typeof win === 'object' ? win : {};
  const out = { ...current };
  const width = int(400, 10000)(src.width);
  const height = int(300, 10000)(src.height);
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  if ('x' in src) {
    const x = coord(src.x);
    if (x !== undefined) out.x = x;
  }
  if ('y' in src) {
    const y = coord(src.y);
    if (y !== undefined) out.y = y;
  }
  if ('maximized' in src) out.maximized = !!src.maximized;
  return out;
}

class Settings {
  constructor(filePath) {
    this.filePath = filePath;
    this.tmpPath = filePath + '.tmp';
    this.backupPath = filePath + '.bak';
    this.values = defaults();
    this._timer = null;
    this._dirty = false;
    this.lastError = null;
  }

  load() {
    const parsed = this._read(this.filePath) || this._read(this.backupPath);
    if (parsed) this.values = merge(defaults(), parsed);
    return this;
  }

  _read(file) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[settings] Konnte nicht gelesen werden, nutze Standardwerte:', err.message);
      }
      return null;
    }
  }

  /** Gebuendelt speichern - der Aufrufer muss sich um die Frequenz nicht kuemmern. */
  save() {
    this._dirty = true;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  /** Sofort schreiben (beim Beenden). */
  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._dirty) return true;

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeDurable(this.tmpPath, JSON.stringify(this.values, null, 2));
      if (fs.existsSync(this.filePath)) {
        try {
          fs.copyFileSync(this.filePath, this.backupPath);
        } catch {
          /* ohne .bak geht es zur Not auch */
        }
      }
      fs.renameSync(this.tmpPath, this.filePath);
      fsyncDir(path.dirname(this.filePath));
      this._dirty = false;
      this.lastError = null;
      return true;
    } catch (err) {
      try {
        if (fs.existsSync(this.tmpPath)) fs.unlinkSync(this.tmpPath);
      } catch {
        /* dann bleibt die .tmp liegen */
      }
      this.lastError = describeFsError(err);
      console.error('[settings] Speichern fehlgeschlagen:', err.message);
      return false;
    }
  }

  get(key) {
    return key ? this.values[key] : this.values;
  }

  /** Teil-Update; gibt die vollstaendigen Einstellungen zurueck. */
  set(patch) {
    const src = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const next = { ...this.values };

    for (const [key, value] of Object.entries(src)) {
      if (key === 'window') {
        next.window = sanitizeWindow(value, next.window);
        continue;
      }
      if (CHECKS[key]) {
        const clean = CHECKS[key](value);
        if (clean === undefined) {
          console.warn(`[settings] Wert fuer "${key}" verworfen:`, value);
          continue;
        }
        next[key] = clean;
        continue;
      }
      // Unbekannter Schluessel: uebernehmen, aber nur was sich wieder als JSON
      // schreiben laesst - sonst blockiert ein einziger Zirkelbezug das Speichern.
      const clean = jsonSafe(value, 4);
      if (clean !== undefined) next[key] = clean;
    }

    this.values = next;
    this.save();
    return this.values;
  }

  reset() {
    this.values = defaults();
    this.save();
    return this.values;
  }
}

function defaults() {
  return { ...DEFAULTS, window: { ...DEFAULTS.window } };
}

/** Geladene Werte auf die Standardwerte legen und dabei durch die Pruefungen schicken. */
function merge(base, parsed) {
  const out = { ...base, window: { ...base.window } };
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'window') {
      out.window = sanitizeWindow(value, out.window);
      continue;
    }
    if (CHECKS[key]) {
      const clean = CHECKS[key](value);
      if (clean !== undefined) out[key] = clean;
      continue;
    }
    const clean = jsonSafe(value, 4);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

module.exports = { Settings, DEFAULTS };
