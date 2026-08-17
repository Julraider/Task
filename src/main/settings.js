'use strict';

/**
 * Einstellungen + Fensterposition, gespeichert als eigene JSON-Datei
 * (getrennt von den Aufgaben, damit ein kaputter Datensatz nicht die
 * Einstellungen mitreisst und umgekehrt).
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  theme: 'system', // 'system' | 'light' | 'dark'
  globalShortcut: 'CommandOrControl+Alt+T',
  globalShortcutEnabled: true,
  showWeekend: false, // Wochenansicht: Mo-Fr oder Mo-So
  closeToTray: true, // Fenster schliessen = in den Tray legen
  launchAtLogin: false,
  confirmDelete: false,
  window: { width: 1080, height: 760, x: null, y: null, maximized: false },
};

class Settings {
  constructor(filePath) {
    this.filePath = filePath;
    this.values = { ...DEFAULTS };
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.values = {
          ...DEFAULTS,
          ...parsed,
          window: { ...DEFAULTS.window, ...(parsed.window || {}) },
        };
      }
    } catch (err) {
      console.error('[settings] Konnte nicht gelesen werden, nutze Standardwerte:', err.message);
      this.values = { ...DEFAULTS };
    }
    return this;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.values, null, 2), 'utf8');
    } catch (err) {
      console.error('[settings] Speichern fehlgeschlagen:', err.message);
    }
  }

  get(key) {
    return key ? this.values[key] : this.values;
  }

  /** Teil-Update; gibt die vollstaendigen Einstellungen zurueck. */
  set(patch) {
    this.values = { ...this.values, ...patch };
    if (patch.window) this.values.window = { ...this.values.window, ...patch.window };
    this.save();
    return this.values;
  }

  reset() {
    this.values = { ...DEFAULTS, window: { ...DEFAULTS.window } };
    this.save();
    return this.values;
  }
}

module.exports = { Settings, DEFAULTS };
