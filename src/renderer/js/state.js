/*
 * Zustand des Renderers + alle Aktionen, die Daten aendern.
 *
 * Die Wahrheit liegt im Main-Prozess: jede Aenderung geht per IPC dorthin,
 * und der Main-Prozess schickt danach den kompletten Datenstand zurueck
 * ('data:changed'). Dadurch koennen Hauptfenster und Schnellerfassung nie
 * auseinanderlaufen.
 */
window.State = (function () {
  const api = window.tagwerk;
  const listeners = new Set();

  const state = {
    ready: false,
    items: [],
    settings: {},
    // Ansicht
    view: 'tag', // 'tag' | 'woche'
    cursorDay: Dates.todayKey(),
    // Filter
    search: '',
    filterStatus: 'alle', // 'alle' | 'offen' | 'erledigt'
    filterSource: null,
    filterTag: null,
    // UI
    editingId: null,
    expanded: new Set(),
    showOverdue: true,
  };

  function get() {
    return state;
  }

  function set(patch, options = {}) {
    Object.assign(state, patch);
    if (!options.silent) emit();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function emit() {
    for (const fn of listeners) fn(state);
  }

  // ------------------------------------------------------------ Abgeleitetes

  /** Tage, die die Wochenansicht zeigt. */
  function weekDays(day) {
    const start = Dates.startOfWeek(day || state.cursorDay);
    return Dates.daysFrom(start, state.settings.showWeekend ? 7 : 5);
  }

  function matchesFilter(item) {
    if (state.filterStatus === 'offen' && item.status === 'erledigt') return false;
    if (state.filterStatus === 'erledigt' && item.status !== 'erledigt') return false;
    if (state.filterSource && item.source !== state.filterSource) return false;
    if (state.filterTag && !(item.tags || []).includes(state.filterTag)) return false;

    if (state.search.trim()) {
      const needle = Util.normalize(state.search.trim());
      const hay = Util.normalize(
        [item.title, item.notes, item.ref, (item.tags || []).join(' ')].filter(Boolean).join(' ')
      );
      if (!hay.includes(needle)) return false;
    }
    return true;
  }

  /** Aufgaben eines Tages, gefiltert und sortiert. */
  function itemsForDay(day) {
    return state.items.filter((i) => i.day === day && matchesFilter(i)).sort(Model.compareItems);
  }

  /** Ungefiltert - fuer Zaehler in der Wochenansicht. */
  function allForDay(day) {
    return state.items.filter((i) => i.day === day);
  }

  /** Offene Aufgaben aus der Vergangenheit (vor `day`). */
  function overdue(day) {
    const ref = day || state.cursorDay;
    return state.items
      .filter((i) => i.status !== 'erledigt' && i.day < ref && matchesFilter(i))
      .sort((a, b) => a.day.localeCompare(b.day) || Model.compareItems(a, b));
  }

  function counts(items) {
    const out = { gesamt: items.length, offen: 0, aktiv: 0, wartet: 0, erledigt: 0 };
    for (const i of items) out[i.status] = (out[i.status] || 0) + 1;
    return out;
  }

  /** Alle vergebenen Tags mit Haeufigkeit, meistgenutzte zuerst. */
  function allTags() {
    const map = new Map();
    for (const item of state.items) {
      for (const tag of item.tags || []) map.set(tag, (map.get(tag) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  // ------------------------------------------------------------------ Setup

  async function init() {
    const [data, settings] = await Promise.all([api.getData(), api.getSettings()]);
    if (data.ok) state.items = data.data.items;
    if (settings.ok) state.settings = settings.settings;
    state.ready = true;

    api.onDataChanged((snapshot) => {
      state.items = snapshot.items;
      emit();
    });
    api.onSettingsChanged((next) => {
      state.settings = next;
      emit();
    });

    emit();
    return state;
  }

  // --------------------------------------------------------------- Aktionen

  async function addFromInput(text, day) {
    const res = await api.addItem(text, day || state.cursorDay);
    if (!res.ok) {
      if (res.error) Util.toast(res.error, { tone: 'error' });
      return null;
    }
    // Wurde die Aufgabe per '>morgen' auf einen anderen Tag gelegt, kurz sagen wohin
    if (res.item && res.item.day !== (day || state.cursorDay)) {
      Util.toast(`Angelegt für ${Dates.relativeLabel(res.item.day)}`);
    }
    return res.item;
  }

  async function update(id, patch) {
    const res = await api.updateItem(id, patch);
    if (!res.ok && res.error) Util.toast(res.error, { tone: 'error' });
    return res.item;
  }

  async function cycleStatus(item) {
    return update(item.id, { status: Model.nextStatus(item.status) });
  }

  async function toggleDone(item) {
    return update(item.id, { status: item.status === 'erledigt' ? 'offen' : 'erledigt' });
  }

  async function remove(id) {
    const item = state.items.find((i) => i.id === id);
    if (state.settings.confirmDelete && item) {
      if (!window.confirm(`"${item.title}" wirklich löschen?`)) return null;
    }
    const res = await api.removeItem(id);
    if (!res.ok) return null;

    Util.toast('Gelöscht', {
      actionLabel: 'Rückgängig',
      onAction: () => api.restoreItems([res.item]),
    });
    return res.item;
  }

  async function move(ids, day) {
    const list = Array.isArray(ids) ? ids : [ids];
    const res = await api.moveItems(list, day);
    if (res.ok && res.count) {
      Util.toast(`${Util.plural(res.count, 'Aufgabe', 'Aufgaben')} → ${Dates.relativeLabel(day)}`);
    }
    return res;
  }

  async function clearDone(day) {
    const res = await api.clearDone(day);
    if (res.ok && res.count) {
      Util.toast(`${Util.plural(res.count, 'erledigte Aufgabe', 'erledigte Aufgaben')} entfernt`, {
        actionLabel: 'Rückgängig',
        onAction: () => api.restoreItems(res.items),
      });
    } else if (res.ok) {
      Util.toast('Nichts zu entfernen');
    }
    return res;
  }

  async function saveSettings(patch) {
    const res = await api.setSettings(patch);
    if (res.ok) {
      state.settings = res.settings;
      emit();
    }
    return res;
  }

  // ------------------------------------------------------------- Navigation

  function goToday() {
    set({ cursorDay: Dates.todayKey() });
  }

  function shift(direction) {
    const step = state.view === 'woche' ? 7 : 1;
    set({ cursorDay: Dates.addDays(state.cursorDay, direction * step) });
  }

  function setView(view) {
    set({ view, editingId: null });
  }

  function toggleExpanded(id) {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    emit();
  }

  return {
    get,
    set,
    subscribe,
    emit,
    init,
    // abgeleitet
    weekDays,
    itemsForDay,
    allForDay,
    overdue,
    counts,
    allTags,
    matchesFilter,
    // Aktionen
    addFromInput,
    update,
    cycleStatus,
    toggleDone,
    remove,
    move,
    clearDone,
    saveSettings,
    // Navigation
    goToday,
    shift,
    setView,
    toggleExpanded,
  };
})();
