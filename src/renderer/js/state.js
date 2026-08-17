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
    groupBy: 'keine', // 'keine' | 'status' | 'quelle' - Gruppierung der Tagesliste
    // Filter
    search: '',
    filterStatus: 'alle', // 'alle' | 'offen' | 'erledigt'
    filterSource: null,
    filterTag: null,
    // UI
    editingId: null,
    expanded: new Set(),
    showOverdue: true,
    showAllOverdue: false, // Ueberfaellig-Liste vollstaendig oder gekuerzt
    focusId: null, // Tastatur-Cursor in der Liste
    selected: new Set(), // Mehrfachauswahl fuer Massenaktionen
    selectionAnchor: null, // Ausgangspunkt fuer Umschalt-Auswahl
    draft: null, // ungespeicherter Inhalt der offenen Bearbeitungsmaske
  };

  function get() {
    return state;
  }

  function set(patch, options = {}) {
    // Wird die Bearbeitung gewechselt oder beendet, ist der Zwischenstand hin.
    if ('editingId' in patch && patch.editingId !== state.editingId) state.draft = null;
    Object.assign(state, patch);
    if (!options.silent) emit();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * Neuzeichnen anfordern.
   *
   * Mehrere Aenderungen kurz hintereinander (Massenaktion, mehrere
   * 'data:changed' aus anderen Fenstern) ergeben nur einen Neuaufbau pro Bild.
   */
  let frame = 0;
  function emit() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const fn of listeners) fn(state);
    });
  }

  // ------------------------------------------------------------ Abgeleitetes
  //
  // Tagesliste, Sortierung und Suchtexte haengen nur an den Aufgaben selbst.
  // Sie werden einmal pro Datenstand berechnet und danach wiederverwendet -
  // sonst sortiert jeder Tastendruck in der Suche die komplette Liste neu.

  let revision = 0;
  let cache = { revision: -1 };
  const haystacks = new WeakMap();

  function derived() {
    if (cache.revision === revision) return cache;

    const byDay = new Map();
    const byId = new Map();
    const open = [];
    const tags = new Map();

    for (const item of state.items) {
      byId.set(item.id, item);
      let bucket = byDay.get(item.day);
      if (!bucket) byDay.set(item.day, (bucket = []));
      bucket.push(item);
      if (item.status !== 'erledigt') open.push(item);
      for (const tag of item.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
    }

    for (const bucket of byDay.values()) bucket.sort(Model.compareItems);
    open.sort((a, b) => a.day.localeCompare(b.day) || Model.compareItems(a, b));

    cache = {
      revision,
      byDay,
      byId,
      open,
      tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    };
    return cache;
  }

  /** Neuen Datenstand uebernehmen und alles Abgeleitete verwerfen. */
  function setItems(items) {
    state.items = items;
    revision++;
    forgetVanished();
  }

  /** IDs, die es nicht mehr gibt, aus den UI-Mengen entfernen. */
  function forgetVanished() {
    if (!state.expanded.size && !state.selected.size && !state.focusId && !state.editingId) return;
    const { byId } = derived();
    for (const id of [...state.expanded]) if (!byId.has(id)) state.expanded.delete(id);
    for (const id of [...state.selected]) if (!byId.has(id)) state.selected.delete(id);
    if (state.focusId && !byId.has(state.focusId)) state.focusId = null;
    if (state.editingId && !byId.has(state.editingId)) {
      state.editingId = null;
      state.draft = null;
    }
  }

  function itemById(id) {
    return derived().byId.get(id) || null;
  }

  /** Tage, die die Wochenansicht zeigt. */
  function weekDays(day) {
    const start = Dates.startOfWeek(day || state.cursorDay);
    return Dates.daysFrom(start, state.settings.showWeekend ? 7 : 5);
  }

  /** Ist ueberhaupt ein Filter gesetzt? */
  function filtersActive() {
    return !!(state.filterSource || state.filterTag || state.search.trim() || state.filterStatus !== 'alle');
  }

  // Der Suchbegriff wird einmal normalisiert, nicht einmal pro Aufgabe.
  let needleSource = null;
  let needle = '';
  function searchNeedle() {
    const raw = state.search.trim();
    if (raw !== needleSource) {
      needleSource = raw;
      needle = raw ? Util.normalize(raw) : '';
    }
    return needle;
  }

  /** Durchsuchbarer Text einer Aufgabe, gemerkt am Objekt selbst. */
  function haystack(item) {
    let hay = haystacks.get(item);
    if (hay === undefined) {
      hay = Util.normalize(
        [item.title, item.notes, item.ref, (item.tags || []).join(' ')].filter(Boolean).join(' ')
      );
      haystacks.set(item, hay);
    }
    return hay;
  }

  function matchesFilter(item) {
    if (state.filterStatus === 'offen' && item.status === 'erledigt') return false;
    if (state.filterStatus === 'erledigt' && item.status !== 'erledigt') return false;
    if (state.filterSource && item.source !== state.filterSource) return false;
    if (state.filterTag && !(item.tags || []).includes(state.filterTag)) return false;

    const search = searchNeedle();
    if (search && !haystack(item).includes(search)) return false;
    return true;
  }

  /**
   * Aufgaben eines Tages, gefiltert und sortiert.
   * Das Ergebnis wird nur gelesen, nie veraendert.
   */
  function itemsForDay(day) {
    const bucket = derived().byDay.get(day);
    if (!bucket) return [];
    return filtersActive() ? bucket.filter(matchesFilter) : bucket;
  }

  /** Ungefiltert - fuer Zaehler in der Wochenansicht. */
  function allForDay(day) {
    return derived().byDay.get(day) || [];
  }

  /** Offene Aufgaben aus der Vergangenheit (vor `day`). */
  function overdue(day) {
    const ref = day || state.cursorDay;
    const open = derived().open; // bereits nach Tag und Prioritaet sortiert
    const out = [];
    for (const item of open) {
      if (item.day >= ref) break; // sortiert - ab hier kommt nur noch Zukunft
      if (matchesFilter(item)) out.push(item);
    }
    return out;
  }

  function counts(items) {
    const out = { gesamt: items.length, offen: 0, aktiv: 0, wartet: 0, erledigt: 0 };
    for (const i of items) out[i.status] = (out[i.status] || 0) + 1;
    return out;
  }

  /** Alle vergebenen Tags mit Haeufigkeit, meistgenutzte zuerst. */
  function allTags() {
    return derived().tags;
  }

  // ------------------------------------------------------------------ Setup

  async function init() {
    const [data, settings] = await Promise.all([api.getData(), api.getSettings()]);
    if (data.ok) setItems(data.data.items);
    if (settings.ok) state.settings = settings.settings;
    state.ready = true;

    api.onDataChanged((snapshot) => {
      setItems(snapshot.items);
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

  /** Massenaktion: mehrere Aufgaben auf denselben Status setzen. */
  async function setStatusFor(ids, status) {
    const list = [...new Set(ids)];
    let done = 0;
    for (const id of list) {
      const res = await api.updateItem(id, { status });
      if (res && res.ok) done++;
    }
    if (done) {
      Util.toast(`${Util.plural(done, 'Aufgabe', 'Aufgaben')} → ${Model.statusById(status).label}`);
    }
    return done;
  }

  async function remove(id) {
    const item = itemById(id);
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
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => {
      const item = itemById(id);
      return item && item.day !== day; // was schon dort liegt, muss nicht wandern
    });
    if (!list.length) return { ok: true, count: 0 };

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

  // -------------------------------------------------------- Mehrfachauswahl
  //
  // `order` ist die Reihenfolge, in der die Karten gerade auf dem Schirm
  // stehen - nur so kann die Umschalt-Auswahl einen Bereich aufspannen.

  let order = [];

  function setOrder(ids) {
    order = ids;
  }

  function isSelected(id) {
    return state.selected.has(id);
  }

  function toggleSelect(id) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    state.selectionAnchor = id;
    emit();
  }

  /** Von der zuletzt angeklickten Karte bis hierher alles auswaehlen. */
  function selectRange(id) {
    const anchor = state.selectionAnchor || state.focusId;
    const from = order.indexOf(anchor);
    const to = order.indexOf(id);
    if (from < 0 || to < 0) {
      state.selected.add(id);
    } else {
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) state.selected.add(order[i]);
    }
    emit();
  }

  function clearSelection() {
    if (!state.selected.size) return false;
    state.selected.clear();
    state.selectionAnchor = null;
    emit();
    return true;
  }

  /** IDs der Auswahl - oder, wenn nichts ausgewaehlt ist, die uebergebene ID. */
  function selectionOr(id) {
    if (id && state.selected.has(id) && state.selected.size > 1) return [...state.selected];
    if (!id) return [...state.selected];
    return [id];
  }

  async function moveSelection(day) {
    const ids = [...state.selected];
    if (!ids.length) return null;
    const res = await move(ids, day);
    clearSelection();
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

  /** Tastatur-Cursor merken - ohne Neuaufbau, die Klasse setzt die Ansicht. */
  function setFocus(id) {
    state.focusId = id;
  }

  // ------------------------------------------------ Zwischenstand im Editor
  //
  // Solange bearbeitet wird, liegt der getippte Text hier. Baut ein Ereignis
  // aus einem anderen Fenster die Liste neu auf, ueberlebt die Eingabe.

  function draftFor(id) {
    return state.draft && state.draft.id === id ? state.draft : null;
  }

  function startDraft(id, values) {
    state.draft = Object.assign({ id }, values);
    return state.draft;
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
    filtersActive,
    itemById,
    // Aktionen
    addFromInput,
    update,
    cycleStatus,
    toggleDone,
    setStatusFor,
    remove,
    move,
    clearDone,
    saveSettings,
    // Auswahl
    setOrder,
    isSelected,
    toggleSelect,
    selectRange,
    clearSelection,
    selectionOr,
    moveSelection,
    // Navigation
    goToday,
    shift,
    setView,
    toggleExpanded,
    setFocus,
    // Editor
    draftFor,
    startDraft,
  };
})();
