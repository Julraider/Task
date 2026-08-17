/**
 * Datenmodell-Konstanten fuer Tagwerk.
 *
 * Eine Aufgabe (Item):
 * {
 *   id:        'itm_...'          eindeutige ID
 *   title:     'Rechner fuer XY bestellen'
 *   notes:     ''                 Freitext, mehrzeilig
 *   source:    'teams'            woher kam die Aufgabe (siehe SOURCES)
 *   status:    'offen'            siehe STATUSES
 *   priority:  0 | 1 | 2          normal / hoch / dringend
 *   ref:       'INC0012345'       Ticketnummer o.ae., optional
 *   tags:      ['netzwerk']
 *   day:       '2026-08-17'       Arbeitstag, dem die Aufgabe zugeordnet ist
 *   createdAt: ISO-String
 *   updatedAt: ISO-String
 *   doneAt:    ISO-String | null
 * }
 *
 * Laeuft in Main (require) und Renderer (global `Model`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SOURCES = [
    { id: 'teams', label: 'Teams', icon: '💬', aliases: ['teams', 'chat', 'ms'] },
    { id: 'mail', label: 'Outlook / Mail', icon: '✉️', aliases: ['mail', 'outlook', 'email', 'mailbox'] },
    { id: 'ticket', label: 'ServiceNow / Ticket', icon: '🎫', aliases: ['ticket', 'servicenow', 'snow', 'sn', 'inc'] },
    { id: 'jira', label: 'Jira / Projekt', icon: '🧩', aliases: ['jira', 'issue', 'backlog', 'sprint', 'story'] },
    { id: 'muendlich', label: 'Mündlich', icon: '🗣️', aliases: ['muendlich', 'mündlich', 'zuruf', 'flur', 'tuer', 'tür'] },
    { id: 'telefon', label: 'Telefon', icon: '☎️', aliases: ['telefon', 'anruf', 'call', 'phone'] },
    { id: 'meeting', label: 'Meeting', icon: '📅', aliases: ['meeting', 'termin', 'besprechung', 'jourfixe', 'jf'] },
    { id: 'vorort', label: 'Vor Ort', icon: '🚶', aliases: ['vorort', 'vor-ort', 'onsite', 'begehung', 'werkstatt', 'baustelle'] },
    { id: 'wiki', label: 'Wiki / Doku', icon: '📚', aliases: ['wiki', 'doku', 'dokumentation', 'confluence', 'sharepoint'] },
    { id: 'selbst', label: 'Eigene Notiz', icon: '📝', aliases: ['selbst', 'eigen', 'idee', 'ich', 'me'] },
    { id: 'sonstiges', label: 'Sonstiges', icon: '📌', aliases: ['sonstiges', 'sonst', 'misc', 'other'] },
  ];

  const DEFAULT_SOURCE = 'sonstiges';

  const STATUSES = [
    { id: 'offen', label: 'Offen', icon: '○', short: 'Offen' },
    { id: 'aktiv', label: 'In Arbeit', icon: '◐', short: 'Aktiv' },
    { id: 'wartet', label: 'Wartet / blockiert', icon: '⏸', short: 'Wartet' },
    { id: 'erledigt', label: 'Erledigt', icon: '✓', short: 'Erledigt' },
  ];

  const DEFAULT_STATUS = 'offen';

  /** Reihenfolge beim Durchklicken des Status-Buttons. */
  const STATUS_CYCLE = ['offen', 'aktiv', 'wartet', 'erledigt'];

  const PRIORITIES = [
    { id: 0, label: 'Normal', icon: '', short: '' },
    { id: 1, label: 'Hoch', icon: '!', short: 'Hoch' },
    { id: 2, label: 'Dringend', icon: '!!', short: 'Dringend' },
  ];

  /** Sortierung innerhalb eines Tages: offen zuerst, dann Prioritaet, dann Alter. */
  const STATUS_ORDER = { aktiv: 0, offen: 1, wartet: 2, erledigt: 3 };

  function sourceById(id) {
    return SOURCES.find((s) => s.id === id) || SOURCES.find((s) => s.id === DEFAULT_SOURCE);
  }

  function statusById(id) {
    return STATUSES.find((s) => s.id === id) || STATUSES.find((s) => s.id === DEFAULT_STATUS);
  }

  function priorityById(id) {
    return PRIORITIES.find((p) => p.id === Number(id)) || PRIORITIES[0];
  }

  function isOpen(item) {
    return item.status !== 'erledigt';
  }

  function nextStatus(status) {
    const i = STATUS_CYCLE.indexOf(status);
    return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
  }

  /**
   * Vergleichsfunktion fuer die Anzeige einer Tagesliste:
   * Status (aktiv, offen, wartet, erledigt), dann Prioritaet, dann Alter.
   * Erledigtes wird nach dem Zeitpunkt des Abhakens sortiert - so liest sich
   * ein Tagesbericht wie der Tagesablauf.
   */
  function compareItems(a, b) {
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    if (a.status === 'erledigt' && b.status === 'erledigt' && a.doneAt && b.doneAt) {
      const byDone = String(a.doneAt).localeCompare(String(b.doneAt));
      if (byDone) return byDone;
    }
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    const byAge = String(a.createdAt).localeCompare(String(b.createdAt));
    if (byAge) return byAge;
    return String(a.id).localeCompare(String(b.id)); // stabil, auch bei gleichem Zeitstempel
  }

  /** Wie compareItems, aber ueber mehrere Tage hinweg (Tag zuerst). */
  function compareByDay(a, b) {
    const byDay = String(a.day || '').localeCompare(String(b.day || ''));
    return byDay || compareItems(a, b);
  }

  return {
    SOURCES,
    STATUSES,
    PRIORITIES,
    STATUS_CYCLE,
    STATUS_ORDER,
    DEFAULT_SOURCE,
    DEFAULT_STATUS,
    sourceById,
    statusById,
    priorityById,
    isOpen,
    nextStatus,
    compareItems,
    compareByDay,
  };
});
