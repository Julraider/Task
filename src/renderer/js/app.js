/*
 * Zusammenbau: Kopfzeile, Erfassungszeile, Filter, Tastenkuerzel.
 */
window.App = (function () {
  const { h, el } = Util;
  const api = window.tagwerk;

  let viewRoot;
  let captureInput;
  let capturePreview;
  let searchInput;

  /** Signatur der zuletzt gebauten Schlagwort-Liste - spart unnoetiges Neubauen. */
  let tagFilterKey = null;

  /**
   * Zustand der Vervollstaendigung in der Erfassungszeile.
   * `ghost` ist gesetzt, solange der ergaenzte Rest im Feld markiert ist.
   */
  let ghost = null; // { sign, typed, start, candidates, index }

  // ------------------------------------------------------------------ Start

  async function init() {
    viewRoot = el('#viewRoot');
    captureInput = el('#captureInput');
    capturePreview = el('#capturePreview');
    searchInput = el('#searchInput');

    buildSourceFilter();
    wireTopbar();
    wireCapture();
    wireFilters();
    wireKeyboard();
    await applyTheme();

    State.subscribe(render);
    await State.init();

    captureInput.focus();
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
    el('#btnQuick').addEventListener('click', () => api.quickOpen());
    el('#btnQuickTop').addEventListener('click', () => api.quickOpen());

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

  // --------------------------------------------------------- Erfassungszeile

  function wireCapture() {
    el('#captureForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      ghost = null;
      const text = captureInput.value.trim();
      if (!text) {
        captureInput.focus();
        return;
      }

      const created = await State.addFromInput(text, State.get().cursorDay);
      if (created) {
        captureInput.value = '';
        updatePreview();
        captureInput.focus();
      }
    });

    captureInput.addEventListener('input', (ev) => {
      // Nur beim Tippen ergaenzen, nicht beim Loeschen - sonst kaempft man
      // gegen das eigene Feld an.
      const typing = !ev.inputType || ev.inputType.startsWith('insert');
      refreshCompletion(typing);
      updatePreview();
    });

    captureInput.addEventListener('keydown', onCaptureKey);
    captureInput.addEventListener('blur', () => {
      ghost = null;
      updatePreview();
    });
  }

  function onCaptureKey(ev) {
    if (ev.key === 'Tab' && ghost && ghost.candidates.length > 1) {
      ev.preventDefault();
      applyGhost(ghost.index + (ev.shiftKey ? -1 : 1));
      updatePreview();
      return;
    }
    if (ev.key === 'Escape') {
      ev.stopPropagation(); // nicht bis zur Listen-Navigation durchreichen
      if (ghost && ghost.applied) {
        ev.preventDefault();
        revertGhost();
        updatePreview();
        return;
      }
      if (captureInput.value) {
        ev.preventDefault();
        captureInput.value = '';
        updatePreview();
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
    updatePreview();
  }

  // --------------------------------------------------------------- Vorschau

  /** Zeigt live, was aus der Eingabe erkannt wurde - und was man ergaenzen kann. */
  function updatePreview() {
    const text = captureInput.value;
    Util.clear(capturePreview);
    if (!text.trim() && !ghost) {
      capturePreview.classList.remove('is-visible');
      return;
    }

    if (ghost) {
      capturePreview.append(
        h('span', { class: 'capture__suggestLabel' }, ghost.candidates.length > 1 ? 'Tab ⇥' : 'Vorschlag'),
        ...ghost.candidates.slice(0, 8).map((word, i) =>
          h('button', {
            type: 'button',
            class: 'chip chip--suggest' + (i === ghost.index ? ' is-active' : ''),
            title: 'Übernehmen',
            onmousedown: (ev) => ev.preventDefault(), // Fokus bleibt im Feld
            onclick: () => pickSuggestion(i),
          }, ghost.sign + word)
        )
      );
    }

    const parsed = Parse.parseCapture(text, State.get().cursorDay);
    const chips = [];

    const source = Model.sourceById(parsed.source);
    chips.push(chip(`${source.icon} ${source.label}`, parsed.sourceExplicit ? 'source' : 'source muted'));

    if (parsed.priority > 0) chips.push(chip('Priorität: ' + Model.priorityById(parsed.priority).label, 'prio'));
    for (const tag of parsed.tags) chips.push(chip('#' + tag, 'tag'));
    if (parsed.ref) chips.push(chip(parsed.ref, 'ref'));
    if (parsed.day !== State.get().cursorDay) chips.push(chip('→ ' + Dates.relativeLabel(parsed.day), 'day'));

    capturePreview.append(...chips);
    capturePreview.classList.add('is-visible');
  }

  function chip(text, kind) {
    return h('span', { class: 'chip chip--' + kind.split(' ')[0] + (kind.includes('muted') ? ' is-muted' : '') }, text);
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
      ...Model.SOURCES.map((s) => h('option', { value: s.id }, `${s.icon} ${s.label}`))
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

  /** Zeigt jeden aktiven Filter als abwaehlbaren Chip. */
  function renderActiveFilters() {
    const state = State.get();
    const host = Util.clear(el('#activeFilters'));

    const removable = (label, title, onRemove, kind) =>
      h('button', {
        class: 'chip chip--' + kind + ' chip--removable',
        type: 'button',
        title,
        onclick: onRemove,
      }, label + ' ×');

    if (state.filterStatus !== 'alle') {
      host.appendChild(
        removable(
          state.filterStatus === 'offen' ? 'Nur Offene' : 'Nur Erledigte',
          'Status-Filter entfernen',
          () => State.set({ filterStatus: 'alle' }),
          'status'
        )
      );
    }

    if (state.filterSource) {
      const src = Model.sourceById(state.filterSource);
      host.appendChild(
        removable(`${src.icon} ${src.label}`, 'Quellen-Filter entfernen', () => State.set({ filterSource: null }), 'source')
      );
    }

    if (state.filterTag) {
      host.appendChild(
        removable('#' + state.filterTag, 'Schlagwort-Filter entfernen', () => State.set({ filterTag: null }), 'tag')
      );
    }

    if (state.search.trim()) {
      host.appendChild(
        removable('„' + state.search.trim() + '"', 'Suche löschen', () => {
          searchInput.value = '';
          State.set({ search: '' });
        }, 'search')
      );
    }

    el('#btnResetFilters').hidden = !anyFilter(state);
  }

  // -------------------------------------------------------------- Tastatur

  function wireKeyboard() {
    document.addEventListener('keydown', (ev) => {
      const mod = ev.ctrlKey || ev.metaKey;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes((ev.target.tagName || '').toUpperCase());

      // Solange ein Dialog offen ist, gehoert die Tastatur ihm.
      if (document.querySelector('dialog[open]')) return;

      if (mod && ev.shiftKey && ev.key.toLowerCase() === 'f') {
        ev.preventDefault();
        resetFilters();
        Util.toast('Filter zurückgesetzt');
        return;
      }
      if (mod && ev.key.toLowerCase() === 'n') {
        ev.preventDefault();
        captureInput.focus();
        captureInput.select();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'f') {
        ev.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }
      if (mod && ev.key === '1') {
        ev.preventDefault();
        State.setView('tag');
        return;
      }
      if (mod && ev.key === '2') {
        ev.preventDefault();
        State.setView('woche');
        return;
      }
      if (mod && ev.key.toLowerCase() === 'e') {
        ev.preventDefault();
        Dialogs.openExport();
        return;
      }
      if (mod && ev.key === ',') {
        ev.preventDefault();
        Dialogs.openSettings();
        return;
      }
      if (ev.altKey && ev.key === 'ArrowLeft') {
        ev.preventDefault();
        State.shift(-1);
        return;
      }
      if (ev.altKey && ev.key === 'ArrowRight') {
        ev.preventDefault();
        State.shift(1);
        return;
      }
      if (ev.altKey && ev.key === 'ArrowDown') {
        ev.preventDefault();
        State.goToday();
        return;
      }
      if (ev.key === 'F1') {
        ev.preventDefault();
        Dialogs.openHelp();
        return;
      }
      if (ev.key === 'Escape' && !inField) {
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

    // Der Hinweis erscheint nur, wenn man gerade *nicht* auf heute steht -
    // sonst wiederholt er bloss die Ueberschrift darunter.
    const onToday =
      state.view === 'woche' ? State.weekDays().includes(Dates.todayKey()) : state.cursorDay === Dates.todayKey();

    el('#dateLabel').textContent = onToday
      ? ''
      : state.view === 'woche'
        ? `${Dates.isoWeekLabel(state.cursorDay)} / ${Dates.isoWeek(state.cursorDay).year}`
        : Dates.relativeLabel(state.cursorDay);
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

    el('#statusText').textContent =
      `${Util.plural(state.items.length, 'Aufgabe', 'Aufgaben')} insgesamt · ` +
      `${open.length} offen · heute ${doneToday} erledigt`;

    // Wie stark der Filter im gerade sichtbaren Zeitraum greift
    const days = state.view === 'woche' ? State.weekDays() : [state.cursorDay];
    const inScope = state.items.filter((i) => days.includes(i.day));
    const visible = inScope.filter((i) => State.matchesFilter(i)).length;

    el('#filterHint').textContent = anyFilter(state)
      ? `Filter aktiv · ${visible} von ${Util.plural(inScope.length, 'Aufgabe', 'Aufgaben')} sichtbar`
      : '';
  }

  document.addEventListener('DOMContentLoaded', init);

  return { captureInto, render };
})();
