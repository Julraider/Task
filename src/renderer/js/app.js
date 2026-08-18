/*
 * Zusammenbau: Kopfzeile, Erfassungszeile, Filter, Statuszeile, Tastenkuerzel.
 *
 * Gestaltung nach docs/design-system.md - vier feste Zonen (44 / 54 / 34 px
 * oben, 24 px unten), Haarlinien statt Kaesten, keine Emoji, keine Kapseln.
 * Alle Symbole kommen aus dem Iconsatz (`window.Icons`); fehlt er, bleibt die
 * Oberflaeche bedienbar und zeigt ein schlichtes Ersatzzeichen.
 */
window.App = (function () {
  const { h, el } = Util;
  const api = window.tagwerk;

  let viewRoot;
  let captureInput;
  let capturePreview;
  let captureSuggest;
  let searchInput;

  /** Signatur der zuletzt gebauten Schlagwort-Liste - spart unnoetiges Neubauen. */
  let tagFilterKey = null;

  /** Zuletzt gemeldeter Zustand der Ablage (fuer die rechte Statuszeile). */
  let saveStatus = null;

  /**
   * Zustand der Vervollstaendigung in der Erfassungszeile.
   * `ghost` ist gesetzt, solange der ergaenzte Rest im Feld markiert ist.
   */
  let ghost = null; // { sign, typed, start, candidates, index, applied }

  /** Ab hier ist Platz fuer die ausgeschriebene Datumsangabe (Leitfaden §8). */
  const WIDE = window.matchMedia('(min-width: 1000px)');

  // ------------------------------------------------------------------ Start

  async function init() {
    viewRoot = el('#viewRoot');
    captureInput = el('#captureInput');
    capturePreview = el('#capturePreview');
    captureSuggest = el('#captureSuggest');
    searchInput = el('#searchInput');

    paintIcons();
    buildSourceFilter();
    wireTopbar();
    wireCapture();
    wireFilters();
    wireKeyboard();
    await applyTheme();
    wireSaveStatus();

    State.subscribe(render);
    await State.init();

    captureInput.focus();
  }

  // ------------------------------------------------------------------ Icons
  //
  // Der Iconsatz liegt in einer eigenen Datei und wird hier nur benutzt.
  // Falls er fehlt oder einen Namen nicht kennt, darf davon nichts stehen
  // bleiben: die Knoepfe tragen ohnehin `title` und `aria-label`, sie
  // bekommen dann ein einfaches Ersatzzeichen (nie ein Emoji).

  /** Bekannte Namen der Bau-Funktion - je nach Iconsatz heisst sie anders. */
  const ICON_BUILDERS = ['svg', 'get', 'make', 'node', 'create', 'icon'];

  function iconBuilder() {
    const set = window.Icons;
    if (!set) return null;
    for (const name of ICON_BUILDERS) {
      if (typeof set[name] === 'function') return set[name].bind(set);
    }
    return null;
  }

  /** true / false / null - null heisst: der Satz gibt keine Auskunft. */
  function knowsIcon(set, name) {
    if (typeof set.has === 'function') return !!set.has(name);
    if (Array.isArray(set.names)) return set.names.includes(name);
    if (set.paths && typeof set.paths === 'object') {
      return Object.prototype.hasOwnProperty.call(set.paths, name);
    }
    return null;
  }

  function buildIcon(make, name) {
    let out = null;
    try {
      out = make(name);
    } catch (err) {
      return null;
    }
    if (out instanceof Node) return out;
    // Manche Saetze liefern Markup statt eines Knotens. Das ist unser eigenes
    // SVG, kein Nutzertext - Titel und Namen laufen nie hier durch.
    if (typeof out === 'string' && out.trim().slice(0, 4).toLowerCase() === '<svg') {
      const box = document.createElement('span');
      box.innerHTML = out;
      return box.firstElementChild;
    }
    return null;
  }

  /**
   * Erstes passendes Symbol aus einer Liste von Namensvorschlaegen.
   * Mehrere Namen, weil der Iconsatz parallel entsteht und die Benennung
   * dort feststeht, nicht hier.
   */
  function iconNode(names) {
    const make = iconBuilder();
    if (!make) return null;
    const set = window.Icons;
    for (const name of [].concat(names)) {
      if (knowsIcon(set, name) === false) continue;
      const node = buildIcon(make, name);
      if (node) return node;
    }
    return null;
  }

  /** Symbol in einen Knopf setzen; ohne Iconsatz das Ersatzzeichen. */
  function setIcon(selector, names, fallback) {
    const node = el(selector);
    if (!node) return;
    Util.clear(node);
    const svg = iconNode(names);
    if (svg) {
      node.appendChild(svg);
      node.classList.add('has-icon');
      return;
    }
    if (fallback) node.appendChild(h('span', { class: 'iconfallback' }, fallback));
  }

  function paintIcons() {
    setIcon('#btnPrev', ['zurueck', 'chevron-links', 'chevronLinks', 'links'], '‹');
    setIcon('#btnNext', ['vor', 'chevron-rechts', 'chevronRechts', 'rechts'], '›');
    setIcon('#btnToday', ['heute', 'punkt'], 'Heute');
    setIcon('.search__icon', ['suchen', 'lupe', 'suche'], '⌕');
    setIcon('#btnQuickTop', ['schnellerfassung', 'plus', 'neu'], '+');
    setIcon('#btnExport', ['exportieren', 'export', 'teilen'], '↑');
    setIcon('#btnHelp', ['hilfe', 'frage'], '?');
    setIcon('#btnSettings', ['einstellungen', 'regler', 'schieber'], '≡');
  }

  // -------------------------------------------------------------- Kopfzeile

  function wireTopbar() {
    Util.els('#viewTabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => State.setView(tab.dataset.view));
    });

    el('#btnPrev').addEventListener('click', () => State.shift(-1));
    el('#btnNext').addEventListener('click', () => State.shift(1));
    el('#btnToday').addEventListener('click', () => State.goToday());
    el('#btnExport').addEventListener('click', () => Dialogs.openExport());
    el('#btnSettings').addEventListener('click', () => Dialogs.openSettings());
    el('#btnHelp').addEventListener('click', () => Dialogs.openHelp());
    el('#btnQuickTop').addEventListener('click', () => api.quickOpen());

    // Schmales Fenster: die Datumsangabe wird kurz, sobald der Platz fehlt.
    const onWidth = () => renderDateLabel();
    if (typeof WIDE.addEventListener === 'function') WIDE.addEventListener('change', onWidth);
    else if (typeof WIDE.addListener === 'function') WIDE.addListener(onWidth);

    searchInput.addEventListener(
      'input',
      Util.debounce(() => State.set({ search: searchInput.value }), 120)
    );
    searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && searchInput.value) {
        ev.preventDefault();
        ev.stopPropagation();
        searchInput.value = '';
        State.set({ search: '' });
      }
    });
  }

  /**
   * Datum zwischen den beiden Chevrons. Die Spalte hat feste Breite, damit
   * beim Blaettern nichts springt; ab 1000 px steht der lange Name da.
   */
  function renderDateLabel() {
    const state = State.get();
    if (!state.ready) return;
    const day = state.cursorDay;
    const node = el('#dateLabel');

    if (state.view === 'woche') {
      const week = Dates.isoWeekLabel(day);
      node.textContent = WIDE.matches ? `${week} · ${Dates.isoWeek(day).year}` : week;
      node.title = Dates.rangeLabel(State.weekDays()[0], State.weekDays()[6]);
      return;
    }

    node.textContent = WIDE.matches
      ? Dates.formatLong(day)
      : `${Dates.shortWeekday(day)} ${Dates.formatShort(day)}`;
    node.title = Dates.formatNumeric(day);
  }

  // --------------------------------------------------------- Erfassungszeile

  function wireCapture() {
    el('#captureForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      closeSuggest();
      const text = captureInput.value.trim();
      if (!text) {
        captureInput.focus();
        return;
      }

      const created = await State.addFromInput(text, State.get().cursorDay);
      if (created) {
        captureInput.value = '';
        updateCapture();
        captureInput.focus();
      }
    });

    captureInput.addEventListener('input', (ev) => {
      // Nur beim Tippen ergaenzen, nicht beim Loeschen - sonst kaempft man
      // gegen das eigene Feld an.
      const typing = !ev.inputType || ev.inputType.startsWith('insert');
      refreshCompletion(typing);
      updateCapture();
    });

    captureInput.addEventListener('keydown', onCaptureKey);
    captureInput.addEventListener('blur', () => {
      ghost = null;
      updateCapture();
    });
  }

  function onCaptureKey(ev) {
    if (ev.key === 'Tab' && ghost && ghost.candidates.length > 1) {
      ev.preventDefault();
      applyGhost(ghost.index + (ev.shiftKey ? -1 : 1));
      updateCapture();
      return;
    }
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && ghost && ghost.candidates.length > 1) {
      ev.preventDefault();
      applyGhost(ghost.index + (ev.key === 'ArrowDown' ? 1 : -1));
      updateCapture();
      return;
    }
    if (ev.key === 'Escape') {
      ev.stopPropagation(); // nicht bis zur Listen-Navigation durchreichen
      if (ghost && ghost.applied) {
        ev.preventDefault();
        revertGhost();
        updateCapture();
        return;
      }
      if (ghost) {
        // Erst die Vorschlagsliste schliessen, das Getippte bleibt stehen.
        ev.preventDefault();
        ghost = null;
        updateCapture();
        return;
      }
      if (captureInput.value) {
        ev.preventDefault();
        captureInput.value = '';
        updateCapture();
      }
      return;
    }
    if (ev.key === 'Enter') {
      // Der ergaenzte Rest steht bereits im Feld und wird einfach mitgespeichert.
      ghost = null;
      return;
    }
    if (ghost && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) ghost = null;
  }

  // ---------------------------------------------- Vervollstaendigung @ und #

  /** Das gerade getippte '@…' oder '#…' links vom Cursor, oder null. */
  function tokenAtCaret() {
    const pos = captureInput.selectionStart;
    const before = captureInput.value.slice(0, pos);
    const m = before.match(/(^|\s)([@#])([\p{L}\p{N}_-]*)$/u);
    if (!m) return null;
    return { sign: m[2], typed: m[3], start: pos - m[3].length - 1 };
  }

  /** Passende Quellen bzw. Schlagworte zu einem angefangenen Wort. */
  function candidatesFor(sign, typed) {
    const t = typed.toLowerCase();
    if (sign === '@') {
      const byId = Model.SOURCES.filter((s) => s.id.startsWith(t));
      const byAlias = Model.SOURCES.filter(
        (s) => !byId.includes(s) && s.aliases.some((a) => a.startsWith(t))
      );
      return [...byId, ...byAlias].map((s) => s.id);
    }
    return State.allTags()
      .filter(([tag]) => tag.startsWith(t))
      .slice(0, 8)
      .map(([tag]) => tag);
  }

  /**
   * Vorschlaege neu bestimmen. Bei `complete` wird der erste Treffer direkt
   * ins Feld geschrieben und der ergaenzte Teil markiert - weitertippen
   * ueberschreibt ihn, Tab blaettert weiter, Esc nimmt ihn zurueck.
   */
  function refreshCompletion(complete) {
    const token = tokenAtCaret();
    ghost = null;
    if (!token) return;

    const candidates = candidatesFor(token.sign, token.typed);
    if (!candidates.length) return;

    ghost = { ...token, candidates, index: 0, applied: false };
    if (complete && token.typed && candidates[0] !== token.typed) applyGhost(0);
  }

  function applyGhost(index) {
    if (!ghost) return;
    ghost.applied = true;
    const count = ghost.candidates.length;
    ghost.index = ((index % count) + count) % count;

    const word = ghost.candidates[ghost.index];
    const caret = ghost.start + 1 + ghost.typed.length;
    const value = captureInput.value;
    const tail = value.slice(Math.max(caret, captureInput.selectionEnd));

    captureInput.value = value.slice(0, ghost.start) + ghost.sign + word + tail;
    captureInput.setSelectionRange(caret, ghost.start + 1 + word.length, 'backward');
  }

  /** Ergaenzten Rest wieder entfernen, das selbst Getippte bleibt stehen. */
  function revertGhost() {
    const caret = ghost.start + 1 + ghost.typed.length;
    const value = captureInput.value;
    captureInput.value = value.slice(0, caret) + value.slice(captureInput.selectionEnd);
    captureInput.setSelectionRange(caret, caret);
    ghost = null;
  }

  /** Vorschlag per Mausklick uebernehmen. */
  function pickSuggestion(index) {
    applyGhost(index);
    const end = captureInput.selectionEnd;
    const value = captureInput.value;
    const gap = value[end] === ' ' ? '' : ' '; // kein doppeltes Leerzeichen
    captureInput.value = value.slice(0, end) + gap + value.slice(end);
    captureInput.setSelectionRange(end + gap.length, end + gap.length);
    ghost = null;
    captureInput.focus();
    updateCapture();
  }

  // ------------------------------------------------------- Vorschlagsliste

  function closeSuggest() {
    ghost = null;
    renderSuggest();
  }

  /** Schwebende Liste ueber dem Feld; Zeilen 24 px, Treffer hervorgehoben. */
  function renderSuggest() {
    const host = Util.clear(captureSuggest);

    if (!ghost || !ghost.candidates.length) {
      captureSuggest.hidden = true;
      captureInput.setAttribute('aria-expanded', 'false');
      captureInput.removeAttribute('aria-activedescendant');
      return;
    }

    ghost.candidates.slice(0, 8).forEach((word, i) => {
      const active = i === ghost.index;
      host.appendChild(
        h('div', {
          class: 'capture__suggestRow' + (active ? ' is-active' : ''),
          id: 'captureSuggest-' + i,
          role: 'option',
          'aria-selected': String(active),
          title: 'Übernehmen',
          onmousedown: (ev) => ev.preventDefault(), // Fokus bleibt im Feld
          onclick: () => pickSuggestion(i),
        }, ...suggestLabel(ghost.sign + word, ghost.sign + ghost.typed))
      );
    });

    captureSuggest.hidden = false;
    captureInput.setAttribute('aria-expanded', 'true');
    captureInput.setAttribute('aria-activedescendant', 'captureSuggest-' + ghost.index);
  }

  /** Der bereits getippte Anfang steht im halbfetten Schnitt. */
  function suggestLabel(word, typed) {
    if (typed.length > 1 && word.toLowerCase().startsWith(typed.toLowerCase())) {
      return [
        h('span', { class: 'capture__hit' }, word.slice(0, typed.length)),
        document.createTextNode(word.slice(typed.length)),
      ];
    }
    return [document.createTextNode(word)];
  }

  // --------------------------------------------------------------- Vorschau

  function updateCapture() {
    renderSuggest();
    updatePreview();
  }

  /**
   * Eine Textzeile statt einer Reihe Kapseln: was sicher erkannt wurde, steht
   * dunkler; Geratenes bekommt eine gepunktete Unterstreichung. Alles, was aus
   * der Eingabe stammt, laesst sich anklicken und verschwindet damit wieder.
   */
  function updatePreview() {
    const text = captureInput.value;
    const host = Util.clear(capturePreview);
    if (!text.trim()) {
      capturePreview.classList.remove('is-visible');
      return;
    }

    const base = State.get().cursorDay;
    const parsed = Parse.parseCapture(text, base);
    const parts = [];

    const source = Model.sourceById(parsed.source);
    parts.push(
      parsed.sourceExplicit
        ? dropPart(source.label, 'Quelle entfernen', () => dropFromInput('source', parsed.source))
        : guessPart(source.label, 'Quelle geraten – mit @ festlegen')
    );

    if (parsed.priority > 0) {
      parts.push(
        dropPart(
          Model.priorityById(parsed.priority).label.toLowerCase(),
          'Priorität entfernen',
          () => dropFromInput('priority')
        )
      );
    }

    for (const tag of parsed.tags) {
      parts.push(dropPart('#' + tag, 'Schlagwort entfernen', () => dropFromInput('tag', tag)));
    }

    if (parsed.ref) parts.push(surePart(parsed.ref, 'capture__recog--ref', 'Referenz erkannt'));

    if (parsed.day !== base) {
      parts.push(
        parsed.dayExplicit
          ? dropPart(dayLabel(parsed.day), 'Zieltag entfernen', () => dropFromInput('day'))
          : guessPart(dayLabel(parsed.day), 'Zieltag geraten')
      );
    }

    for (let i = 0; i < parts.length; i++) {
      if (i) host.appendChild(h('span', { class: 'capture__sep', 'aria-hidden': 'true' }, ' · '));
      host.appendChild(parts[i]);
    }

    const missed = unknownTokens(text, base);
    if (missed.length) {
      host.appendChild(h('span', { class: 'capture__spacer' }));
      host.appendChild(
        h('span', {
          class: 'capture__miss',
          title: 'Bleibt so im Titel stehen',
        }, 'nicht erkannt: ' + missed.slice(0, 2).map((t) => '„' + t + '“').join(' · '))
      );
    }

    capturePreview.classList.add('is-visible');
  }

  /** Sicher erkannt, unveraenderlich (die Referenz steht im Titel). */
  function surePart(label, extra, title) {
    return h('span', { class: 'capture__recog ' + extra, title }, label);
  }

  /** Sicher erkannt und wieder abwaehlbar. */
  function dropPart(label, title, onDrop) {
    return h('button', {
      type: 'button',
      class: 'capture__recog capture__recog--drop',
      title: title + ' (Klick)',
      onmousedown: (ev) => ev.preventDefault(), // Fokus bleibt im Feld
      onclick: onDrop,
    }, label);
  }

  /** Geraten - gepunktet unterstrichen, nicht anklickbar. */
  function guessPart(label, title) {
    return h('span', { class: 'capture__recog capture__recog--guess', title }, label);
  }

  /** 'Morgen' / 'Mo 24.08.' - nie der lange Name, dafuer ist kein Platz. */
  function dayLabel(day) {
    const rel = Dates.relativeLabel(day);
    return rel === Dates.formatLong(day) ? `${Dates.shortWeekday(day)} ${Dates.formatShort(day)}` : rel;
  }

  // ------------------------------------------------- Eingabe wieder aufraeumen

  /** Wie der Parser: '#Netzwerk!' -> 'netzwerk'. */
  function foldTag(word) {
    return word.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '');
  }

  /**
   * Wie viele Folgewoerter gehoeren zu einem '>…' (0 bis 2)?
   * -1 heisst: gar kein Tag erkannt. Gleiche Reihenfolge wie im Parser -
   * laengste Wortgruppe zuerst, damit '>ende der woche' ganz verschwindet.
   */
  function dayPhraseLength(tokens, i, base) {
    const reach = Math.min(2, tokens.length - 1 - i);
    for (let extra = reach; extra >= 0; extra--) {
      const phrase = [tokens[i].slice(1), ...tokens.slice(i + 1, i + 1 + extra)].join(' ');
      if (Parse.resolveDay(phrase, base)) return extra;
    }
    return -1;
  }

  /** Angaben, die wie eine Anweisung aussehen, aber keine sind ('>1000'). */
  function unknownTokens(text, base) {
    const tokens = String(text).split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith('@') && token.length > 1 && !Parse.resolveSource(token.slice(1))) out.push(token);
      else if (token.startsWith('>') && token.length > 1 && dayPhraseLength(tokens, i, base) < 0) out.push(token);
    }
    return out;
  }

  /**
   * Eine erkannte Angabe wieder aus der Eingabe streichen. Es wird genau ein
   * Vorkommen entfernt - wer zweimal '#netzwerk' getippt hat, klickt zweimal.
   */
  function dropFromInput(kind, value) {
    const base = State.get().cursorDay;
    const tokens = captureInput.value.split(/\s+/).filter(Boolean);
    const keep = [];
    let done = false;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (!done && kind === 'source' && token.startsWith('@') && token.length > 1) {
        if (Parse.resolveSource(token.slice(1)) === value) {
          done = true;
          continue;
        }
      }

      if (!done && kind === 'tag' && token.startsWith('#') && token.length > 1) {
        if (foldTag(token.slice(1)) === value) {
          done = true;
          continue;
        }
      }

      if (!done && kind === 'priority' && /^!{1,3}$/.test(token)) {
        done = true;
        continue;
      }

      if (!done && kind === 'day' && token.startsWith('>') && token.length > 1) {
        const span = dayPhraseLength(tokens, i, base);
        if (span >= 0) {
          i += span;
          done = true;
          continue;
        }
      }

      keep.push(token);
    }

    captureInput.value = keep.join(' ');
    ghost = null;
    captureInput.focus();
    const end = captureInput.value.length;
    captureInput.setSelectionRange(end, end);
    updateCapture();
  }

  /** Wird aus der Wochenansicht heraus aufgerufen ("+" in einer Spalte). */
  function captureInto(day) {
    State.set({ cursorDay: day, view: 'tag' });
    captureInput.focus();
  }

  // ------------------------------------------------------------------ Filter

  function buildSourceFilter() {
    const select = el('#sourceFilter');
    select.append(
      h('option', { value: '' }, 'Alle Quellen'),
      ...Model.SOURCES.map((s) => h('option', { value: s.id }, s.label))
    );
    select.addEventListener('change', () => State.set({ filterSource: select.value || null }));
  }

  function wireFilters() {
    Util.els('#statusFilter button').forEach((btn) => {
      btn.addEventListener('click', () => State.set({ filterStatus: btn.dataset.status }));
    });

    el('#tagFilter').addEventListener('change', (ev) => State.set({ filterTag: ev.target.value || null }));
    el('#btnResetFilters').addEventListener('click', resetFilters);
  }

  /** Schlagwort-Auswahl nachziehen, sobald sich die vergebenen Tags aendern. */
  function syncTagFilter() {
    const select = el('#tagFilter');
    const tags = State.allTags();
    const key = tags.map(([tag, count]) => tag + ':' + count).join('|');

    if (key !== tagFilterKey) {
      tagFilterKey = key;
      Util.clear(select);
      select.append(
        h('option', { value: '' }, tags.length ? 'Alle Schlagworte' : 'Keine Schlagworte'),
        ...tags.map(([tag, count]) => h('option', { value: tag }, `#${tag} (${count})`))
      );
      select.disabled = tags.length === 0;
    }

    const wanted = State.get().filterTag || '';
    // Ein Filter kann auf ein Schlagwort zeigen, das es nicht mehr gibt -
    // dann bleibt es als Eintrag stehen, bis man es abwaehlt.
    if (wanted && !tags.some(([tag]) => tag === wanted)) {
      select.append(h('option', { value: wanted }, `#${wanted} (0)`));
      tagFilterKey = null;
    }
    select.value = wanted;
  }

  function resetFilters() {
    searchInput.value = '';
    State.set({ search: '', filterStatus: 'alle', filterSource: null, filterTag: null });
  }

  function anyFilter(state) {
    return Boolean(state.filterSource || state.filterTag || state.search.trim() || state.filterStatus !== 'alle');
  }

  /**
   * Jeder aktive Filter steht als Wort da, mit einem kleinen Kreuz dahinter.
   * Keine Kapseln, keine Farbflaechen - der Klick nimmt den Filter weg.
   */
  function renderActiveFilters() {
    const state = State.get();
    const host = Util.clear(el('#activeFilters'));

    const flag = (label, title, onRemove) => {
      const cross = iconNode(['schliessen', 'kreuz', 'entfernen', 'x']);
      return h('button', {
        class: 'filters__flag',
        type: 'button',
        title,
        onclick: onRemove,
      },
        h('span', { class: 'filters__flagText' }, label),
        cross ? h('span', { class: 'filters__flagX', 'aria-hidden': 'true' }, cross)
              : h('span', { class: 'filters__flagX iconfallback', 'aria-hidden': 'true' }, '×')
      );
    };

    if (state.filterStatus !== 'alle') {
      host.appendChild(
        flag(
          state.filterStatus === 'offen' ? 'nur offene' : 'nur erledigte',
          'Status-Filter entfernen',
          () => State.set({ filterStatus: 'alle' })
        )
      );
    }

    if (state.filterSource) {
      host.appendChild(
        flag(Model.sourceById(state.filterSource).label, 'Quellen-Filter entfernen', () =>
          State.set({ filterSource: null })
        )
      );
    }

    if (state.filterTag) {
      host.appendChild(
        flag('#' + state.filterTag, 'Schlagwort-Filter entfernen', () => State.set({ filterTag: null }))
      );
    }

    if (state.search.trim()) {
      host.appendChild(
        flag('„' + state.search.trim() + '“', 'Suche löschen', () => {
          searchInput.value = '';
          State.set({ search: '' });
        })
      );
    }

    el('#btnResetFilters').hidden = !anyFilter(state);
  }

  // -------------------------------------------------------------- Tastatur
  //
  // Zwei Regeln halten die Kuerzel aus dem Weg:
  //   1. Was ein anderer Zuhoerer schon erledigt hat (`defaultPrevented`),
  //      wird hier nicht noch einmal angefasst - die Listen-Navigation in
  //      views.js (Pfeile, Leertaste, e, m, x, Entf) kommt zuerst dran.
  //   2. Kuerzel ohne Steuertaste feuern nie, solange jemand in einem Feld
  //      tippt. Mit Strg oder Alt geht es, weil sich das nicht tippen laesst.

  function wireKeyboard() {
    document.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented) return;
      if (ev.isComposing || ev.keyCode === 229) return; // Eingabemethode laeuft
      if (document.querySelector('dialog[open]')) return; // Dialog hat Vorrang

      const mod = ev.ctrlKey || ev.metaKey;
      const typing = Util.isTextInput(ev.target);
      const inSelect = (ev.target.tagName || '').toUpperCase() === 'SELECT';

      if (mod && !ev.altKey) {
        const key = ev.key.toLowerCase();

        if (ev.shiftKey && key === 'f') {
          ev.preventDefault();
          resetFilters();
          Util.toast('Filter zurückgesetzt');
          return;
        }
        if (ev.shiftKey) return; // Strg + Umschalt + N liegt im Hauptprozess

        if (key === 'n') {
          ev.preventDefault();
          captureInput.focus();
          captureInput.select();
          return;
        }
        if (key === 'f') {
          ev.preventDefault();
          searchInput.focus();
          searchInput.select();
          return;
        }
        if (key === '1') {
          ev.preventDefault();
          State.setView('tag');
          return;
        }
        if (key === '2') {
          ev.preventDefault();
          State.setView('woche');
          return;
        }
        if (key === 'e') {
          ev.preventDefault();
          Dialogs.openExport();
          return;
        }
        if (key === ',') {
          ev.preventDefault();
          Dialogs.openSettings();
          return;
        }
        return;
      }

      // Alt + Pfeil blaettert - ausser in einer Auswahlliste, dort klappt
      // Alt + Ab das Menue auf.
      if (ev.altKey && !mod && !inSelect) {
        if (ev.key === 'ArrowLeft') {
          ev.preventDefault();
          State.shift(-1);
          return;
        }
        if (ev.key === 'ArrowRight') {
          ev.preventDefault();
          State.shift(1);
          return;
        }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          State.goToday();
          return;
        }
      }
      if (ev.altKey || mod) return;

      // Ab hier: Kuerzel ohne Steuertaste.
      if (ev.key === 'F1') {
        ev.preventDefault();
        Dialogs.openHelp();
        return;
      }
      if (typing) return;

      if (ev.key === 'Escape') {
        if (State.get().editingId) State.set({ editingId: null });
        else if (anyFilter(State.get())) resetFilters();
      }
    });
  }

  // -------------------------------------------------------------------- Theme

  async function applyTheme() {
    const res = await api.getTheme();
    if (res.ok) setThemeAttribute(res.theme);
    api.onThemeChanged(setThemeAttribute);
  }

  function setThemeAttribute(theme) {
    document.documentElement.dataset.theme = theme.dark ? 'dark' : 'light';
  }

  // ------------------------------------------------------------ Statuszeile

  function wireSaveStatus() {
    api.onStatusChanged((status) => {
      saveStatus = status;
      renderSaveState();
    });
    api
      .getStatus()
      .then((res) => {
        if (res && res.ok) {
          saveStatus = res.status;
          renderSaveState();
        }
      })
      .catch(() => {
        /* Ohne Auskunft bleibt die rechte Seite einfach leer. */
      });
  }

  /** Rechts in der Statuszeile: der Zustand der Ablage, sonst nichts. */
  function renderSaveState() {
    const node = el('#saveState');
    if (!node) return;
    const status = saveStatus;
    if (!status) {
      node.textContent = '';
      return;
    }

    const problem = (status.problems || []).find((p) => p.level === 'error');
    let text = 'Bereit';
    let hint = '';
    let bad = false;

    if (status.readOnly) {
      text = 'Nur Lesezugriff';
      hint = status.readOnlyReason || '';
      bad = true;
    } else if (problem || status.lastError) {
      text = status.retrying ? 'Speichern wird wiederholt' : 'Nicht gespeichert';
      hint = (problem && problem.message) || (status.lastError && status.lastError.message) || '';
      bad = true;
    } else if (status.pendingChanges) {
      text = 'Wird gespeichert …';
    } else if (status.lastSaveAt) {
      text = 'Gespeichert ' + Dates.formatTime(status.lastSaveAt);
      hint = Dates.formatDateTime(status.lastSaveAt);
    }

    node.textContent = text;
    node.title = hint;
    node.classList.toggle('is-error', bad);
  }

  // ------------------------------------------------------------------ Render

  function render() {
    const state = State.get();
    if (!state.ready) return;

    // Aktive Ansicht markieren
    Util.els('#viewTabs .tab').forEach((tab) => {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    Util.els('#statusFilter button').forEach((btn) => {
      const active = btn.dataset.status === state.filterStatus;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    el('#sourceFilter').value = state.filterSource || '';
    syncTagFilter();

    renderDateLabel();

    // Der Knopf tritt nur hervor, wenn man gerade *nicht* auf heute steht.
    const onToday =
      state.view === 'woche' ? State.weekDays().includes(Dates.todayKey()) : state.cursorDay === Dates.todayKey();
    el('#btnToday').classList.toggle('is-highlight', !onToday);

    renderActiveFilters();

    // Scrollposition ueber den Neuaufbau retten
    const scrollTop = viewRoot.scrollTop;
    Util.clear(viewRoot);
    if (state.view === 'woche') Views.renderWeek(viewRoot);
    else Views.renderDay(viewRoot);
    viewRoot.scrollTop = scrollTop;

    renderStatusbar();
  }

  function renderStatusbar() {
    const state = State.get();
    const open = state.items.filter((i) => i.status !== 'erledigt');
    const today = Dates.todayKey();
    const doneToday = state.items.filter((i) => i.status === 'erledigt' && i.day === today).length;

    // Wie stark der Filter im gerade sichtbaren Zeitraum greift
    const days = state.view === 'woche' ? State.weekDays() : [state.cursorDay];
    const inScope = state.items.filter((i) => days.includes(i.day));
    const visible = inScope.filter((i) => State.matchesFilter(i)).length;
    const filtered = anyFilter(state);

    el('#statusText').textContent =
      `${Util.plural(state.items.length, 'Aufgabe', 'Aufgaben')} insgesamt · ` +
      `${open.length} offen · heute ${doneToday} erledigt` +
      (filtered ? ` · ${visible} von ${inScope.length} sichtbar` : '');

    el('#filterHint').textContent = filtered ? 'Strg + Umschalt + F setzt alles zurück' : '';
  }

  document.addEventListener('DOMContentLoaded', init);

  return { captureInto, render };
})();
