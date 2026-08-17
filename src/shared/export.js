/**
 * Export-Formate: Markdown (fuer Wochenbericht / Standup / Mail) und CSV.
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
  function meta(item) {
    const bits = [];
    const src = Model.sourceById(item.source);
    if (src) bits.push(src.label);
    if (item.ref) bits.push(item.ref);
    for (const tag of item.tags || []) bits.push('#' + tag);
    if (item.priority === 1) bits.push('Prio hoch');
    if (item.priority === 2) bits.push('Prio dringend');
    if (item.status === 'wartet') bits.push('wartet');
    return bits.join(' · ');
  }

  function line(item) {
    const box = item.status === 'erledigt' ? '[x]' : '[ ]';
    const info = meta(item);
    let out = `- ${box} ${item.title}`;
    if (info) out += `  _(${info})_`;
    if (item.notes && item.notes.trim()) {
      const notes = item.notes
        .trim()
        .split('\n')
        .map((l) => '      ' + l)
        .join('\n');
      out += '\n' + notes;
    }
    return out;
  }

  function section(title, items) {
    if (!items.length) return '';
    return `**${title} (${items.length})**\n\n` + items.map(line).join('\n') + '\n\n';
  }

  function splitByStatus(items) {
    const sorted = [...items].sort(Model.compareItems);
    return {
      done: sorted.filter((i) => i.status === 'erledigt'),
      open: sorted.filter((i) => i.status === 'offen' || i.status === 'aktiv'),
      waiting: sorted.filter((i) => i.status === 'wartet'),
    };
  }

  function dayBody(items) {
    if (!items.length) return '_Keine Einträge._\n\n';
    const { done, open, waiting } = splitByStatus(items);
    return section('Erledigt', done) + section('Offen', open) + section('Wartet', waiting);
  }

  /** Markdown fuer einen einzelnen Tag. */
  function dayMarkdown(items, dayKey) {
    const ofDay = items.filter((i) => i.day === dayKey);
    let out = `# ${Dates.formatLong(dayKey)}\n\n`;
    out += dayBody(ofDay);
    return out.trimEnd() + '\n';
  }

  /** Markdown fuer eine ganze Woche (Tagesschluessel-Liste). */
  function weekMarkdown(items, dayKeys) {
    const start = dayKeys[0];
    const end = dayKeys[dayKeys.length - 1];
    const inRange = items.filter((i) => dayKeys.includes(i.day));
    const doneCount = inRange.filter((i) => i.status === 'erledigt').length;

    let out = `# ${Dates.isoWeekLabel(start)} · ${Dates.formatNumeric(start)} – ${Dates.formatNumeric(end)}\n\n`;
    out += `_${inRange.length} Aufgaben erfasst, ${doneCount} erledigt._\n\n`;

    for (const key of dayKeys) {
      const ofDay = inRange.filter((i) => i.day === key);
      if (!ofDay.length) continue;
      out += `## ${Dates.formatLong(key)}\n\n`;
      out += dayBody(ofDay);
    }

    const offen = inRange.filter((i) => i.status !== 'erledigt');
    if (offen.length) {
      out += `## Nimmt man mit\n\n` + offen.map(line).join('\n') + '\n';
    }

    return out.trimEnd() + '\n';
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** CSV mit Semikolon als Trenner - so oeffnet Excel (DE) es direkt korrekt. */
  function csv(items) {
    const head = ['Tag', 'Titel', 'Quelle', 'Status', 'Prioritaet', 'Referenz', 'Tags', 'Notizen', 'Erstellt', 'Erledigt'];
    const rows = [...items].sort((a, b) => a.day.localeCompare(b.day) || Model.compareItems(a, b));
    const lines = [head.join(';')];
    for (const i of rows) {
      lines.push(
        [
          Dates.formatNumeric(i.day),
          i.title,
          Model.sourceById(i.source).label,
          Model.statusById(i.status).label,
          Model.priorityById(i.priority).label,
          i.ref || '',
          (i.tags || []).join(' '),
          (i.notes || '').replace(/\n/g, ' '),
          i.createdAt,
          i.doneAt || '',
        ]
          .map(csvEscape)
          .join(';')
      );
    }
    return '﻿' + lines.join('\r\n') + '\r\n'; // BOM fuer Excel
  }

  /** Kurze Klartext-Liste, z.B. zum Reinpasten ins Daily. */
  function plain(items, dayKeys) {
    const inRange = items.filter((i) => dayKeys.includes(i.day)).sort(Model.compareItems);
    return inRange
      .map((i) => `${i.status === 'erledigt' ? '✓' : '·'} ${i.title}${i.ref ? ` (${i.ref})` : ''}`)
      .join('\n');
  }

  return { dayMarkdown, weekMarkdown, csv, plain };
});
