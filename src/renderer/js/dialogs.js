/*
 * Dialoge: Einstellungen, Export und Hilfe.
 */
window.Dialogs = (function () {
  const { h } = Util;
  const api = window.tagwerk;

  let dialogCount = 0;

  /**
   * Grundgeruest fuer alle Dialoge. Gibt {dialog, body, foot, close} zurueck.
   *
   * Das native <dialog> haelt den Fokus von sich aus im Dialog und schliesst
   * bei Esc. Ergaenzt wird hier nur, was es nicht mitbringt: sinnvoller
   * Startfokus und der Weg zurueck zum ausloesenden Bedienelement.
   */
  function makeDialog(title, options = {}) {
    const opener = document.activeElement;
    const titleId = 'dialogTitle' + ++dialogCount;

    const body = h('div', { class: 'dialog__body' });
    const foot = h('div', { class: 'dialog__foot' });
    const closeBtn = h('button', { class: 'iconbtn', type: 'button', title: 'Schließen (Esc)', 'aria-label': 'Schließen' }, '×');

    const dialog = h('dialog', { class: 'dialog' + (options.wide ? ' dialog--wide' : ''), 'aria-labelledby': titleId },
      h('div', { class: 'dialog__inner' },
        h('header', { class: 'dialog__head' },
          h('h2', { id: titleId }, title),
          closeBtn
        ),
        body,
        foot
      )
    );

    const close = () => dialog.close();
    closeBtn.addEventListener('click', close);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (opener && document.contains(opener)) opener.focus();
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    // Der Inhalt wird erst nach dieser Funktion eingehaengt - deshalb den
    // Startfokus im naechsten Frame setzen.
    requestAnimationFrame(() => {
      const first = dialog.querySelector('.dialog__body select, .dialog__body input, .dialog__body button');
      (first || closeBtn).focus();
    });

    return { dialog, body, foot, close };
  }

  // ------------------------------------------------------------ Einstellungen

  /**
   * Standardwerte, die "Zurücksetzen" wiederherstellt.
   * Spiegelt DEFAULTS aus src/main/settings.js - ohne Fensterposition,
   * die soll ein Zuruecksetzen der Optionen nicht anfassen.
   */
  const SETTINGS_DEFAULTS = {
    theme: 'system',
    globalShortcut: 'CommandOrControl+Alt+T',
    globalShortcutEnabled: true,
    showWeekend: false,
    closeToTray: true,
    launchAtLogin: false,
    confirmDelete: false,
  };

  function openSettings() {
    const s = State.get().settings;
    const { body, foot, close } = makeDialog('Einstellungen');

    // --- Darstellung ---
    const themeSelect = h('select', { class: 'field', 'aria-label': 'Design' },
      h('option', { value: 'system', selected: s.theme === 'system' }, 'System folgen'),
      h('option', { value: 'light', selected: s.theme === 'light' }, 'Hell'),
      h('option', { value: 'dark', selected: s.theme === 'dark' }, 'Dunkel')
    );
    themeSelect.addEventListener('change', () => State.saveSettings({ theme: themeSelect.value }));

    const weekend = checkbox(
      'Wochenende in der Wochenansicht zeigen',
      s.showWeekend,
      (v) => State.saveSettings({ showWeekend: v }),
      'Aus: Montag bis Freitag. An: die ganze Woche, Samstag und Sonntag angegraut.'
    );

    // --- Verhalten ---
    const closeToTray = checkbox(
      'Beim Schließen nur in den Infobereich legen',
      s.closeToTray,
      (v) => State.saveSettings({ closeToTray: v }),
      'Tagwerk läuft weiter und bleibt über das Tray-Symbol und das globale Tastenkürzel erreichbar.'
    );
    const confirmDelete = checkbox(
      'Vor dem Löschen nachfragen',
      s.confirmDelete,
      (v) => State.saveSettings({ confirmDelete: v }),
      'Ohne Nachfrage lässt sich das Löschen über die Meldung unten rechts rückgängig machen.'
    );
    const autostart = checkbox(
      'Mit dem System starten',
      s.launchAtLogin,
      (v) => State.saveSettings({ launchAtLogin: v }),
      'Startet Tagwerk beim Anmelden unsichtbar im Infobereich. Wirkt nur in der installierten App.'
    );

    // --- globales Tastenkuerzel ---
    const shortcutInput = h('input', {
      class: 'field field--shortcut',
      type: 'text',
      value: s.globalShortcut,
      readonly: 'readonly',
      'aria-label': 'Globales Tastenkürzel',
      placeholder: 'Tastenkombination drücken …',
    });
    const shortcutState = h('p', { class: 'settings__state' }, 'Kürzel wird geprüft …');

    /** Zeigt an, ob das Kuerzel beim Betriebssystem wirklich angekommen ist. */
    function showShortcutState(result) {
      const enabled = State.get().settings.globalShortcutEnabled;
      const accel = State.get().settings.globalShortcut;
      shortcutState.classList.remove('is-ok', 'is-warn', 'is-off');

      if (!enabled) {
        shortcutState.classList.add('is-off');
        shortcutState.textContent = 'Ausgeschaltet – die Schnellerfassung ist nur aus Tagwerk heraus erreichbar.';
        return;
      }
      if (result && result.registered) {
        shortcutState.classList.add('is-ok');
        shortcutState.textContent = `Aktiv: ${prettyAccelerator(accel)} wirkt systemweit.`;
        return;
      }
      shortcutState.classList.add('is-warn');
      shortcutState.textContent =
        `Nicht registriert – ${prettyAccelerator(accel)} ist ` +
        `${(result && result.reason) || 'nicht nutzbar'}. Bitte eine andere Kombination wählen.`;
    }

    shortcutInput.addEventListener('keydown', (ev) => {
      ev.preventDefault();
      const accel = toAccelerator(ev);
      if (!accel) return;
      shortcutInput.value = accel;
      State.saveSettings({ globalShortcut: accel }).then((res) => showShortcutState(res.shortcut));
    });

    const shortcutEnabled = checkbox(
      'Globales Tastenkürzel für die Schnellerfassung',
      s.globalShortcutEnabled,
      (v) => {
        shortcutInput.disabled = !v;
        State.saveSettings({ globalShortcutEnabled: v }).then((res) => showShortcutState(res.shortcut));
      },
      'Öffnet das kleine Erfassungsfenster aus jedem Programm heraus.'
    );
    shortcutInput.disabled = !s.globalShortcutEnabled;

    // Einmal neu registrieren lassen: nur so laesst sich sagen, ob das
    // Kuerzel gerade wirklich greift oder ob es jemand anderes belegt.
    State.saveSettings({ globalShortcutEnabled: s.globalShortcutEnabled }).then((res) =>
      showShortcutState(res.shortcut)
    );

    body.append(
      group('Darstellung', field('Design', themeSelect), weekend),
      group('Schnellerfassung',
        shortcutEnabled,
        field('Tastenkürzel', shortcutInput),
        hint('Feld anklicken und die gewünschte Kombination drücken, z. B. Strg + Alt + T.'),
        shortcutState),
      group('Verhalten', closeToTray, confirmDelete, autostart),
      group('Daten',
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: () => api.openDataFolder() }, 'Datenordner öffnen'),
          h('button', { class: 'btn', type: 'button', onclick: () => { close(); openExport(); } }, 'Exportieren …'),
          h('button', { class: 'btn', type: 'button', onclick: () => importData('merge') }, 'Importieren …')
        ),
        hint('Alle Aufgaben liegen in einer einzigen JSON-Datei. Zum Sichern reicht es, den Ordner zu kopieren. ' +
          'Importieren ergänzt die Datei um alles, was noch nicht da ist.')
      ),
      infoBlock()
    );

    foot.append(
      h('button', {
        class: 'btn btn--danger-ghost', type: 'button',
        title: 'Alle Optionen auf den Auslieferungszustand zurücksetzen',
        onclick: async () => {
          if (!window.confirm('Alle Einstellungen auf die Standardwerte zurücksetzen?')) return;
          await State.saveSettings({ ...SETTINGS_DEFAULTS });
          Util.toast('Einstellungen zurückgesetzt');
          close();
          openSettings();
        },
      }, 'Zurücksetzen'),
      h('div', { class: 'row__spacer' }),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: close }, 'Fertig')
    );
  }

  /** 'CommandOrControl+Alt+T' -> 'Strg + Alt + T' */
  function prettyAccelerator(accel) {
    return String(accel || '')
      .replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Strg')
      .replace(/Shift/g, 'Umschalt')
      .split('+')
      .join(' + ');
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

  /**
   * Die Formatliste kommt aus dem Exporter selbst - so taucht ein dort
   * ergaenztes Format ohne weiteres Zutun im Dialog auf.
   */
  function exportFormats() {
    return Exporter.FORMATS;
  }

  /** Nur die Berichtsformate lassen sich sinnvoll gruppieren. */
  function supportsGrouping(formatId) {
    return formatId === 'md' || formatId === 'html';
  }

  function openExport() {
    const state = State.get();
    const formats = exportFormats();
    const { body, foot, close } = makeDialog('Exportieren');

    const scopeSelect = h('select', { class: 'field', 'aria-label': 'Bereich' },
      h('option', { value: 'tag', selected: state.view === 'tag' }, `Tag – ${Dates.formatNumeric(state.cursorDay)}`),
      h('option', { value: 'woche', selected: state.view === 'woche' }, `Woche – ${Dates.isoWeekLabel(state.cursorDay)}`),
      h('option', { value: 'alle' }, 'Alles')
    );

    const formatSelect = h('select', { class: 'field', 'aria-label': 'Format' },
      ...formats.map((f) => h('option', { value: f.id }, f.label))
    );

    const groupSelect = h('select', { class: 'field', 'aria-label': 'Gruppierung' },
      ...Exporter.GROUPINGS.map((g) => h('option', { value: g.id }, g.label))
    );
    const groupField = field('Gliederung', groupSelect);

    const preview = h('pre', { class: 'dialog__preview', tabindex: '0', 'aria-label': 'Vorschau' });
    const fileHint = h('p', { class: 'dialog__hint' });

    const format = () => Exporter.formatById(formatSelect.value);

    function dayKeys() {
      if (scopeSelect.value === 'woche') return State.weekDays();
      if (scopeSelect.value === 'alle') return [...new Set(State.get().items.map((i) => i.day))].sort();
      return [state.cursorDay];
    }

    /** Umfang "Alles" heisst: keine Tagesliste, der Exporter nimmt dann alles. */
    function selection() {
      return scopeSelect.value === 'alle' ? null : dayKeys();
    }

    function options(extra) {
      const opts = { version: 1, ...extra };
      if (supportsGrouping(formatSelect.value)) opts.groupBy = groupSelect.value;
      return opts;
    }

    function buildText(extra) {
      return Exporter.build(formatSelect.value, State.get().items, selection(), options(extra));
    }

    const saveBtn = h('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: async () => {
        const res = await api.exportFile(formatSelect.value, dayKeys(), scopeSelect.value, options());
        if (res.canceled) return;
        if (!res.ok) Util.toast(res.error || 'Export fehlgeschlagen', { tone: 'error' });
        else Util.toast('Gespeichert: ' + res.path);
        close();
      },
    }, 'Als Datei speichern');

    function refresh() {
      const text = buildText();
      const count = text ? text.split('\n').length : 0;
      preview.textContent = text.length > 4000 ? text.slice(0, 4000) + '\n…' : text || '(nichts zu exportieren)';

      // Ueber style statt [hidden]: die Felder sind Flex-Container, da greift
      // das hidden-Attribut nicht.
      groupField.style.display = supportsGrouping(formatSelect.value) ? '' : 'none';
      saveBtn.disabled = !text;
      fileHint.textContent =
        formatSelect.value === 'html'
          ? 'Wird formatiert eingefügt – in einer Outlook-Mail einfach Strg + V.'
          : `${Util.plural(count, 'Zeile', 'Zeilen')} · Speichern fragt nach dem Ort.`;
    }

    scopeSelect.addEventListener('change', refresh);
    formatSelect.addEventListener('change', refresh);
    groupSelect.addEventListener('change', refresh);
    refresh();

    body.append(
      group('Umfang', field('Bereich', scopeSelect), field('Format', formatSelect), groupField, fileHint),
      group('Vorschau', preview)
    );

    foot.append(
      h('div', { class: 'row__spacer' }),
      h('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          const text = buildText();
          if (!text) {
            Util.toast('Nichts zu kopieren', { tone: 'error' });
            return;
          }
          // Beim HTML-Bericht wandert zusaetzlich der Klartext mit, damit auch
          // ein einfaches Textfeld etwas Lesbares bekommt.
          if (formatSelect.value === 'html') {
            await api.copyToClipboard(
              Exporter.build('md', State.get().items, selection(), options()),
              buildText({ fragment: true })
            );
          } else {
            await api.copyToClipboard(text);
          }
          Util.toast('In die Zwischenablage kopiert');
          close();
        },
      }, 'In Zwischenablage'),
      saveBtn
    );
  }

  /** Kopiert Markdown *und* HTML - Outlook nimmt das formatierte, Notepad den Text. */
  async function copyRange(days, label) {
    const items = State.get().items;
    await api.copyToClipboard(
      Exporter.build('md', items, days),
      Exporter.html(items, days, { fragment: true })
    );
    Util.toast(label);
  }

  async function copyDay(day) {
    await copyRange([day], `${Dates.relativeLabel(day)} in die Zwischenablage kopiert`);
  }

  async function copyWeek(days) {
    await copyRange(days, 'Woche in die Zwischenablage kopiert');
  }

  // --------------------------------------------------------------- Hilfe

  function openHelp() {
    const { body, foot, close } = makeDialog('Kurzanleitung', { wide: true });

    // Die Quellenliste kommt aus dem Modell - so kann sie nicht veralten.
    const sourceList = Model.SOURCES.map((s) => '@' + s.id).join(' ');

    const syntax = [
      ['@quelle', 'Woher kam die Aufgabe: ' + sourceList + ' (Kurzformen wie @out oder @snow gehen auch)'],
      ['#tag', 'Beliebig viele Schlagworte, z. B. #netzwerk'],
      ['!  /  !!', 'Priorität hoch bzw. dringend'],
      ['>tag', 'Zieltag: >heute >morgen >uebermorgen, >mo … >so, >+3, >24.12., >2026-12-24'],
      ['>nächste woche', 'Auch in Worten: >ende der woche, >nächsten montag, >kw35, >monatsende, >in 3 tagen, >in 2 wochen'],
      ['INC0012345', 'Ticketnummern (INC, RITM, REQ, CHG, PRB, SR, SCTASK, CTASK, TASK, KB) werden als Referenz erkannt und setzen die Quelle auf Ticket – auch aus einem eingefügten ServiceNow- oder Jira-Link'],
    ];

    const listKeys = [
      ['↑  /  ↓', 'Durch die Aufgaben blättern (in der Wochenansicht auch ← / →)'],
      ['Leertaste', 'Erledigt / wieder offen'],
      ['Enter', 'Auf- und zuklappen'],
      ['e', 'Bearbeiten'],
      ['m', 'Einen Tag weiterschieben (Liegengebliebenes auf heute)'],
      ['x', 'Aufgabe auswählen – mehrere auf einmal bearbeiten'],
      ['Umschalt + ↑ / ↓', 'Mehrere Aufgaben am Stück auswählen'],
      ['Entf', 'Löschen (mit Rückgängig-Hinweis)'],
    ];

    const keys = [
      ['Strg + N', 'Cursor in die Erfassungszeile'],
      ['Tab', 'In der Erfassungszeile: nächster Vorschlag für @quelle / #tag'],
      ['Strg + Umschalt + N', 'Schnellerfassung öffnen'],
      ['Strg + F', 'Suchen'],
      ['Strg + Umschalt + F', 'Alle Filter zurücksetzen'],
      ['Strg + 1  /  Strg + 2', 'Tages- / Wochenansicht'],
      ['Strg + E', 'Exportieren'],
      ['Strg + ,', 'Einstellungen'],
      ['Alt + ←  /  Alt + →', 'Einen Tag bzw. eine Woche zurück / vor'],
      ['Alt + ↓', 'Zurück zu heute'],
      ['F1', 'Diese Kurzanleitung'],
      ['Esc', 'Vorschlag verwerfen, Feld leeren, Filter zurücksetzen, Dialog schließen'],
    ];

    const quickKeys = [
      ['Enter', 'Speichern – das Fenster verschwindet wieder'],
      ['Umschalt + Enter', 'Speichern und für die nächste Aufgabe offen bleiben'],
      ['Tab', 'Nächster Vorschlag für @quelle / #tag'],
      ['↑  /  ↓', 'Zuletzt erfasste Zeilen durchblättern'],
      ['Esc', 'Schließen'],
    ];

    const table = (rows) =>
      h('table', { class: 'helptable' },
        h('tbody', null, ...rows.map(([k, v]) => h('tr', null, h('td', null, h('code', null, k)), h('td', null, v))))
      );

    body.append(
      group('Alles in eine Zeile tippen', table(syntax),
        hint('Beispiel: Switch im Serverraum tauschen @muendlich #netzwerk ! >morgen'),
        hint('Was nicht erkannt wird, bleibt Teil des Titels – „Umsatz >1000 prüfen" wandert also nirgendwohin. ' +
          'Unter dem Feld steht live, was erkannt wurde.')),
      group('Tastenkürzel', table(keys)),
      group('In der Liste', table(listKeys),
        hint('Gilt, sobald eine Karte den Fokus hat – einmal hineinklicken oder mit Tab dorthin wechseln.')),
      group('Schnellerfassung', table(quickKeys),
        hint('Das kleine Fenster erscheint über allem anderen – auch wenn Tagwerk im Hintergrund läuft. ' +
          'Das systemweite Kürzel dafür steht in den Einstellungen; dort ist auch zu sehen, ob es wirklich greift.')),
      group('Aufgaben verschieben',
        hint('In der Wochenansicht lassen sich Aufgaben zwischen den Tagen ziehen. Der Pfeil ⟶ auf einer Karte schiebt sie einen Tag weiter. ' +
          'In der Tagesansicht holt „Alle herholen" alles Liegengebliebene aus früheren Tagen auf den angezeigten Tag.'))
    );

    foot.append(
      h('div', { class: 'row__spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: () => { close(); openSettings(); } }, 'Einstellungen …'),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: close }, 'Alles klar')
    );
  }

  // ----------------------------------------------------------- Bausteine

  function group(title, ...children) {
    return h('section', { class: 'dialog__group' }, h('h3', null, title), ...children);
  }

  function field(label, control) {
    return h('label', { class: 'dialog__field' }, h('span', null, label), control);
  }

  function checkbox(label, checked, onChange, description) {
    const input = h('input', { type: 'checkbox', checked });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'dialog__check' },
      input,
      h('div', { class: 'dialog__checkText' },
        h('div', null, label),
        description ? h('div', { class: 'dialog__hint dialog__checkHint' }, description) : null
      )
    );
  }

  function hint(text) {
    return h('p', { class: 'dialog__hint' }, text);
  }

  return { openSettings, openExport, openHelp, copyDay, copyWeek };
})();
