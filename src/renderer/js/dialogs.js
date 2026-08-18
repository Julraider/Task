/*
 * Dialoge: Einstellungen, Export, Hilfe - dazu die Rueckfrage, die vor
 * ueberschreibenden Schritten steht.
 *
 * Form nach docs/design-system.md §5.5: Kopf 44 px mit Titel und
 * Schliessen-Knopf, Inhalt in Gruppen mit Versalien-Ueberschrift und
 * Haarlinie, Fusszeile rechtsbuendig mit der Hauptaktion aussen.
 *
 * Symbole kommen aus dem Icon-Satz (`Icons.svg`). Der Satz wird bewusst nur
 * gefragt, nie vorausgesetzt: fehlt er, bleiben die Knoepfe beschriftet und
 * der Dialog vollstaendig bedienbar.
 */
window.Dialogs = (function () {
  const { h } = Util;
  const api = window.tagwerk;

  let dialogCount = 0;

  // ------------------------------------------------------------- Icon-Satz

  /**
   * Ein Symbol holen. `names` sind Motivkennungen wie in `Model.SOURCES[].iconId`.
   *
   * Kennt der Satz eine Auskunftsfunktion (`has`/`names`), wird der erste
   * *bekannte* Name genommen; sonst nur der erste Vorschlag - ein Satz, der
   * fuer Unbekanntes ein Ersatzmotiv liefert, wuerde sonst ein falsches Bild
   * einsetzen. Kommt nichts zurueck, kommt eben nichts zurueck: `Util.h`
   * ueberspringt `null` und der Knopf traegt allein seine Beschriftung.
   */
  function icon(...names) {
    const set = window.Icons;
    if (!set || typeof set.svg !== 'function') return null;

    const knows =
      typeof set.has === 'function'
        ? (name) => !!set.has(name)
        : Array.isArray(set.names)
          ? (name) => set.names.includes(name)
          : null;

    const wanted = knows ? names.filter(knows) : names.slice(0, 1);
    for (const name of wanted) {
      try {
        const node = set.svg(name);
        if (node instanceof Node) return node;
      } catch (err) {
        /* Diesen Namen kennt der Satz nicht - naechster Versuch. */
      }
    }
    return null;
  }

  // ----------------------------------------------------------- Grundgeruest

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  function focusables(root) {
    return Util.els(FOCUSABLE, root).filter((node) => node.getClientRects().length > 0);
  }

  /**
   * Grundgeruest fuer alle Dialoge.
   *
   * Das native <dialog> bringt Fokusfang und Esc schon mit. Ergaenzt wird
   * hier, was fehlt: ein sinnvoller Startfokus, ein Tabulator, der am Ende
   * wieder vorn anfaengt (§4.4), der Weg zurueck aufs ausloesende Element und
   * Aufraeumarbeiten beim Schliessen.
   *
   * @returns {{dialog, body, foot, close, onClose, focusOnOpen}}
   */
  function makeDialog(title, options = {}) {
    const opener = document.activeElement;
    const titleId = 'dialogTitle' + ++dialogCount;
    const cleanups = [];
    let initialFocus = null;

    const body = h('div', { class: 'dialog__body', tabindex: '-1' });
    const foot = h('div', { class: 'dialog__foot row row--end' });
    const closeBtn = h(
      'button',
      { class: 'iconbtn dialog__close', type: 'button', title: 'Schließen (Esc)', 'aria-label': 'Schließen' },
      icon('schliessen', 'kreuz', 'close') || '×'
    );

    const modifier = options.wide ? ' dialog--wide' : options.narrow ? ' dialog--narrow' : '';
    const dialog = h('dialog', { class: 'dialog' + modifier, 'aria-labelledby': titleId },
      h('div', { class: 'dialog__inner' },
        h('header', { class: 'dialog__head' },
          h('h2', { id: titleId, class: 'dialog__title' }, title),
          closeBtn
        ),
        body,
        foot
      )
    );

    const close = () => dialog.close();
    closeBtn.addEventListener('click', close);

    // Tabulator im Dialog halten. Das native <dialog> tut das bereits; die
    // Schleife hier sorgt zusaetzlich dafuer, dass hinter dem letzten Element
    // wieder das erste kommt statt der Adressleiste des Fensters.
    dialog.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Tab') return;
      const list = focusables(dialog);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      const inside = dialog.contains(active);
      if (ev.shiftKey && (!inside || active === first)) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && (!inside || active === last)) {
        ev.preventDefault();
        first.focus();
      }
    });

    dialog.addEventListener('close', () => {
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch (err) {
          console.warn('[dialogs] Aufräumen fehlgeschlagen:', err && err.message);
        }
      }
      dialog.remove();
      if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();
    });

    document.body.appendChild(dialog);
    dialog.showModal();

    // Der Inhalt haengt erst nach dieser Funktion im Dialog - deshalb den
    // Startfokus im naechsten Bild setzen.
    requestAnimationFrame(() => {
      if (!dialog.isConnected) return;
      const first = initialFocus || dialog.querySelector('.dialog__body select, .dialog__body input, .dialog__body button');
      // Ohne Bedienelement bekommt der Inhalt selbst den Fokus: dann blaettern
      // Bild-auf und Bild-ab sofort, ohne erst irgendwo hineinklicken zu muessen.
      (first || body || closeBtn).focus();
    });

    return {
      dialog,
      body,
      foot,
      close,
      /** Beim Schliessen aufrufen (Abmelden von Ereignissen, Zeitgeber). */
      onClose: (fn) => cleanups.push(fn),
      /** Startfokus abweichend festlegen. */
      focusOnOpen: (node) => {
        initialFocus = node;
      },
    };
  }

  /**
   * Rueckfrage vor einem Schritt, der etwas ueberschreibt oder entfernt.
   * Bewusst ein eigener Dialog statt window.confirm: der Systemdialog bringt
   * seine eigene Schrift, seine eigenen Knopfbeschriftungen und im dunklen
   * Thema eine helle Flaeche mit.
   *
   * @returns {Promise<boolean>}
   */
  function ask(title, lines, options = {}) {
    return new Promise((resolve) => {
      const { body, foot, close, onClose, focusOnOpen } = makeDialog(title, { narrow: true });
      let answer = false;

      for (const line of [].concat(lines)) {
        if (line) body.append(h('p', { class: 'dialog__text' }, line));
      }

      const cancel = button('Abbrechen', { variant: 'ghost', onClick: close });
      const confirm = button(options.confirmLabel || 'Fortfahren', {
        variant: options.danger ? 'danger' : 'primary',
        icon: options.icon,
        onClick: () => {
          answer = true;
          close();
        },
      });

      foot.append(h('div', { class: 'row__spacer' }), cancel, confirm);
      // Startfokus auf der harmlosen Antwort - wer blind Enter drueckt, bricht ab.
      focusOnOpen(cancel);
      onClose(() => resolve(answer));
    });
  }

  // ------------------------------------------------------------ Einstellungen

  /**
   * Standardwerte, die "Zurücksetzen" wiederherstellt.
   * Spiegelt DEFAULTS aus src/main/settings.js - ohne Fensterposition und
   * Zoomstufe, die soll ein Zuruecksetzen der Optionen nicht anfassen.
   */
  const SETTINGS_DEFAULTS = {
    theme: 'system',
    globalShortcut: 'CommandOrControl+Alt+T',
    globalShortcutEnabled: true,
    showWeekend: false,
    closeToTray: true,
    launchAtLogin: false,
    confirmDelete: false,
    backupKeepDays: 14,
  };

  function openSettings() {
    const s = State.get().settings;
    const { body, foot, close, onClose } = makeDialog('Einstellungen');

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
      'Aus: Montag bis Freitag. An: die ganze Woche, Samstag und Sonntag eingelassen.'
    );

    // --- Verhalten ---
    const closeToTray = checkbox(
      'Beim Schließen nur in den Infobereich legen',
      s.closeToTray,
      (v) => State.saveSettings({ closeToTray: v }),
      'Tagwerk läuft weiter und bleibt über das Symbol im Infobereich und das globale Tastenkürzel erreichbar.'
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

    // --- Meldungen, Sicherungen, Angaben zur Ablage ---
    const notices = makeNotices(onClose);
    const backups = makeBackupSection();
    const info = makeInfoBlock();

    body.append(
      notices.node,
      group('Darstellung', field('Design', themeSelect), weekend),
      group('Schnellerfassung',
        shortcutEnabled,
        field('Tastenkürzel', shortcutInput),
        hint('Feld anklicken und die gewünschte Kombination drücken, z. B. Strg + Alt + T.'),
        shortcutState),
      group('Verhalten', closeToTray, confirmDelete, autostart),
      backups.node,
      group('Daten',
        h('div', { class: 'row' },
          button('Datenordner öffnen', { icon: ['ordner', 'ordner-oeffnen'], onClick: () => api.openDataFolder() }),
          button('Exportieren …', { icon: ['export', 'exportieren'], onClick: () => { close(); openExport(); } }),
          button('Importieren …', { onClick: () => importData('merge') })
        ),
        hint('Alle Aufgaben liegen in einer einzigen JSON-Datei. Importieren ergänzt sie um alles, was noch nicht da ist.')
      ),
      info
    );

    foot.append(
      button('Zurücksetzen', {
        variant: 'danger',
        title: 'Alle Optionen auf den Auslieferungszustand zurücksetzen',
        onClick: async () => {
          const yes = await ask('Einstellungen zurücksetzen', [
            'Alle Optionen gehen auf den Auslieferungszustand zurück.',
            'Aufgaben und Sicherungen bleiben unberührt.',
          ], { confirmLabel: 'Zurücksetzen', danger: true });
          if (!yes) return;
          await State.saveSettings({ ...SETTINGS_DEFAULTS });
          Util.toast('Einstellungen zurückgesetzt');
          close();
          openSettings();
        },
      }),
      h('div', { class: 'row__spacer' }),
      button('Fertig', { variant: 'primary', onClick: close })
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

  // -------------------------------------------------------------- Meldungen
  //
  // Der Main-Prozess meldet Schreibschutz, defekte Dateien und ein belegtes
  // Tastenkuerzel ueber `getStatus()` / `onStatusChanged()`. Ohne Anzeige
  // faellt so etwas erst auf, wenn Daten fehlen - deshalb steht der Block
  // ganz oben im Dialog, vor allen Optionen.

  const LEVELS = {
    error: { label: 'Fehler', rank: 0 },
    warn: { label: 'Warnung', rank: 1 },
    info: { label: 'Hinweis', rank: 2 },
  };

  function makeNotices(onClose) {
    const node = h('div', { class: 'dialog__notices' });

    function render(status) {
      Util.clear(node);
      const problems = ((status && status.problems) || []).slice();
      if (!problems.length) return;

      problems.sort((a, b) => (LEVELS[a.level] || LEVELS.info).rank - (LEVELS[b.level] || LEVELS.info).rank);
      node.append(groupCounted('Meldungen', problems.length, ...problems.map(noticeRow)));
    }

    function noticeRow(problem) {
      const level = LEVELS[problem.level] ? problem.level : 'info';
      const meta = [];
      if (problem.at) meta.push(Dates.formatDateTime(problem.at));
      if (problem.count > 1) meta.push(`${problem.count} ×`);

      const dismiss = h('button', {
        class: 'iconbtn notice__dismiss',
        type: 'button',
        title: 'Meldung wegklicken',
        'aria-label': 'Meldung wegklicken',
        onclick: async () => {
          await api.dismissProblem(problem.code);
          refresh();
        },
      }, icon('schliessen', 'kreuz', 'close') || '×');

      return h('div', { class: 'notice notice--' + level },
        h('span', { class: 'notice__mark', 'aria-hidden': 'true' },
          level === 'info' ? null : icon('warnung', 'achtung')),
        h('div', { class: 'notice__body' },
          h('div', { class: 'notice__label' }, LEVELS[level].label),
          h('div', { class: 'notice__text' }, problem.message || problem.code),
          meta.length ? h('div', { class: 'notice__meta' }, meta.join(' · ')) : null
        ),
        dismiss
      );
    }

    async function refresh() {
      const res = await api.getStatus();
      render(res && res.ok ? res.status : null);
    }

    // Ein Schreibfehler passiert waehrend der Dialog offen steht - dann soll
    // die Meldung nicht erst beim naechsten Oeffnen auftauchen.
    const stop = api.onStatusChanged((status) => render(status));
    if (typeof stop === 'function') onClose(stop);
    refresh();

    return { node, refresh };
  }

  // ------------------------------------------------------------ Sicherungen
  //
  // Der Main-Prozess legt taeglich und vor jedem gefaehrlichen Schritt eine
  // Sicherung an. Ohne Bedienung davor bleibt das ein Ordner, den niemand
  // findet - hier ist er eine Liste mit Datum, Umfang und Groesse.

  const BACKUP_KINDS = {
    tag: 'Tagessicherung',
    sicherung: 'Sicherung',
    konflikt: 'Konfliktfassung',
    defekt: 'Defekte Fassung',
    nicht: 'Nicht gespeicherter Stand',
  };

  const BACKUP_REASONS = {
    manuell: 'von Hand',
    'vor-import': 'vor dem Import',
    'vor-wiederherstellung': 'vor dem Wiederherstellen',
    'vor-aufraeumen': 'vor dem Aufräumen',
  };

  /** 'sicherung-2026-08-18T07-05-00-vor-import.json' -> 'Sicherung, vor dem Import' */
  function backupLabel(entry) {
    const kind = BACKUP_KINDS[entry.kind] || entry.kind || 'Sicherung';
    const match = /^sicherung-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.json$/.exec(entry.name || '');
    if (!match) return kind;
    const reason = BACKUP_REASONS[match[1]] || match[1].replace(/-/g, ' ');
    return `${kind}, ${reason}`;
  }

  /** 42.918 -> '42 kB'. Tabellarisch gedacht: eine Nachkommastelle erst ab MB. */
  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
    return `${(n / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  }

  /** Auswahl fuer "Erledigtes aufräumen": Stichtage relativ zu heute. */
  const PURGE_RANGES = [
    { days: 30, label: 'älter als 30 Tage' },
    { days: 90, label: 'älter als 90 Tage' },
    { days: 180, label: 'älter als ein halbes Jahr' },
    { days: 365, label: 'älter als ein Jahr' },
  ];

  function makeBackupSection() {
    const pickName = 'backupPick' + dialogCount;
    let selected = null;

    const list = h('div', { class: 'backups__scroll' });
    const dirHint = hint('');

    const restoreBtn = button('Wiederherstellen …', {
      icon: ['rueckgaengig', 'zurueck'],
      disabled: true,
      title: 'Den gewählten Stand zurückholen',
      onClick: () => restore(),
    });

    const createBtn = button('Sicherung jetzt anlegen', {
      icon: ['sicherung', 'kopieren'],
      onClick: async () => {
        const res = await api.createBackup('manuell');
        if (!res || !res.ok) {
          Util.toast((res && res.error) || 'Sicherung fehlgeschlagen', { tone: 'error' });
          return;
        }
        Util.toast('Sicherung angelegt');
        selected = res.name;
        await refresh();
      },
    });

    // --- Aufbewahrung ---
    const keepInput = h('input', {
      class: 'field field--num',
      type: 'number',
      min: '1',
      max: '365',
      step: '1',
      value: String(State.get().settings.backupKeepDays || 14),
      'aria-label': 'Tagessicherungen aufheben (Tage)',
    });
    keepInput.addEventListener('change', async () => {
      const n = Math.max(1, Math.min(365, Math.round(Number(keepInput.value) || 0)));
      keepInput.value = String(n);
      const res = await State.saveSettings({ backupKeepDays: n });
      if (res && res.ok) {
        keepInput.value = String(res.settings.backupKeepDays);
        await refresh(); // eine kleinere Zahl raeumt sofort auf
      }
    });

    // --- Aufraeumen ---
    const purgeSelect = h('select', { class: 'field', 'aria-label': 'Erledigtes aufräumen' },
      ...PURGE_RANGES.map((r) => h('option', { value: String(r.days) }, r.label))
    );
    const purgeHint = hint('');
    const purgeBtn = button('Erledigtes aufräumen …', {
      icon: ['papierkorb', 'loeschen'],
      onClick: () => purge(),
    });

    function purgeBefore() {
      return Dates.addDays(Dates.todayKey(), -Number(purgeSelect.value || 30));
    }

    function purgeVictims() {
      const before = purgeBefore();
      return State.get().items.filter((i) => i.status === 'erledigt' && i.day < before);
    }

    function refreshPurge() {
      const before = purgeBefore();
      const count = purgeVictims().length;
      purgeBtn.disabled = count === 0;
      purgeHint.textContent = count
        ? `${Util.plural(count, 'erledigte Aufgabe', 'erledigte Aufgaben')} vor dem ${Dates.formatNumeric(before)}. ` +
          'Vor dem Entfernen legt Tagwerk selbst eine Sicherung an.'
        : `Vor dem ${Dates.formatNumeric(before)} liegt nichts Erledigtes.`;
    }
    purgeSelect.addEventListener('change', refreshPurge);

    async function purge() {
      const before = purgeBefore();
      const victims = purgeVictims();
      if (!victims.length) return;

      const yes = await ask('Erledigtes aufräumen', [
        `${Util.plural(victims.length, 'erledigte Aufgabe', 'erledigte Aufgaben')} vor dem ` +
          `${Dates.formatNumeric(before)} werden endgültig entfernt.`,
        'Vorher legt Tagwerk eine Sicherung an; rückgängig machen lässt sich der Schritt nur über diese Sicherung.',
      ], { confirmLabel: 'Endgültig entfernen', danger: true, icon: ['papierkorb', 'loeschen'] });
      if (!yes) return;

      const res = await api.purgeDone(before);
      if (!res || !res.ok) {
        Util.toast((res && res.error) || 'Aufräumen fehlgeschlagen', { tone: 'error' });
        return;
      }
      Util.toast(`${Util.plural(res.count, 'erledigte Aufgabe', 'erledigte Aufgaben')} entfernt`);
      await refresh();
      refreshPurge();
    }

    async function restore() {
      const entry = current();
      if (!entry) return;

      const stand = State.get().items.length;
      const yes = await ask('Sicherung wiederherstellen', [
        `Der Stand vom ${Dates.formatDateTime(entry.modifiedAt)} ersetzt die aktuelle Liste.`,
        `Damit gehen die ${Util.plural(stand, 'Aufgabe', 'Aufgaben')} von jetzt verloren – Tagwerk sichert sie ` +
          'vorher automatisch weg, zurückholen lässt sich das dann über diese Liste.',
      ], { confirmLabel: 'Überschreiben', danger: true, icon: ['rueckgaengig', 'zurueck'] });
      if (!yes) return;

      const res = await api.restoreBackup(entry.name);
      if (!res || !res.ok) {
        Util.toast((res && res.error) || 'Wiederherstellen fehlgeschlagen', { tone: 'error' });
        return;
      }
      Util.toast(`${Util.plural(res.count, 'Aufgabe', 'Aufgaben')} wiederhergestellt`);
      selected = null;
      await refresh();
      refreshPurge();
    }

    let entries = [];
    const current = () => entries.find((e) => e.name === selected) || null;

    function renderList() {
      Util.clear(list);
      restoreBtn.disabled = !current();

      if (!entries.length) {
        // §5.9: ein Satz, linksbuendig, ohne Kasten und ohne Bild.
        list.append(h('p', { class: 'backups__empty' },
          'Noch keine Sicherung vorhanden. Tagwerk legt beim ersten Start des Tages selbst eine an.'));
        return;
      }

      const rows = entries.map((entry) => {
        const radio = h('input', {
          type: 'radio',
          name: pickName,
          value: entry.name,
          checked: entry.name === selected,
          disabled: !entry.readable,
          'aria-label': `Sicherung vom ${Dates.formatDateTime(entry.modifiedAt)}, ${backupLabel(entry)}`,
        });
        radio.addEventListener('change', () => {
          selected = entry.name;
          restoreBtn.disabled = false;
        });

        return h('tr', { class: 'backups__row' + (entry.readable ? '' : ' backups__row--broken'), title: entry.name },
          h('td', null,
            h('label', { class: 'backups__pick' },
              radio,
              h('span', { class: 'backups__when' }, Dates.formatDateTime(entry.modifiedAt))
            )
          ),
          h('td', { class: 'backups__kind' }, backupLabel(entry)),
          h('td', { class: 'backups__count' },
            entry.readable ? Util.plural(entry.count || 0, 'Aufgabe', 'Aufgaben') : 'nicht lesbar'),
          h('td', { class: 'backups__size' }, formatBytes(entry.size))
        );
      });

      list.append(h('table', { class: 'backups' }, h('tbody', null, ...rows)));
    }

    async function refresh() {
      const res = await api.listBackups();
      entries = (res && res.ok && Array.isArray(res.backups)) ? res.backups : [];
      if (selected && !entries.some((e) => e.name === selected)) selected = null;
      renderList();
      dirHint.textContent = res && res.dir
        ? `Ordner: ${res.dir}`
        : 'Der Ordner mit den Sicherungen liegt neben der Datendatei.';
    }

    refresh();
    refreshPurge();

    const node = group('Sicherungen',
      list,
      h('div', { class: 'row' }, createBtn, restoreBtn),
      h('div', { class: 'row backups__keep' },
        field('Tagessicherungen aufheben', keepInput),
        h('span', { class: 'backups__unit' }, 'Tage')
      ),
      hint('Ältere Tagessicherungen werden beim nächsten Anlegen entfernt. Sicherungen von Hand und vor gefährlichen Schritten bleiben unabhängig davon erhalten.'),
      h('div', { class: 'row backups__purge' }, field('Erledigtes aufräumen', purgeSelect), purgeBtn),
      purgeHint,
      dirHint
    );

    return { node, refresh };
  }

  // ----------------------------------------------------- Angaben zur Ablage

  function makeInfoBlock() {
    const box = h('div', { class: 'dialog__info' }, h('div', null, 'Angaben werden geladen …'));

    Promise.all([api.appInfo(), api.getStatus()]).then(([res, statusRes]) => {
      if (!res || !res.ok) return;
      const i = res.info;
      const st = statusRes && statusRes.ok ? statusRes.status : null;

      const ablage = [];
      if (st) {
        ablage.push(st.readOnly ? 'Ablage schreibgeschützt' : 'Ablage beschreibbar');
        if (st.pendingChanges) ablage.push('Änderungen werden noch geschrieben');
        else if (st.lastSaveAt) ablage.push(`zuletzt gespeichert ${Dates.formatTime(st.lastSaveAt)}`);
      }

      Util.clear(box);
      box.append(
        h('div', null, `Tagwerk ${i.version}`),
        h('div', { class: 'muted' }, `Electron ${i.electron} · Chromium ${i.chrome} · Node ${i.node}`),
        ablage.length ? h('div', { class: 'muted' }, ablage.join(' · ')) : null,
        h('div', { class: 'muted dialog__path', title: i.dataFile || i.dataPath }, i.dataFile || i.dataPath)
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

    const groupSelect = h('select', { class: 'field', 'aria-label': 'Gliederung' },
      ...Exporter.GROUPINGS.map((g) => h('option', { value: g.id }, g.label))
    );
    const groupField = field('Gliederung', groupSelect);

    const preview = h('pre', { class: 'dialog__preview', tabindex: '0', 'aria-label': 'Vorschau' });
    const fileHint = h('p', { class: 'dialog__hint' });

    function dayKeys() {
      if (scopeSelect.value === 'woche') return State.weekDays();
      if (scopeSelect.value === 'alle') return [...new Set(State.get().items.map((i) => i.day))].sort();
      return [state.cursorDay];
    }

    /** Umfang "Alles" heisst: keine Tagesliste, der Exporter nimmt dann alles. */
    function selection() {
      return scopeSelect.value === 'alle' ? null : dayKeys();
    }

    /** Wie viele Aufgaben stecken im gewaehlten Umfang? */
    function scopeCount() {
      const items = State.get().items;
      if (scopeSelect.value === 'alle') return items.length;
      const days = new Set(dayKeys());
      return items.filter((i) => days.has(i.day)).length;
    }

    function options(extra) {
      const opts = { version: 1, ...extra };
      if (supportsGrouping(formatSelect.value)) opts.groupBy = groupSelect.value;
      return opts;
    }

    function buildText(extra) {
      return Exporter.build(formatSelect.value, State.get().items, selection(), options(extra));
    }

    const saveBtn = button('Als Datei speichern', {
      variant: 'primary',
      onClick: async () => {
        const res = await api.exportFile(formatSelect.value, dayKeys(), scopeSelect.value, options());
        if (res.canceled) return;
        if (!res.ok) Util.toast(res.error || 'Export fehlgeschlagen', { tone: 'error' });
        else Util.toast('Gespeichert: ' + res.path);
        close();
      },
    });

    function refresh() {
      const text = buildText();
      const lines = text ? text.split('\n').length : 0;
      preview.textContent = text.length > 4000 ? text.slice(0, 4000) + '\n…' : text || '(nichts zu exportieren)';

      // Ueber style statt [hidden]: die Felder sind Flex-Container, da greift
      // das hidden-Attribut nicht.
      groupField.style.display = supportsGrouping(formatSelect.value) ? '' : 'none';
      saveBtn.disabled = !text;

      const parts = [Util.plural(scopeCount(), 'Aufgabe', 'Aufgaben')];
      if (formatSelect.value === 'html') {
        parts.push('wird formatiert eingefügt – in einer Outlook-Mail einfach Strg + V');
      } else {
        parts.push(Util.plural(lines, 'Zeile', 'Zeilen'));
        parts.push('Dateiendung .' + Exporter.formatById(formatSelect.value).ext);
      }
      fileHint.textContent = parts.join(' · ');
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
      button('In Zwischenablage', {
        icon: ['kopieren'],
        onClick: async () => {
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
      }),
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

  /**
   * Die erkannten Ticket-Praefixe stehen als Muster im Parser. Sie hier
   * abzulesen statt sie abzuschreiben heisst: die Hilfe kann nicht veralten.
   */
  function refPrefixes() {
    try {
      const found = /\(\?:([A-Z|]+)\)/.exec(Parse.REF_PATTERN.source);
      if (found) return found[1].split('|').join(', ');
    } catch (err) {
      /* Muster anders gebaut - dann eben die kurze Aufzaehlung unten. */
    }
    return 'INC, RITM, REQ, CHG, PRB, TASK, KB';
  }

  function openHelp() {
    const { body, foot, close } = makeDialog('Kurzanleitung', { wide: true });

    // Die Quellenliste kommt aus dem Modell - so kann sie nicht veralten.
    const sourceList = Model.SOURCES.map((s) => '@' + s.id).join(' ');

    const syntax = [
      ['@quelle', 'Woher kam die Aufgabe: ' + sourceList +
        '. Eindeutige Anfänge und kleine Tippfehler gehen auch (@out, @snow, @outlok); Mehrdeutiges bleibt im Titel stehen.'],
      ['#tag', 'Beliebig viele Schlagworte, z. B. #netzwerk. Reine Zahlen zählen nicht – „#4711" bleibt Text.'],
      ['!  /  !!', 'Priorität hoch bzw. dringend'],
      ['>tag', '>heute >morgen >uebermorgen >gestern, >mo … >so, >+3 >-1 >+2w, >24.12., >24.12.2026, >2026-12-24'],
      ['>in Worten', '>nächste woche, >übernächste woche, >nächsten montag, >ende der woche, >wochenanfang, ' +
        '>monatsende, >monatsanfang, >nächsten monat, >kw35, >in 3 tagen, >in 2 wochen'],
      ['Ticketnummer', `${refPrefixes()} – gefolgt von mindestens drei Ziffern. Wird als Referenz erkannt und setzt ` +
        'die Quelle auf Ticket, auch aus einem eingefügten ServiceNow- oder Jira-Link.'],
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

    const exportRows = Exporter.FORMATS.map((f) => {
      const [name, erklaerung] = String(f.label).split(/\s+–\s+/);
      return ['.' + f.ext, erklaerung ? `${name}: ${erklaerung}` : name];
    });

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
        hint('Gilt, sobald eine Zeile den Fokus hat – einmal hineinklicken oder mit Tab dorthin wechseln.')),
      group('Schnellerfassung', table(quickKeys),
        hint('Das kleine Fenster erscheint über allem anderen – auch wenn Tagwerk im Hintergrund läuft. ' +
          'Das systemweite Kürzel dafür steht in den Einstellungen; dort ist auch zu sehen, ob es wirklich greift.')),
      group('Aufgaben verschieben',
        hint('In der Wochenansicht lassen sich Aufgaben zwischen den Tagen ziehen. Der Knopf „Weiterschieben" in der Zeile ' +
          'legt sie einen Tag später ab. In der Tagesansicht holt „Alle herholen" alles Liegengebliebene aus früheren Tagen ' +
          'auf den angezeigten Tag.')),
      group('Export', table(exportRows),
        hint('Emoji stehen nur im Export – dort sind sie die einzige Auszeichnung, die in Editor, Excel und Outlook ankommt.')),
      group('Sicherungen',
        hint('Tagwerk sichert beim ersten Start des Tages und vor jedem Schritt, der etwas überschreibt. ' +
          'Liste, Wiederherstellen und Aufräumen stehen in den Einstellungen unter „Sicherungen".'))
    );

    foot.append(
      h('div', { class: 'row__spacer' }),
      button('Einstellungen …', { icon: ['einstellungen', 'regler'], onClick: () => { close(); openSettings(); } }),
      button('Alles klar', { variant: 'primary', onClick: close })
    );
  }

  // ----------------------------------------------------------- Bausteine

  function group(title, ...children) {
    return h('section', { class: 'dialog__group' }, h('h3', { class: 'dialog__groupTitle' }, title), ...children);
  }

  /** Gruppe mit Anzahl rechts in der Ueberschrift (wie die Gruppenkoepfe der Tagesliste). */
  function groupCounted(title, count, ...children) {
    return h('section', { class: 'dialog__group' },
      h('h3', { class: 'dialog__groupTitle' },
        h('span', null, title),
        h('span', { class: 'dialog__groupCount' }, String(count))
      ),
      ...children
    );
  }

  function field(label, control) {
    return h('label', { class: 'dialog__field' }, h('span', { class: 'dialog__fieldLabel' }, label), control);
  }

  /**
   * Knopf nach §5.6. Ein vorhandenes Symbol bringt die Klasse `btn--icon`
   * mit (Innenabstand links 8, rechts 12) - fehlt der Icon-Satz, fehlt auch
   * die Klasse und der Knopf ist ein normaler Textknopf.
   */
  function button(label, options = {}) {
    const glyph = options.icon ? icon(...[].concat(options.icon)) : null;
    const classes = ['btn'];
    if (options.variant) classes.push('btn--' + options.variant);
    if (glyph) classes.push('btn--icon');

    return h('button', {
      class: classes.join(' '),
      type: 'button',
      title: options.title || null,
      disabled: !!options.disabled,
      onclick: options.onClick,
    }, glyph, h('span', null, label));
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
