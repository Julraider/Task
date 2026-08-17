/**
 * Parser fuer die Schnellerfassung.
 *
 * Alles in EINE Zeile tippen, der Rest wird erkannt:
 *
 *   Drucker im 2. OG einrichten @teams #hardware !
 *   INC0012345 pruefen >morgen
 *   Angebot rausschicken @mail #vertrieb >fr !!
 *   Inventur vorbereiten >ende der woche
 *
 *   @quelle   Quelle (teams, mail, ticket, jira, muendlich, telefon, meeting, ...)
 *             Praefixe und kleine Tippfehler werden verziehen: @outlok -> mail
 *   #tag      beliebig viele Tags (mindestens ein Buchstabe, sonst bleibt es
 *             Titel: '#4711' ist eine Nummer, kein Schlagwort)
 *   !  / !!   Prioritaet hoch / dringend
 *   >tag      Zieltag, auch mehrwortig:
 *             heute, morgen, uebermorgen, gestern, mo..so, +3, -1, +2w,
 *             naechste woche, uebernaechste woche, naechsten montag,
 *             ende der woche, monatsende, naechsten monat, in 3 tagen,
 *             kw35, 17.08., 17.08.2026, 2026-08-17
 *   INC1234   Ticketnummern werden automatisch als Referenz erkannt,
 *             ebenso Nummern aus ServiceNow- und Jira-Links
 *
 * Grundsatz: Was nicht *sicher* erkannt wird, bleibt Teil des Titels.
 * 'Umsatz >1000 pruefen' wird also nie verschoben, '@kollege' bleibt stehen,
 * und ein mehrdeutiges '@m' (mail? meeting? muendlich?) wird nicht geraten.
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
  /** Ticket-Praefixe, die als Referenz erkannt werden ('INC0012345', 'REQ 4711'). */
  const REF_PATTERN = /\b((?:INC|RITM|REQ|SR|CHG|CTASK|PRB|PTASK|SCTASK|TASK|TICKET|KB)[-_ ]?\d{3,})\b/i;

  /** ServiceNow-Link: ...sysparm_query=number=INC0012345 (auch URL-kodiert). */
  const SNOW_URL_PATTERN = /number(?:=|%3d)([a-z]{2,8}\d{3,})/i;

  /** Jira-Link: https://jira.firma.de/browse/NET-1234 */
  const JIRA_URL_PATTERN = /\/browse\/([a-z][a-z0-9]{1,9}-\d{1,6})\b/i;

  /**
   * Projekt-Kuerzel wie 'NET-1234'. Absichtlich nur bei ausdruecklicher
   * Ticket-/Jira-Quelle, sonst wuerden 'DIN-476' oder 'RS-232' zur Referenz.
   */
  const PROJECT_KEY_PATTERN = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/;

  /** Quellen, bei denen ein blankes Projekt-Kuerzel als Referenz durchgeht. */
  const REF_SOURCES = ['ticket', 'jira'];

  /** So viele Woerter darf eine '>'-Angabe lang sein ('ende der woche'). */
  const MAX_DAY_WORDS = 3;

  const WEEKDAY_ALIASES = {
    so: 0, son: 0, sonntag: 0,
    mo: 1, mon: 1, montag: 1,
    di: 2, die: 2, dienstag: 2,
    mi: 3, mit: 3, mittwoch: 3,
    do: 4, don: 4, donnerstag: 4,
    fr: 5, fre: 5, freitag: 5,
    sa: 6, sam: 6, samstag: 6, sonnabend: 6,
  };

  /** Umlaute und Grossschreibung vereinheitlichen: 'Nächste' -> 'naechste'. */
  function fold(text) {
    return String(text)
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss');
  }

  // --------------------------------------------------------------- Quelle

  /** Alle Suchwoerter (ID + Aliase) einmal vorgefaltet. */
  const SOURCE_WORDS = (function () {
    const out = [];
    for (const source of Model.SOURCES) {
      const words = new Set([fold(source.id), ...source.aliases.map(fold)]);
      for (const word of words) out.push({ id: source.id, word });
    }
    return out;
  })();

  /** Genau eine Quelle getroffen? Sonst null - Raten waere schlimmer als Titel. */
  function theOnlyHit(hits) {
    if (!hits.length) return null;
    const ids = new Set(hits.map((h) => h.id));
    return ids.size === 1 ? hits[0].id : null;
  }

  /**
   * Levenshtein-Distanz mit Obergrenze. -1 heisst "weiter als `max` entfernt".
   * Die Woerter sind kurz, die einfache Matrix reicht voellig.
   */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return -1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return -1;
      prev = cur;
    }
    return prev[b.length] <= max ? prev[b.length] : -1;
  }

  /**
   * '@wort' aufloesen: erst exakt, dann eindeutiger Praefix, dann Tippfehler.
   * Mehrdeutiges ergibt null und bleibt damit im Titel stehen.
   */
  function resolveSource(token) {
    const t = fold(token).replace(/[^\p{L}\p{N}_-]/gu, '');
    if (!t) return null;

    const exact = SOURCE_WORDS.filter((w) => w.word === t);
    if (exact.length) return exact[0].id;

    const prefix = SOURCE_WORDS.filter((w) => w.word.startsWith(t));
    if (prefix.length) return theOnlyHit(prefix);

    // Tippfehler: je laenger das Wort, desto mehr Nachsicht
    const max = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0;
    if (!max) return null;

    let best = [];
    let bestDist = max + 1;
    for (const w of SOURCE_WORDS) {
      const d = editDistance(w.word, t, max);
      if (d < 0) continue;
      if (d < bestDist) {
        bestDist = d;
        best = [w];
      } else if (d === bestDist) {
        best.push(w);
      }
    }
    return theOnlyHit(best);
  }

  // --------------------------------------------------------------- Zieltag

  /** Montag der Woche, die `weeks` Wochen nach `from` liegt. */
  function mondayIn(from, weeks) {
    return Dates.addDays(Dates.startOfWeek(from), 7 * weeks);
  }

  /** Wochentag innerhalb der Woche von `from` (Montag = Wochenstart). */
  function weekdayOfWeek(from, target, weeks) {
    return Dates.addDays(mondayIn(from, weeks || 0), target === 0 ? 6 : target - 1);
  }

  /** Naechstes Vorkommen eines Wochentags, fruehestens morgen. */
  function nextWeekday(from, target) {
    for (let i = 1; i <= 7; i++) {
      const cand = Dates.addDays(from, i);
      if (Dates.weekday(cand) === target) return cand;
    }
    return null;
  }

  /** Zahlen- und Datumsformate: +3, -1, +2w, 17.08., 17.08.2026, 2026-08-17. */
  function resolveDateToken(token, from) {
    const t = fold(token).replace(/\.$/, '');

    // relative Verschiebung: +3 (Tage), -1, +2w (Wochen)
    const rel = t.match(/^([+-])(\d{1,3})(w|t)?$/);
    if (rel) {
      const n = Number(rel[1] + rel[2]);
      return Dates.addDays(from, rel[3] === 'w' ? n * 7 : n);
    }

    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
      const [y, m, d] = t.split('-').map(Number);
      return validKey(y, m, d);
    }

    const de = t.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
    if (de) {
      const day = Number(de[1]);
      const month = Number(de[2]);
      let year = de[3] ? Number(de[3]) : Dates.parseKey(from).getFullYear();
      if (year < 100) year += 2000;
      return validKey(year, month, day);
    }

    return null;
  }

  function validKey(year, month, day) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return Dates.isValidKey(key) ? key : null;
  }

  /**
   * '>...' aufloesen. Gibt einen Tagesschluessel zurueck oder null.
   * `base` ist der Tag, relativ zu dem gerechnet wird (default: heute).
   * Das Wort darf mehrteilig sein: 'ende der woche', 'in 3 tagen', 'kw 35'.
   */
  function resolveDay(token, base) {
    const from = base || Dates.todayKey();
    const raw = String(token).trim();
    if (!raw) return null;

    // Zuerst die Formate, in denen Punkt und Bindestrich zur Syntax gehoeren
    const byDate = resolveDateToken(raw, from);
    if (byDate) return byDate;

    // Danach die Wortangaben: Trenner vereinheitlichen, Umlaute falten
    const t = fold(raw).replace(/[-_./]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;

    if (['heute', 'today', 'h'].includes(t)) return from;
    if (['morgen', 'tomorrow', 'm'].includes(t)) return Dates.addDays(from, 1);
    if (['uebermorgen', 'um'].includes(t)) return Dates.addDays(from, 2);
    if (['gestern', 'g'].includes(t)) return Dates.addDays(from, -1);
    if (t === 'vorgestern') return Dates.addDays(from, -2);

    // 'in 3 tagen', 'in 2 wochen', 'in einer woche'
    const inN = t.match(/^in (\d{1,3}|einer|einem|eine|ein) (tag|tagen|woche|wochen)$/);
    if (inN) {
      const n = /^\d+$/.test(inN[1]) ? Number(inN[1]) : 1;
      return Dates.addDays(from, inN[2].startsWith('woche') ? n * 7 : n);
    }

    // ganze Wochen
    if (/^(naechste|naechsten|naechster|kommende|kommenden|kommender) woche$/.test(t)) return mondayIn(from, 1);
    if (/^uebernaechste[nr]? woche$/.test(t)) return mondayIn(from, 2);
    if (['ende der woche', 'ende woche', 'wochenende', 'eow'].includes(t)) {
      const friday = weekdayOfWeek(from, 5);
      return Dates.diffDays(from, friday) >= 0 ? friday : weekdayOfWeek(from, 5, 1);
    }
    if (['anfang der woche', 'wochenanfang'].includes(t)) {
      const monday = mondayIn(from, 0);
      return Dates.diffDays(from, monday) >= 0 ? monday : mondayIn(from, 1);
    }

    // Monatsgrenzen
    if (/^(naechste[nr]?|kommende[nr]?) monat$/.test(t)) return Dates.addDays(Dates.endOfMonth(from), 1);
    if (['ende des monats', 'monatsende', 'eom'].includes(t)) return Dates.endOfMonth(from);
    if (['monatsanfang', 'anfang des monats'].includes(t)) {
      const first = Dates.startOfMonth(from);
      return Dates.diffDays(from, first) >= 0 ? first : Dates.addDays(Dates.endOfMonth(from), 1);
    }

    // Kalenderwoche: 'kw35', 'kw 35', 'kw35/2027'
    const kw = t.match(/^kw ?(\d{1,2})(?: (\d{4}))?$/);
    if (kw) {
      const week = Number(kw[1]);
      if (kw[2]) return Dates.mondayOfIsoWeek(Number(kw[2]), week);
      const thisYear = Dates.isoWeek(from).year;
      const inThisYear = Dates.mondayOfIsoWeek(thisYear, week);
      if (inThisYear && Dates.diffDays(from, inThisYear) >= 0) return inThisYear;
      return Dates.mondayOfIsoWeek(thisYear + 1, week) || inThisYear;
    }

    // Wochentag, ggf. mit 'naechsten' / 'diesen' davor
    const withPrefix = t.match(/^(naechste[rn]?|kommende[rn]?|diese[rn]?|am) (\p{L}+)$/u);
    if (withPrefix && Object.prototype.hasOwnProperty.call(WEEKDAY_ALIASES, withPrefix[2])) {
      const target = WEEKDAY_ALIASES[withPrefix[2]];
      if (withPrefix[1].startsWith('diese')) return weekdayOfWeek(from, target);
      if (withPrefix[1] === 'am') return nextWeekday(from, target);
      return weekdayOfWeek(from, target, 1);
    }

    if (Object.prototype.hasOwnProperty.call(WEEKDAY_ALIASES, t)) {
      return nextWeekday(from, WEEKDAY_ALIASES[t]);
    }

    return null;
  }

  // -------------------------------------------------------------- Referenz

  function normalizeRef(value) {
    return String(value).replace(/\s+/g, '').toUpperCase();
  }

  /**
   * Ticketnummer im Text suchen.
   * Reihenfolge: ServiceNow-Link, Jira-Link, Klartext-Nummer, zuletzt ein
   * blankes Projekt-Kuerzel - das aber nur, wenn die Quelle es hergibt.
   * @returns {{ref: string, source: string}|null}
   */
  function findRef(text, explicitSource) {
    const snow = text.match(SNOW_URL_PATTERN);
    if (snow) return { ref: normalizeRef(snow[1]), source: 'ticket' };

    const jira = text.match(JIRA_URL_PATTERN);
    if (jira) return { ref: normalizeRef(jira[1]), source: 'jira' };

    const plain = text.match(REF_PATTERN);
    if (plain) return { ref: normalizeRef(plain[1]), source: 'ticket' };

    if (REF_SOURCES.includes(explicitSource)) {
      const key = text.match(PROJECT_KEY_PATTERN);
      if (key) return { ref: normalizeRef(key[1]), source: explicitSource };
    }

    return null;
  }

  // ---------------------------------------------------------------- Parser

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

    const tokens = raw.split(/\s+/).filter(Boolean);
    const rest = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

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
        // Ein Schlagwort braucht mindestens einen Buchstaben. Sonst wuerde
        // 'Rechnung #4711 pruefen' die Nummer als Tag schlucken und '#!!'
        // spurlos verschwinden - beides waere ein Fehlalarm.
        if (/\p{L}/u.test(tag)) {
          if (!result.tags.includes(tag)) result.tags.push(tag);
          continue;
        }
      }

      if (/^!{1,3}$/.test(token)) {
        result.priority = Math.min(2, token.length);
        continue;
      }

      if (token.startsWith('>') && token.length > 1) {
        // Laengste Wortgruppe zuerst: '>ende der woche' schlaegt '>ende'
        const reach = Math.min(MAX_DAY_WORDS - 1, tokens.length - 1 - i);
        let taken = -1;
        let day = null;
        for (let extra = reach; extra >= 0 && !day; extra--) {
          const phrase = [token.slice(1), ...tokens.slice(i + 1, i + 1 + extra)].join(' ');
          day = resolveDay(phrase, base);
          if (day) taken = extra;
        }
        if (day) {
          result.day = day;
          result.dayExplicit = true;
          i += taken;
          continue;
        }
      }

      rest.push(token);
    }

    result.title = rest.join(' ').trim();

    // Ticketnummer im verbleibenden Text erkennen (bleibt im Titel stehen)
    const found = findRef(result.title, result.sourceExplicit ? result.source : null);
    if (found) {
      result.ref = found.ref;
      if (!result.sourceExplicit) result.source = found.source;
    }

    if (!result.source) result.source = Model.DEFAULT_SOURCE;
    result.isEmpty = result.title.length === 0;

    return result;
  }

  /**
   * Baut aus einem Item wieder eine Eingabezeile (fuer 'Bearbeiten').
   * Mit `baseDay` kommt ein '>2026-08-20' dazu, wenn die Aufgabe auf einem
   * anderen Tag liegt - so bleibt die Zeile vollstaendig umkehrbar.
   */
  function toCaptureLine(item, baseDay) {
    const parts = [item.title];
    if (item.source && item.source !== Model.DEFAULT_SOURCE) parts.push('@' + item.source);
    for (const tag of item.tags || []) parts.push('#' + tag);
    if (item.priority === 1) parts.push('!');
    if (item.priority === 2) parts.push('!!');
    if (baseDay && item.day && item.day !== baseDay) parts.push('>' + item.day);
    return parts.join(' ');
  }

  return { parseCapture, resolveDay, resolveSource, toCaptureLine, findRef, fold, REF_PATTERN };
});
