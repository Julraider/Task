/**
 * Export-Formate.
 *
 * Aus denselben Aufgaben entstehen hier
 *   - Markdown  fuer den Tages-, Wochen- oder Zeitraumbericht,
 *   - HTML      zum Einfuegen in eine Outlook-Mail (Outlook kann kein Markdown),
 *   - Standup   als kurze Liste fuer die Morgenrunde,
 *   - CSV       fuer Excel (Semikolon, BOM, CRLF),
 *   - JSON      als Sicherung.
 *
 * Einstiegspunkt fuer die Oberflaeche ist `build(format, items, dayKeys, opts)`
 * zusammen mit `FORMATS`; die einzelnen Funktionen lassen sich aber auch
 * direkt aufrufen (z. B. `dayMarkdown` fuer 'Tag kopieren').
 *
 * Laeuft in Main (Datei schreiben) und Renderer (in die Zwischenablage).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model'), require('./dates'));
  } else {
    root.Exporter = factory(root.Model, root.Dates);
  }
})(typeof self !== 'undefined' ? self : this, function (Model, Dates) {
  /** Auswahlliste fuer den Export-Dialog. */
  const FORMATS = [
    { id: 'md', label: 'Markdown – Bericht mit Kennzahlen', ext: 'md' },
    { id: 'html', label: 'HTML – zum Einfügen in eine Outlook-Mail', ext: 'html' },
    { id: 'standup', label: 'Standup – kurze Liste zum Vorlesen', ext: 'txt' },
    { id: 'liste', label: 'Textliste – eine Zeile je Aufgabe', ext: 'txt' },
    { id: 'csv', label: 'CSV – für Excel', ext: 'csv' },
    { id: 'json', label: 'JSON – Sicherung / Wiederimport', ext: 'json' },
  ];

  /** Gruppierungen fuer den Markdown- und HTML-Bericht. */
  const GROUPINGS = [
    { id: 'tag', label: 'nach Tag' },
    { id: 'woche', label: 'nach Kalenderwoche' },
    { id: 'quelle', label: 'nach Quelle' },
    { id: 'schlagwort', label: 'nach Schlagwort' },
  ];

  function formatById(id) {
    return FORMATS.find((f) => f.id === id) || FORMATS[0];
  }

  // ------------------------------------------------------------- Auswahl

  /** Aufgaben auf die gewuenschten Tage eingrenzen. Ohne Tage: alles. */
  function selectItems(items, dayKeys) {
    const list = Array.isArray(items) ? items : [];
    if (!dayKeys || !dayKeys.length) return [...list];
    const wanted = new Set(dayKeys);
    return list.filter((i) => wanted.has(i.day));
  }

  /** Tagesliste bestimmen: entweder die uebergebene oder die der Aufgaben. */
  function resolveKeys(items, dayKeys) {
    if (dayKeys && dayKeys.length) return [...dayKeys];
    return [...new Set(items.map((i) => i.day).filter(Boolean))].sort();
  }

  function sortItems(items) {
    return [...items].sort(Model.compareItems);
  }

  // ------------------------------------------------------------ Kennzahlen

  /** Zaehlt zusammen, was in einem Bericht steht. */
  function summarize(items) {
    const sum = {
      total: items.length,
      done: 0,
      open: 0,
      active: 0,
      waiting: 0,
      sources: [],
      tags: [],
    };
    const bySource = new Map();
    const byTag = new Map();

    for (const item of items) {
      if (item.status === 'erledigt') sum.done++;
      else if (item.status === 'aktiv') sum.active++;
      else if (item.status === 'wartet') sum.waiting++;
      else sum.open++;

      const src = Model.sourceById(item.source);
      bySource.set(src.id, (bySource.get(src.id) || 0) + 1);
      for (const tag of item.tags || []) byTag.set(tag, (byTag.get(tag) || 0) + 1);
    }

    sum.sources = [...bySource.entries()]
      .map(([id, count]) => ({ id, label: Model.sourceById(id).label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    sum.tags = [...byTag.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    return sum;
  }

  function percent(part, total) {
    if (!total) return '0 %';
    return `${Math.round((part / total) * 100)} %`;
  }

  /** 'X erledigt (60 %) · Y offen · Z wartet' - nur was es auch gibt. */
  function statusSummary(sum) {
    const bits = [`${sum.done} erledigt (${percent(sum.done, sum.total)})`];
    if (sum.active) bits.push(`${sum.active} in Arbeit`);
    if (sum.open) bits.push(`${sum.open} offen`);
    if (sum.waiting) bits.push(`${sum.waiting} wartet`);
    return bits.join(' · ');
  }

  function topList(entries, label, count) {
    if (!entries.length) return '';
    return `${label}: ` + entries.slice(0, count).map((e) => `${e.label} ${e.count}`).join(' · ');
  }

  // -------------------------------------------------------- Gruppierungen

  /**
   * Aufgaben in Abschnitte teilen.
   * @returns {Array<{key: string, title: string, items: Array}>}
   */
  function groupItems(items, dayKeys, groupBy) {
    if (groupBy === 'quelle') {
      return Model.SOURCES.map((src) => ({
        key: src.id,
        title: src.label,
        items: sortItems(items.filter((i) => Model.sourceById(i.source).id === src.id)),
      })).filter((g) => g.items.length);
    }

    if (groupBy === 'schlagwort') {
      const sum = summarize(items);
      const groups = sum.tags.map((t) => ({
        key: t.tag,
        title: '#' + t.tag,
        items: sortItems(items.filter((i) => (i.tags || []).includes(t.tag))),
      }));
      const without = sortItems(items.filter((i) => !(i.tags || []).length));
      if (without.length) groups.push({ key: '', title: 'Ohne Schlagwort', items: without });
      return groups;
    }

    if (groupBy === 'woche') {
      const weeks = new Map();
      for (const key of resolveKeys(items, dayKeys)) {
        const { year, week } = Dates.isoWeek(key);
        const id = `${year}-${String(week).padStart(2, '0')}`;
        if (!weeks.has(id)) weeks.set(id, []);
        weeks.get(id).push(key);
      }
      return [...weeks.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, keys]) => ({
          key: id,
          title: `${Dates.isoWeekLabel(keys[0])} · ${Dates.rangeLabel(keys[0], keys[keys.length - 1])}`,
          items: sortItems(items.filter((i) => keys.includes(i.day))),
        }))
        .filter((g) => g.items.length);
    }

    // Standard: nach Tag, in der Reihenfolge der uebergebenen Tage
    return resolveKeys(items, dayKeys)
      .map((key) => ({
        key,
        title: Dates.formatLong(key),
        items: sortItems(items.filter((i) => i.day === key)),
      }))
      .filter((g) => g.items.length);
  }

  // ------------------------------------------------------------- Markdown

  /** Ueberschrift, wenn der Aufrufer keine vorgibt: Tag, Kalenderwoche oder Spanne. */
  function autoTitle(dayKeys) {
    const keys = [...dayKeys].sort();
    if (!keys.length) return 'Bericht';
    const start = keys[0];
    const end = keys[keys.length - 1];
    if (start === end) return Dates.formatLong(start);
    const a = Dates.isoWeek(start);
    const b = Dates.isoWeek(end);
    if (a.year === b.year && a.week === b.week) {
      return `${Dates.isoWeekLabel(start)} · ${Dates.rangeLabel(start, end)}`;
    }
    return Dates.rangeLabel(start, end);
  }

  function metaBits(item, withDay) {
    const bits = [];
    if (withDay) bits.push(`${Dates.shortWeekday(item.day)} ${Dates.formatShort(item.day)}`);
    const src = Model.sourceById(item.source);
    if (src) bits.push(src.label);
    if (item.ref) bits.push(item.ref);
    for (const tag of item.tags || []) bits.push('#' + tag);
    if (item.priority === 1) bits.push('Prio hoch');
    if (item.priority === 2) bits.push('Prio dringend');
    if (item.status === 'wartet') bits.push('wartet');
    if (item.status === 'aktiv') bits.push('in Arbeit');
    return bits;
  }

  /**
   * Notizen unter der Aufgabe: zwei Leerzeichen eingerueckt, harte Zeilen-
   * umbrueche. So bleibt es in Markdown Teil des Listenpunktes und wird nicht
   * versehentlich als Code-Block dargestellt.
   */
  function noteBlock(notes) {
    const text = String(notes || '').trim();
    if (!text) return '';
    return (
      '\n' +
      text
        .split(/\r?\n/)
        .map((l) => '  ' + l.trim())
        .join('  \n')
    );
  }

  function line(item, options) {
    const opts = options || {};
    const box = item.status === 'erledigt' ? '[x]' : '[ ]';
    const info = metaBits(item, opts.day).join(' · ');
    let out = `- ${box} ${item.title}`;
    if (info) out += `  _(${info})_`;
    if (opts.notes !== false) out += noteBlock(item.notes);
    return out;
  }

  function section(title, items, options) {
    if (!items.length) return '';
    return `**${title} (${items.length})**\n\n` + items.map((i) => line(i, options)).join('\n') + '\n\n';
  }

  function splitByStatus(items) {
    const sorted = sortItems(items);
    return {
      done: sorted.filter((i) => i.status === 'erledigt'),
      open: sorted.filter((i) => i.status === 'offen' || i.status === 'aktiv'),
      waiting: sorted.filter((i) => i.status === 'wartet'),
    };
  }

  function body(items, options) {
    if (!items.length) return '_Keine Einträge._\n\n';
    const { done, open, waiting } = splitByStatus(items);
    return (
      section('Erledigt', done, options) +
      section('Offen', open, options) +
      section('Wartet', waiting, options)
    );
  }

  /**
   * Bericht ueber einen beliebigen Zeitraum.
   * @param {Array} items
   * @param {string[]} dayKeys
   * @param {{title?, subtitle?, groupBy?, metrics?, notes?, carry?}} [options]
   */
  function rangeMarkdown(items, dayKeys, options) {
    const opts = options || {};
    const keys = dayKeys && dayKeys.length ? dayKeys : [];
    const inRange = selectItems(items, keys);
    const groupBy = opts.groupBy || 'tag';
    const sum = summarize(inRange);
    const showDay = groupBy !== 'tag';

    const title = opts.title || autoTitle(resolveKeys(inRange, keys));

    let out = `# ${title}\n\n`;
    if (opts.subtitle) out += `_${opts.subtitle}_\n\n`;

    if (!inRange.length) return out + '_Keine Einträge._\n';

    if (opts.metrics !== false) {
      out += `**${inRange.length} ${inRange.length === 1 ? 'Aufgabe' : 'Aufgaben'}** · ${statusSummary(sum)}\n`;
      const sources = topList(sum.sources, 'Quellen', 4);
      if (sources) out += sources + '\n';
      const tags = topList(sum.tags.map((t) => ({ label: '#' + t.tag, count: t.count })), 'Schlagworte', 5);
      if (tags) out += tags + '\n';
      out += '\n';
    }

    for (const group of groupItems(inRange, keys, groupBy)) {
      out += `## ${group.title}\n\n`;
      out += body(group.items, { day: showDay, notes: opts.notes });
    }

    if (opts.carry !== false) {
      const carry = sortItems(inRange.filter((i) => i.status !== 'erledigt'));
      if (carry.length) {
        out += `## Nimmt man mit (${carry.length})\n\n`;
        out += carry.map((i) => line(i, { day: true, notes: false })).join('\n') + '\n';
      }
    }

    return out.trimEnd() + '\n';
  }

  /** Markdown fuer einen einzelnen Tag. */
  function dayMarkdown(items, dayKey, options) {
    const opts = options || {};
    const ofDay = items.filter((i) => i.day === dayKey);
    const sum = summarize(ofDay);

    let out = `# ${Dates.formatLong(dayKey)}\n\n`;
    if (ofDay.length && opts.metrics !== false) {
      out += `_${ofDay.length} ${ofDay.length === 1 ? 'Aufgabe' : 'Aufgaben'} · ${statusSummary(sum)}_\n\n`;
    }
    out += body(ofDay, { notes: opts.notes });
    return out.trimEnd() + '\n';
  }

  /** Markdown fuer eine Woche (Tagesschluessel-Liste), gruppiert nach Tagen. */
  function weekMarkdown(items, dayKeys, options) {
    const opts = options || {};
    const keys = [...(dayKeys || [])];
    if (!keys.length) return rangeMarkdown(items, keys, opts);
    const start = keys[0];
    const end = keys[keys.length - 1];
    return rangeMarkdown(items, keys, {
      title: `${Dates.isoWeekLabel(start)} · ${Dates.rangeLabel(start, end)}`,
      ...opts,
    });
  }

  /** Markdown fuer einen ganzen Monat, gruppiert nach Kalenderwochen. */
  function monthMarkdown(items, dayKey, options) {
    const opts = options || {};
    const keys = Dates.daysBetween(Dates.startOfMonth(dayKey), Dates.endOfMonth(dayKey));
    return rangeMarkdown(items, keys, {
      title: Dates.monthLabel(dayKey),
      groupBy: 'woche',
      ...opts,
    });
  }

  // -------------------------------------------------------------- Standup

  /**
   * Kurze Liste fuer die Morgenrunde: was fertig ist, was ansteht, was klemmt.
   * @param {{today?: string}} [options] Bezugstag; ohne Angabe heute, falls es
   *        im Zeitraum liegt, sonst dessen letzter Tag.
   */
  function standup(items, dayKeys, options) {
    const opts = options || {};
    const inRange = selectItems(items, dayKeys);
    const keys = resolveKeys(inRange, dayKeys).sort();
    const heute = Dates.todayKey();
    // Bezugstag: heute, wenn es im Zeitraum liegt - sonst dessen letzter Tag
    const today = opts.today || (keys.includes(heute) ? heute : keys[keys.length - 1] || heute);

    const mark = (item) => {
      const ref = item.ref ? ` (${item.ref})` : '';
      const day = item.day && item.day !== today ? `${Dates.shortWeekday(item.day)} ` : '';
      return `  ${day}${item.title}${ref}`;
    };

    const done = sortItems(inRange.filter((i) => i.status === 'erledigt'));
    const todo = sortItems(inRange.filter((i) => i.status !== 'erledigt' && i.status !== 'wartet'));
    const blocked = sortItems(inRange.filter((i) => i.status === 'wartet'));

    const out = [`Standup ${Dates.formatNumeric(today)}`, ''];
    const add = (title, list) => {
      if (!list.length) return;
      out.push(title, ...list.map(mark), '');
    };
    add('Erledigt:', done);
    add('Dran:', todo);
    add('Blockiert:', blocked);

    if (out.length === 2) out.push('Nichts erfasst.', '');
    return out.join('\n').trimEnd() + '\n';
  }

  /** Kurze Klartext-Liste, eine Zeile je Aufgabe. */
  function plain(items, dayKeys) {
    return selectItems(items, dayKeys)
      .sort(Model.compareByDay)
      .map((i) => `${i.status === 'erledigt' ? '✓' : '·'} ${i.title}${i.ref ? ` (${i.ref})` : ''}`)
      .join('\n');
  }

  // ----------------------------------------------------------------- HTML

  function esc(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const CSS = {
    page: "margin:0;padding:0;font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:11pt;color:#22272b;line-height:1.45",
    h1: 'margin:0 0 4px;font-size:15pt;font-weight:600',
    sub: 'margin:0 0 12px;font-size:10pt;color:#5b6470',
    group: 'margin:18px 0 6px;font-size:12pt;font-weight:600;border-bottom:1px solid #dfe3e8;padding-bottom:3px',
    part: 'margin:10px 0 4px;font-size:10pt;font-weight:600;color:#5b6470',
    list: 'margin:0;padding:0 0 0 20px',
    item: 'margin:0 0 5px',
    meta: 'color:#5b6470;font-size:9.5pt',
    note: 'margin:2px 0 0;color:#5b6470;font-size:9.5pt',
    done: 'color:#2f7a4d;font-weight:600',
    open: 'color:#8a929c;font-weight:600',
  };

  function htmlItem(item, withDay) {
    const isDone = item.status === 'erledigt';
    const box = `<span style="${isDone ? CSS.done : CSS.open}">${isDone ? '&#10003;' : '&#9633;'}</span>`;
    const info = metaBits(item, withDay).join(' · ');
    let out = `<li style="${CSS.item}">${box} ${esc(item.title)}`;
    if (info) out += ` <span style="${CSS.meta}">(${esc(info)})</span>`;
    const notes = String(item.notes || '').trim();
    if (notes) {
      out += `<div style="${CSS.note}">${esc(notes).replace(/\r?\n/g, '<br>')}</div>`;
    }
    return out + '</li>';
  }

  function htmlPart(title, items, withDay) {
    if (!items.length) return '';
    return (
      `<div style="${CSS.part}">${esc(title)} (${items.length})</div>` +
      `<ul style="${CSS.list}">` +
      items.map((i) => htmlItem(i, withDay)).join('') +
      '</ul>'
    );
  }

  /**
   * HTML-Bericht - gedacht zum Kopieren in eine Outlook-Mail.
   * Alle Formatierungen stehen bewusst inline: Outlook wirft <style>-Bloecke weg.
   * @param {{title?, subtitle?, groupBy?, fragment?}} [options]
   *        fragment: true liefert nur den Inhalt ohne <html>-Geruest.
   */
  function html(items, dayKeys, options) {
    const opts = options || {};
    const inRange = selectItems(items, dayKeys);
    const groupBy = opts.groupBy || 'tag';
    const showDay = groupBy !== 'tag';
    const title = opts.title || autoTitle(resolveKeys(inRange, dayKeys));

    let out = `<div style="${CSS.page}">`;
    out += `<h1 style="${CSS.h1}">${esc(title)}</h1>`;
    if (opts.subtitle) out += `<p style="${CSS.sub}">${esc(opts.subtitle)}</p>`;

    if (!inRange.length) {
      out += `<p style="${CSS.sub}">Keine Einträge.</p></div>`;
      return opts.fragment ? out : htmlDocument(title, out);
    }

    const sum = summarize(inRange);
    const numbers = [`${inRange.length} ${inRange.length === 1 ? 'Aufgabe' : 'Aufgaben'}`, statusSummary(sum)];
    const sources = topList(sum.sources, 'Quellen', 4);
    if (sources) numbers.push(sources);
    out += `<p style="${CSS.sub}">${esc(numbers.join(' · '))}</p>`;

    for (const group of groupItems(inRange, dayKeys, groupBy)) {
      out += `<div style="${CSS.group}">${esc(group.title)}</div>`;
      const { done, open, waiting } = splitByStatus(group.items);
      out += htmlPart('Erledigt', done, showDay);
      out += htmlPart('Offen', open, showDay);
      out += htmlPart('Wartet', waiting, showDay);
    }

    out += '</div>';
    return opts.fragment ? out : htmlDocument(title, out);
  }

  function htmlDocument(title, inner) {
    return (
      '<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n' +
      `<title>${esc(title)}</title>\n</head>\n<body style="margin:0;padding:20px;background:#ffffff">\n` +
      inner +
      '\n</body>\n</html>\n'
    );
  }

  // ------------------------------------------------------------------ CSV

  /**
   * Ein Feld fuer Excel absichern. Fuehrende '=' oder '@' und ein '-Wort'
   * wuerde Excel als Formel lesen - ein Apostroph davor macht daraus Text.
   */
  function csvSafe(value) {
    const s = String(value ?? '');
    if (/^[=@]/.test(s) || /^[+\-][^\d\s]/.test(s)) return "'" + s;
    return s;
  }

  function csvEscape(value, delimiter) {
    const s = csvSafe(value).replace(/\r\n?/g, '\n');
    return s.includes('"') || s.includes('\n') || s.includes(delimiter)
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  }

  /**
   * CSV fuer Excel: Semikolon als Trenner, BOM voran, CRLF am Zeilenende.
   * Mehrzeilige Notizen bleiben mehrzeilig - in Anfuehrungszeichen ist das
   * gueltiges CSV und Excel legt sie sauber in eine Zelle.
   * @param {{delimiter?: string, bom?: boolean}} [options]
   */
  function csv(items, options) {
    const opts = options || {};
    const delimiter = opts.delimiter || ';';
    const head = [
      'Tag', 'Wochentag', 'KW', 'Titel', 'Quelle', 'Status', 'Prioritaet',
      'Referenz', 'Tags', 'Notizen', 'Erstellt', 'Erledigt',
    ];
    const rows = [...items].sort(Model.compareByDay);
    const lines = [head.join(delimiter)];

    for (const i of rows) {
      lines.push(
        [
          Dates.formatNumeric(i.day),
          Dates.shortWeekday(i.day),
          Dates.isoWeek(i.day).week,
          i.title,
          Model.sourceById(i.source).label,
          Model.statusById(i.status).label,
          Model.priorityById(i.priority).label,
          i.ref || '',
          (i.tags || []).join(' '),
          i.notes || '',
          Dates.formatDateTime(i.createdAt),
          Dates.formatDateTime(i.doneAt),
        ]
          .map((cell) => csvEscape(cell, delimiter))
          .join(delimiter)
      );
    }

    return (opts.bom === false ? '' : '﻿') + lines.join('\r\n') + '\r\n';
  }

  // ----------------------------------------------------------- Einstieg

  /** Waehlt selbst zwischen Tages-, Wochen- und Zeitraumbericht. */
  function markdown(items, dayKeys, options) {
    const keys = [...(dayKeys || [])].sort();
    if (!keys.length) return dayMarkdown(items, Dates.todayKey(), options);
    if (keys.length === 1) return dayMarkdown(items, keys[0], options);
    if (Dates.diffDays(keys[0], keys[keys.length - 1]) <= 7) return weekMarkdown(items, keys, options);
    return rangeMarkdown(items, keys, { groupBy: 'woche', ...(options || {}) });
  }

  /**
   * Ein Aufruf fuer alle Formate.
   * @param {string} format  Id aus FORMATS
   * @param {Array} items    alle Aufgaben
   * @param {string[]|null} dayKeys  Tage; leer/null = alles
   * @param {object} [options] wird an das jeweilige Format durchgereicht
   *        (groupBy, title, subtitle, version fuer JSON)
   */
  function build(format, items, dayKeys, options) {
    const opts = options || {};
    const list = selectItems(items, dayKeys);
    const keys = resolveKeys(list, dayKeys);

    switch (format) {
      case 'csv':
        return csv(list, opts);
      case 'json':
        return JSON.stringify(
          { version: opts.version || 1, items: [...list].sort(Model.compareByDay) },
          null,
          2
        );
      case 'html':
        return html(list, keys, opts);
      case 'standup':
        return standup(list, keys, opts);
      case 'liste':
        return plain(list, keys);
      default:
        return markdown(list, keys, opts);
    }
  }

  return {
    FORMATS,
    GROUPINGS,
    formatById,
    build,
    markdown,
    dayMarkdown,
    weekMarkdown,
    rangeMarkdown,
    monthMarkdown,
    standup,
    html,
    csv,
    plain,
    summarize,
  };
});
