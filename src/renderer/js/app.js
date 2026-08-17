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

    searchInput.addEventListener(
      'input',
      Util.debounce(() => State.set({ search: searchInput.value }), 120)
    );
  }

  // --------------------------------------------------------- Erfassungszeile

  function wireCapture() {
    el('#captureForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = captureInput.value.trim();
      if (!text) return;

      const created = await State.addFromInput(text, State.get().cursorDay);
      if (created) {
        captureInput.value = '';
        updatePreview();
        captureInput.focus();
      }
    });

    captureInput.addEventListener('input', updatePreview);
    captureInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        captureInput.value = '';
        updatePreview();
      }
    });
  }

  /** Zeigt live, was aus der Eingabe erkannt wurde. */
  function updatePreview() {
    const text = captureInput.value;
    Util.clear(capturePreview);
    if (!text.trim()) {
      capturePreview.classList.remove('is-visible');
      return;
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
  }

  function renderActiveFilters() {
    const state = State.get();
    const host = Util.clear(el('#activeFilters'));

    if (state.filterTag) {
      host.appendChild(
        h('button', {
          class: 'chip chip--tag chip--removable',
          title: 'Tag-Filter entfernen',
          onclick: () => State.set({ filterTag: null }),
        }, '#' + state.filterTag + ' ×')
      );
    }

    if (state.search.trim()) {
      host.appendChild(
        h('button', {
          class: 'chip chip--search chip--removable',
          title: 'Suche löschen',
          onclick: () => {
            searchInput.value = '';
            State.set({ search: '' });
          },
        }, '„' + state.search.trim() + '" ×')
      );
    }
  }

  // -------------------------------------------------------------- Tastatur

  function wireKeyboard() {
    document.addEventListener('keydown', (ev) => {
      const mod = ev.ctrlKey || ev.metaKey;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes((ev.target.tagName || '').toUpperCase());

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
        else if (State.get().search) {
          searchInput.value = '';
          State.set({ search: '' });
        }
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
      tab.classList.toggle('is-active', tab.dataset.view === state.view);
    });
    Util.els('#statusFilter button').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.status === state.filterStatus);
    });
    el('#sourceFilter').value = state.filterSource || '';

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

    const filtered = state.filterSource || state.filterTag || state.search.trim() || state.filterStatus !== 'alle';
    el('#filterHint').textContent = filtered ? 'Filter aktiv' : '';
  }

  document.addEventListener('DOMContentLoaded', init);

  return { captureInto, render };
})();
