/**
 * Parser fuer die Schnellerfassung.
 *
 * Alles in EINE Zeile tippen, der Rest wird erkannt:
 *
 *   Drucker im 2. OG einrichten @teams #hardware !
 *   INC0012345 pruefen >morgen
 *   Angebot rausschicken @mail #vertrieb >fr !!
 *
 *   @quelle   Quelle (teams, mail, ticket, muendlich, telefon, meeting, selbst)
 *   #tag      beliebig viele Tags
 *   !  / !!   Prioritaet hoch / dringend
 *   >tag      Zieltag: heute, morgen, uebermorgen, mo..so, +3, 17.08., 17.08.2026
 *   INC1234   Ticketnummern werden automatisch als Referenz erkannt
 *
 * Laeuft in Main (require) und Renderer (global `Parse`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model'), require('./dates'));
  } else {
    root.Parse = factory(root.Model, root.Dates);
  }
})(typeof self !== 'undefined' ? self : this, function (Model, Dates) {
  /** Ticket-Praefixe, die als Referenz erkannt werden. */
  const REF_PATTERN = /\b((?:INC|RITM|REQ|CHG|PRB|SCTASK|TASK|TICKET|KB)[-_]?\d{3,})\b/i;

  const WEEKDAY_ALIASES = {
    so: 0, son: 0, sonntag: 0,
    mo: 1, mon: 1, montag: 1,
    di: 2, die: 2, dienstag: 2,
    mi: 3, mit: 3, mittwoch: 3,
    do: 4, don: 4, donnerstag: 4,
    fr: 5, fre: 5, freitag: 5,
    sa: 6, sam: 6, samstag: 6,
  };

  function resolveSource(token) {
    const t = token.toLowerCase();
    const hit = Model.SOURCES.find((s) => s.id === t || s.aliases.includes(t));
    if (hit) return hit.id;
    // Praefix-Treffer, damit auch '@out' oder '@serv' funktioniert
    const pre = Model.SOURCES.find(
      (s) => s.id.startsWith(t) || s.aliases.some((a) => a.startsWith(t))
    );
    return pre ? pre.id : null;
  }

  /**
   * '>...' aufloesen. Gibt einen Tagesschluessel zurueck oder null.
   * `base` ist der Tag, relativ zu dem gerechnet wird (default: heute).
   */
  function resolveDay(token, base) {
    const t = String(token).toLowerCase().replace(/\.$/, '');
    const from = base || Dates.todayKey();

    if (['heute', 'today', 'h'].includes(t)) return from;
    if (['morgen', 'tomorrow', 'm'].includes(t)) return Dates.addDays(from, 1);
    if (['uebermorgen', 'übermorgen', 'um'].includes(t)) return Dates.addDays(from, 2);
    if (['gestern', 'g'].includes(t)) return Dates.addDays(from, -1);

    // relative Verschiebung: +3 / -1
    const rel = t.match(/^([+-])(\d{1,3})$/);
    if (rel) return Dates.addDays(from, Number(rel[1] + rel[2]));

    // Wochentag: naechstes Vorkommen ab morgen
    if (Object.prototype.hasOwnProperty.call(WEEKDAY_ALIASES, t)) {
      const target = WEEKDAY_ALIASES[t];
      for (let i = 1; i <= 7; i++) {
        const cand = Dates.addDays(from, i);
        if (Dates.weekday(cand) === target) return cand;
      }
    }

    // Datum: 17.08 / 17.08. / 17.08.2026 / 2026-08-17
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return Dates.isValidKey(t) ? t : null;

    const de = t.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
    if (de) {
      const day = Number(de[1]);
      const month = Number(de[2]);
      let year = de[3] ? Number(de[3]) : Dates.parseKey(from).getFullYear();
      if (year < 100) year += 2000;
      const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return Dates.isValidKey(key) ? key : null;
    }

    return null;
  }

  /**
   * Zerlegt eine Eingabezeile.
   * @param {string} input
   * @param {string} [baseDay] Tag, auf den sich '>morgen' bezieht
   * @returns {{title, source, sourceExplicit, tags, priority, ref, day, dayExplicit, isEmpty}}
   */
  function parseCapture(input, baseDay) {
    const raw = String(input || '');
    const base = baseDay || Dates.todayKey();

    const result = {
      title: '',
      source: null,
      sourceExplicit: false,
      tags: [],
      priority: 0,
      ref: null,
      day: base,
      dayExplicit: false,
      isEmpty: true,
    };

    const rest = [];

    for (const token of raw.split(/\s+/)) {
      if (!token) continue;

      if (token.startsWith('@') && token.length > 1) {
        const src = resolveSource(token.slice(1));
        if (src) {
          result.source = src;
          result.sourceExplicit = true;
          continue;
        }
      }

      if (token.startsWith('#') && token.length > 1) {
        const tag = token.slice(1).toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '');
        if (tag && !result.tags.includes(tag)) result.tags.push(tag);
        continue;
      }

      if (/^!{1,3}$/.test(token)) {
        result.priority = Math.min(2, token.length);
        continue;
      }

      if (token.startsWith('>') && token.length > 1) {
        const day = resolveDay(token.slice(1), base);
        if (day) {
          result.day = day;
          result.dayExplicit = true;
          continue;
        }
      }

      rest.push(token);
    }

    result.title = rest.join(' ').trim();

    // Ticketnummer im verbleibenden Text erkennen (bleibt im Titel stehen)
    const refMatch = result.title.match(REF_PATTERN);
    if (refMatch) {
      result.ref = refMatch[1].toUpperCase();
      if (!result.sourceExplicit) result.source = 'ticket';
    }

    if (!result.source) result.source = Model.DEFAULT_SOURCE;
    result.isEmpty = result.title.length === 0;

    return result;
  }

  /** Baut aus einem Item wieder eine Eingabezeile (fuer 'Bearbeiten'). */
  function toCaptureLine(item) {
    const parts = [item.title];
    if (item.source && item.source !== Model.DEFAULT_SOURCE) parts.push('@' + item.source);
    for (const tag of item.tags || []) parts.push('#' + tag);
    if (item.priority === 1) parts.push('!');
    if (item.priority === 2) parts.push('!!');
    return parts.join(' ');
  }

  return { parseCapture, resolveDay, resolveSource, toCaptureLine, REF_PATTERN };
});
