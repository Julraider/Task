/**
 * Datums-Helfer fuer Tagwerk.
 *
 * Ein "Tagesschluessel" ist immer ein String 'YYYY-MM-DD' in *lokaler* Zeit.
 * Absichtlich kein UTC/ISO-String: sonst landen Aufgaben, die abends um 23 Uhr
 * erfasst werden, im naechsten Tag.
 *
 * Die Datei laeuft sowohl im Main-Prozess (require) als auch im Renderer
 * (<script src=...>, dann als globales `Dates`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** Date -> 'YYYY-MM-DD' (lokal) */
  function keyOf(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function todayKey() {
    return keyOf(new Date());
  }

  /**
   * 'YYYY-MM-DD' -> Date auf 12:00 Uhr lokal.
   * Mittag statt Mitternacht, damit Sommerzeit-Umstellungen beim Addieren von
   * Tagen nicht auf den Vor-/Folgetag kippen.
   */
  function parseKey(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function isValidKey(key) {
    return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(parseKey(key).getTime());
  }

  function addDays(key, n) {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return keyOf(d);
  }

  /** Differenz in Tagen: b - a */
  function diffDays(a, b) {
    return Math.round((parseKey(b) - parseKey(a)) / 86400000);
  }

  /** Wochentag 0=So .. 6=Sa */
  function weekday(key) {
    return parseKey(key).getDay();
  }

  function isWeekend(key) {
    const w = weekday(key);
    return w === 0 || w === 6;
  }

  /** Montag der Woche, in der `key` liegt. */
  function startOfWeek(key) {
    const w = weekday(key);
    const back = w === 0 ? 6 : w - 1; // Montag als Wochenstart
    return addDays(key, -back);
  }

  /** Liste von Tagesschluesseln ab `startKey`. */
  function daysFrom(startKey, count) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(addDays(startKey, i));
    return out;
  }

  /** Alle Tage von `startKey` bis `endKey` (beide inklusive). Leer, wenn Ende vor Start. */
  function daysBetween(startKey, endKey) {
    const span = diffDays(startKey, endKey);
    if (span < 0) return [];
    return daysFrom(startKey, span + 1);
  }

  /** Die letzten `count` Tage bis einschliesslich `endKey` (default: heute). */
  function lastDays(count, endKey) {
    const end = endKey || todayKey();
    const n = Math.max(1, Number(count) || 1);
    return daysFrom(addDays(end, -(n - 1)), n);
  }

  /** Erster Tag des Monats, in dem `key` liegt. */
  function startOfMonth(key) {
    const d = parseKey(key);
    return keyOf(new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0));
  }

  /** Letzter Tag des Monats, in dem `key` liegt (Tag 0 des Folgemonats). */
  function endOfMonth(key) {
    const d = parseKey(key);
    return keyOf(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0, 0));
  }

  /** ISO-8601 Kalenderwoche { year, week } */
  function isoWeek(key) {
    const d = parseKey(key);
    d.setHours(0, 0, 0, 0);
    // Donnerstag derselben Woche bestimmt das ISO-Jahr
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const isoYear = d.getFullYear();
    const jan4 = new Date(isoYear, 0, 4);
    jan4.setHours(0, 0, 0, 0);
    const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
    return { year: isoYear, week };
  }

  function isoWeekLabel(key) {
    const { week } = isoWeek(key);
    return `KW ${pad(week)}`;
  }

  /**
   * Montag der ISO-Kalenderwoche `week` im ISO-Jahr `year`.
   * Der 4. Januar liegt per Definition immer in KW 1.
   * Gibt null zurueck, wenn es die Woche in dem Jahr nicht gibt (KW 53).
   */
  function mondayOfIsoWeek(year, week) {
    const w = Number(week);
    if (!Number.isInteger(w) || w < 1 || w > 53) return null;
    const key = mondayOfIsoWeekRaw(Number(year), w);
    return isoWeek(key).week === w ? key : null;
  }

  function mondayOfIsoWeekRaw(year, week) {
    const jan4 = keyOf(new Date(year, 0, 4, 12, 0, 0, 0));
    return addDays(startOfWeek(jan4), (week - 1) * 7);
  }

  function shortWeekday(key) {
    return WEEKDAYS_SHORT[weekday(key)];
  }

  /** 'Montag, 17. August 2026' */
  function formatLong(key) {
    return parseKey(key).toLocaleDateString('de-DE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /** '17.08.' */
  function formatShort(key) {
    return parseKey(key).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }

  /** '17.08.2026' */
  function formatNumeric(key) {
    return parseKey(key).toLocaleDateString('de-DE');
  }

  /** 'August 2026' */
  function monthLabel(key) {
    return parseKey(key).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }

  /**
   * Kompakte Spanne fuer Ueberschriften:
   * '17.–21.08.2026' (gleicher Monat), '17.08. – 03.09.2026' (gleiches Jahr),
   * sonst beide Daten voll.
   */
  function rangeLabel(startKey, endKey) {
    if (!endKey || startKey === endKey) return formatNumeric(startKey);
    const a = parseKey(startKey);
    const b = parseKey(endKey);
    if (a.getFullYear() === b.getFullYear()) {
      if (a.getMonth() === b.getMonth()) return `${pad(a.getDate())}.–${formatNumeric(endKey)}`;
      return `${formatShort(startKey)} – ${formatNumeric(endKey)}`;
    }
    return `${formatNumeric(startKey)} – ${formatNumeric(endKey)}`;
  }

  /** 'Heute' / 'Gestern' / 'Morgen' / sonst der lange Name. */
  function relativeLabel(key, reference) {
    const ref = reference || todayKey();
    const d = diffDays(ref, key);
    if (d === 0) return 'Heute';
    if (d === -1) return 'Gestern';
    if (d === 1) return 'Morgen';
    if (d === -2) return 'Vorgestern';
    if (d === 2) return 'Übermorgen';
    return formatLong(key);
  }

  /** '14:32' aus einem ISO-Zeitstempel. */
  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  /** '17.08.2026 09:10' aus einem ISO-Zeitstempel - so versteht Excel es direkt. */
  function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${keyOfNumeric(d)} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function keyOfNumeric(date) {
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  }

  return {
    WEEKDAYS_SHORT,
    keyOf,
    todayKey,
    parseKey,
    isValidKey,
    addDays,
    diffDays,
    weekday,
    isWeekend,
    startOfWeek,
    daysFrom,
    daysBetween,
    lastDays,
    startOfMonth,
    endOfMonth,
    isoWeek,
    isoWeekLabel,
    mondayOfIsoWeek,
    shortWeekday,
    formatLong,
    formatShort,
    formatNumeric,
    monthLabel,
    rangeLabel,
    relativeLabel,
    formatTime,
    formatDateTime,
  };
});
