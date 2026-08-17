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
  /*
   * Zwei Icon-Felder, mit Absicht:
   *   icon    das Emoji. Steht im Text- und im Mail-Export und ueberall dort,
   *           wo nur Zeichen durchgehen - da ist ein Emoji genau richtig.
   *   iconId  eine stabile, sprechende Kennung fuer das SVG-Icon der
   *           Oberflaeche. Die Kennung beschreibt das *Motiv*, nicht die
   *           Quelle - so bleibt sie gueltig, auch wenn eine Quelle einmal
   *           anders heisst. Neue Quelle = neue Kennung hier eintragen und im
   *           Icon-Satz der Oberflaeche hinterlegen; wer keine findet, faellt
   *           auf 'punkte' zurueck.
   */
  const SOURCES = [
    { id: 'teams', label: 'Teams', icon: '💬', iconId: 'chat', aliases: ['teams', 'chat', 'ms'] },
    { id: 'mail', label: 'Outlook / Mail', icon: '✉️', iconId: 'mail', aliases: ['mail', 'outlook', 'email', 'mailbox'] },
    { id: 'ticket', label: 'ServiceNow / Ticket', icon: '🎫', iconId: 'ticket', aliases: ['ticket', 'servicenow', 'snow', 'sn', 'inc'] },
    { id: 'jira', label: 'Jira / Projekt', icon: '🧩', iconId: 'puzzle', aliases: ['jira', 'issue', 'backlog', 'sprint', 'story'] },
    { id: 'muendlich', label: 'Mündlich', icon: '🗣️', iconId: 'sprechblase', aliases: ['muendlich', 'mündlich', 'zuruf', 'flur', 'tuer', 'tür'] },
    { id: 'telefon', label: 'Telefon', icon: '☎️', iconId: 'telefon', aliases: ['telefon', 'anruf', 'call', 'phone'] },
    { id: 'meeting', label: 'Meeting', icon: '📅', iconId: 'kalender', aliases: ['meeting', 'termin', 'besprechung', 'jourfixe', 'jf'] },
    { id: 'vorort', label: 'Vor Ort', icon: '🚶', iconId: 'standort', aliases: ['vorort', 'vor-ort', 'onsite', 'begehung', 'werkstatt', 'baustelle'] },
    { id: 'wiki', label: 'Wiki / Doku', icon: '📚', iconId: 'buch', aliases: ['wiki', 'doku', 'dokumentation', 'confluence', 'sharepoint'] },
    { id: 'selbst', label: 'Eigene Notiz', icon: '📝', iconId: 'notiz', aliases: ['selbst', 'eigen', 'idee', 'ich', 'me'] },
    { id: 'sonstiges', label: 'Sonstiges', icon: '📌', iconId: 'punkte', aliases: ['sonstiges', 'sonst', 'misc', 'other'] },
  ];

  const DEFAULT_SOURCE = 'sonstiges';

  /** `icon` ist das Zeichen fuer Text-Ausgaben, `iconId` das SVG der Oberflaeche. */
  const STATUSES = [
    { id: 'offen', label: 'Offen', icon: '○', iconId: 'kreis', short: 'Offen' },
    { id: 'aktiv', label: 'In Arbeit', icon: '◐', iconId: 'halbkreis', short: 'Aktiv' },
    { id: 'wartet', label: 'Wartet / blockiert', icon: '⏸', iconId: 'pause', short: 'Wartet' },
    { id: 'erledigt', label: 'Erledigt', icon: '✓', iconId: 'haken', short: 'Erledigt' },
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
