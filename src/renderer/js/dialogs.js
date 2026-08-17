/*
 * Dialoge: Einstellungen, Export und Hilfe.
 */
window.Dialogs = (function () {
  const { h } = Util;
  const api = window.tagwerk;

  /** Grundgeruest fuer alle Dialoge. Gibt {dialog, body, close} zurueck. */
  function makeDialog(title, options = {}) {
    const body = h('div', { class: 'dialog__body' });
    const dialog = h('dialog', { class: 'dialog' + (options.wide ? ' dialog--wide' : '') },
      h('form', { method: 'dialog', class: 'dialog__inner' },
        h('header', { class: 'dialog__head' },
          h('h2', null, title),
          h('button', { class: 'iconbtn', value: 'close', title: 'Schließen' }, '×')
        ),
        body
      )
    );

    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();

    return { dialog, body, close: () => dialog.close() };
  }

  // ------------------------------------------------------------ Einstellungen

  function openSettings() {
    const s = State.get().settings;
    const { body, close } = makeDialog('Einstellungen');

    const themeSelect = h('select', { class: 'field' },
      h('option', { value: 'system', selected: s.theme === 'system' }, 'System folgen'),
      h('option', { value: 'light', selected: s.theme === 'light' }, 'Hell'),
      h('option', { value: 'dark', selected: s.theme === 'dark' }, 'Dunkel')
    );
    themeSelect.addEventListener('change', () => State.saveSettings({ theme: themeSelect.value }));

    const weekend = checkbox('Wochenende in der Wochenansicht zeigen', s.showWeekend, (v) =>
      State.saveSettings({ showWeekend: v })
    );
    const closeToTray = checkbox('Beim Schließen nur in den Infobereich legen', s.closeToTray, (v) =>
      State.saveSettings({ closeToTray: v })
    );
    const confirmDelete = checkbox('Vor dem Löschen nachfragen', s.confirmDelete, (v) =>
      State.saveSettings({ confirmDelete: v })
    );
    const autostart = checkbox('Mit Windows/System starten', s.launchAtLogin, (v) =>
      State.saveSettings({ launchAtLogin: v })
    );

    // --- globales Tastenkuerzel ---
    const shortcutInput = h('input', {
      class: 'field field--shortcut',
      type: 'text',
      value: s.globalShortcut,
      readonly: 'readonly',
      placeholder: 'Tastenkombination drücken …',
    });
    shortcutInput.addEventListener('keydown', (ev) => {
      ev.preventDefault();
      const accel = toAccelerator(ev);
      if (!accel) return;
      shortcutInput.value = accel;
      State.saveSettings({ globalShortcut: accel }).then((res) => {
        if (res.shortcut && res.shortcut.ok === false) {
          Util.toast(`Kürzel ${accel} ist ${res.shortcut.reason || 'nicht nutzbar'}.`, { tone: 'error' });
        } else {
          Util.toast('Tastenkürzel gespeichert');
        }
      });
    });

    const shortcutEnabled = checkbox('Globales Tastenkürzel für die Schnellerfassung', s.globalShortcutEnabled, (v) => {
      State.saveSettings({ globalShortcutEnabled: v });
      shortcutInput.disabled = !v;
    });
    shortcutInput.disabled = !s.globalShortcutEnabled;

    body.append(
      group('Darstellung', field('Design', themeSelect), weekend),
      group('Verhalten', closeToTray, confirmDelete, autostart),
      group('Schnellerfassung', shortcutEnabled, field('Tastenkürzel', shortcutInput),
        hint('Anklicken und die gewünschte Kombination drücken. Wirkt systemweit, auch wenn Tagwerk im Hintergrund läuft.')),
      group('Daten',
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: () => api.openDataFolder() }, 'Datenordner öffnen'),
          h('button', { class: 'btn', type: 'button', onclick: () => { close(); openExport(); } }, 'Exportieren …'),
          h('button', { class: 'btn', type: 'button', onclick: () => importData('merge') }, 'Importieren …')
        ),
        hint('Alle Aufgaben liegen in einer einzigen JSON-Datei. Zum Sichern reicht es, den Ordner zu kopieren.')
      ),
      infoBlock()
    );
  }

  function infoBlock() {
    const box = h('div', { class: 'dialog__info' }, 'Version wird geladen …');
    api.appInfo().then((res) => {
      if (!res.ok) return;
      const i = res.info;
      Util.clear(box);
      box.append(
        h('div', null, `Tagwerk ${i.version}`),
        h('div', { class: 'muted' }, `Electron ${i.electron} · Chromium ${i.chrome} · Node ${i.node}`),
        h('div', { class: 'muted dialog__path', title: i.dataPath }, i.dataPath)
      );
    });
    return box;
  }

  async function importData(mode) {
    const res = await api.importFile(mode);
    if (res.canceled) return;
    if (!res.ok) {
      Util.toast(res.error || 'Import fehlgeschlagen', { tone: 'error' });
      return;
    }
    Util.toast(`${Util.plural(res.count, 'Aufgabe', 'Aufgaben')} ${res.mode}`);
  }

  /** KeyboardEvent -> Electron-Accelerator */
  function toAccelerator(ev) {
    const key = ev.key;
    if (['Control', 'Alt', 'Shift', 'Meta', 'Dead'].includes(key)) return null;

    const parts = [];
    if (ev.ctrlKey || ev.metaKey) parts.push('CommandOrControl');
    if (ev.altKey) parts.push('Alt');
    if (ev.shiftKey) parts.push('Shift');
    if (!parts.length) return null; // ohne Modifier waere das Kuerzel unbrauchbar

    let name = key.length === 1 ? key.toUpperCase() : key;
    const special = {
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      ' ': 'Space', Escape: 'Esc', Enter: 'Return',
    };
    if (special[name]) name = special[name];

    parts.push(name);
    return parts.join('+');
  }

  // -------------------------------------------------------------- Export

  function openExport() {
    const state = State.get();
    const { body, close } = makeDialog('Exportieren');

    const scopeSelect = h('select', { class: 'field' },
      h('option', { value: 'tag', selected: state.view === 'tag' }, `Tag – ${Dates.formatNumeric(state.cursorDay)}`),
      h('option', { value: 'woche', selected: state.view === 'woche' }, `Woche – ${Dates.isoWeekLabel(state.cursorDay)}`),
      h('option', { value: 'alle' }, 'Alles')
    );

    const formatSelect = h('select', { class: 'field' },
      h('option', { value: 'md' }, 'Markdown (Text, z. B. für Mail oder Wochenbericht)'),
      h('option', { value: 'csv' }, 'CSV (Excel)'),
      h('option', { value: 'json' }, 'JSON (Sicherung / Wiederimport)')
    );

    const preview = h('pre', { class: 'dialog__preview' });

    function dayKeys() {
      if (scopeSelect.value === 'woche') return State.weekDays();
      if (scopeSelect.value === 'alle') return [...new Set(State.get().items.map((i) => i.day))].sort();
      return [state.cursorDay];
    }

    function buildText() {
      const items = State.get().items;
      const keys = dayKeys();
      if (formatSelect.value === 'csv') {
        return Exporter.csv(scopeSelect.value === 'alle' ? items : items.filter((i) => keys.includes(i.day)));
      }
      if (formatSelect.value === 'json') {
        const subset = scopeSelect.value === 'alle' ? items : items.filter((i) => keys.includes(i.day));
        return JSON.stringify({ version: 1, items: subset }, null, 2);
      }
      return keys.length === 1 ? Exporter.dayMarkdown(items, keys[0]) : Exporter.weekMarkdown(items, keys);
    }

    function refresh() {
      const text = buildText();
      preview.textContent = text.length > 4000 ? text.slice(0, 4000) + '\n…' : text;
    }

    scopeSelect.addEventListener('change', refresh);
    formatSelect.addEventListener('change', refresh);
    refresh();

    body.append(
      group('Umfang', field('Bereich', scopeSelect), field('Format', formatSelect)),
      group('Vorschau', preview),
      h('div', { class: 'row row--end' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            await api.copyToClipboard(buildText());
            Util.toast('In die Zwischenablage kopiert');
            close();
          },
        }, 'In Zwischenablage'),
        h('button', {
          class: 'btn btn--primary', type: 'button',
          onclick: async () => {
            const res = await api.exportFile(formatSelect.value, dayKeys(), scopeSelect.value);
            if (res.canceled) return;
            if (!res.ok) Util.toast(res.error || 'Export fehlgeschlagen', { tone: 'error' });
            else Util.toast('Gespeichert: ' + res.path);
            close();
          },
        }, 'Als Datei speichern')
      )
    );
  }

  async function copyDay(day) {
    await api.copyToClipboard(Exporter.dayMarkdown(State.get().items, day));
    Util.toast(`${Dates.relativeLabel(day)} in die Zwischenablage kopiert`);
  }

  async function copyWeek(days) {
    await api.copyToClipboard(Exporter.weekMarkdown(State.get().items, days));
    Util.toast('Woche in die Zwischenablage kopiert');
  }

  // --------------------------------------------------------------- Hilfe

  function openHelp() {
    const { body } = makeDialog('Kurzanleitung', { wide: true });

    const syntax = [
      ['@teams', 'Quelle setzen: @teams @mail @ticket @muendlich @telefon @meeting @selbst'],
      ['#tag', 'Beliebig viele Schlagworte, z. B. #netzwerk'],
      ['! / !!', 'Priorität hoch bzw. dringend'],
      ['>morgen', 'Zieltag: >heute >morgen >uebermorgen >mo …>so >+3 >17.08.'],
      ['INC0012345', 'Ticketnummern werden automatisch als Referenz erkannt'],
    ];

    const keys = [
      ['Strg + N', 'Cursor in die Erfassungszeile'],
      ['Strg + Umschalt + N', 'Schnellerfassung (auch außerhalb der App)'],
      ['Strg + F', 'Suchen'],
      ['Strg + 1 / 2', 'Tages- / Wochenansicht'],
      ['Strg + E', 'Exportieren'],
      ['Alt + ← / →', 'Tag bzw. Woche zurück / vor'],
      ['Alt + ↓', 'Zurück zu heute'],
      ['Esc', 'Suche leeren / Bearbeitung abbrechen'],
    ];

    const table = (rows) =>
      h('table', { class: 'helptable' },
        h('tbody', null, ...rows.map(([k, v]) => h('tr', null, h('td', null, h('code', null, k)), h('td', null, v))))
      );

    body.append(
      group('Alles in eine Zeile tippen', table(syntax),
        hint('Beispiel: Switch im Serverraum tauschen @muendlich #netzwerk ! >morgen')),
      group('Tastenkürzel', table(keys)),
      group('Aufgaben verschieben',
        hint('In der Wochenansicht lassen sich Aufgaben zwischen den Tagen ziehen. Der Pfeil ⟶ auf einer Karte schiebt sie einen Tag weiter.'))
    );
  }

  // ----------------------------------------------------------- Bausteine

  function group(title, ...children) {
    return h('section', { class: 'dialog__group' }, h('h3', null, title), ...children);
  }

  function field(label, control) {
    return h('label', { class: 'dialog__field' }, h('span', null, label), control);
  }

  function checkbox(label, checked, onChange) {
    const input = h('input', { type: 'checkbox', checked });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'dialog__check' }, input, h('span', null, label));
  }

  function hint(text) {
    return h('p', { class: 'dialog__hint' }, text);
  }

  return { openSettings, openExport, openHelp, copyDay, copyWeek };
})();
