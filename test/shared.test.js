'use strict';

/**
 * Tests fuer die geteilte Logik (Datum, Parser, Export).
 * Laufen ohne Electron:  npm test
 */

const test = require('node:test');
const assert = require('node:assert');

const Dates = require('../src/shared/dates');
const Model = require('../src/shared/model');
const Parse = require('../src/shared/parse');
const Exporter = require('../src/shared/export');

// ------------------------------------------------------------------- Datum

test('keyOf/parseKey sind zueinander invers', () => {
  const key = '2026-08-17';
  assert.strictEqual(Dates.keyOf(Dates.parseKey(key)), key);
});

test('addDays kommt ueber Monatsgrenzen', () => {
  assert.strictEqual(Dates.addDays('2026-08-31', 1), '2026-09-01');
  assert.strictEqual(Dates.addDays('2026-01-01', -1), '2025-12-31');
});

test('addDays ueberlebt die Sommerzeit-Umstellung', () => {
  // In DE endet die Sommerzeit am 25.10.2026
  assert.strictEqual(Dates.addDays('2026-10-24', 1), '2026-10-25');
  assert.strictEqual(Dates.addDays('2026-10-25', 1), '2026-10-26');
  assert.strictEqual(Dates.diffDays('2026-03-28', '2026-03-30'), 2);
});

test('startOfWeek liefert immer den Montag', () => {
  assert.strictEqual(Dates.startOfWeek('2026-08-17'), '2026-08-17'); // Montag
  assert.strictEqual(Dates.startOfWeek('2026-08-23'), '2026-08-17'); // Sonntag
  assert.strictEqual(Dates.startOfWeek('2026-08-19'), '2026-08-17'); // Mittwoch
});

test('isoWeek rechnet nach ISO-8601', () => {
  assert.deepStrictEqual(Dates.isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepStrictEqual(Dates.isoWeek('2027-01-01'), { year: 2026, week: 53 });
  assert.deepStrictEqual(Dates.isoWeek('2026-08-17'), { year: 2026, week: 34 });
});

test('isValidKey erkennt Unsinn', () => {
  assert.ok(Dates.isValidKey('2026-08-17'));
  assert.ok(!Dates.isValidKey('17.08.2026'));
  assert.ok(!Dates.isValidKey(''));
  assert.ok(!Dates.isValidKey(null));
});

// ------------------------------------------------------------------ Parser

test('einfacher Text bleibt einfacher Text', () => {
  const r = Parse.parseCapture('Drucker im 2. OG einrichten', '2026-08-17');
  assert.strictEqual(r.title, 'Drucker im 2. OG einrichten');
  assert.strictEqual(r.source, 'sonstiges');
  assert.strictEqual(r.priority, 0);
  assert.strictEqual(r.day, '2026-08-17');
  assert.ok(!r.isEmpty);
});

test('Quelle, Tags und Prioritaet werden erkannt und aus dem Titel entfernt', () => {
  const r = Parse.parseCapture('Switch tauschen @muendlich #netzwerk #dringend !!', '2026-08-17');
  assert.strictEqual(r.title, 'Switch tauschen');
  assert.strictEqual(r.source, 'muendlich');
  assert.deepStrictEqual(r.tags, ['netzwerk', 'dringend']);
  assert.strictEqual(r.priority, 2);
});

test('Quellen-Aliase und Praefixe funktionieren', () => {
  assert.strictEqual(Parse.parseCapture('x @outlook').source, 'mail');
  assert.strictEqual(Parse.parseCapture('x @snow').source, 'ticket');
  assert.strictEqual(Parse.parseCapture('x @tel').source, 'telefon');
  assert.strictEqual(Parse.parseCapture('x @teams').source, 'teams');
});

test('unbekanntes @wort bleibt Teil des Titels', () => {
  const r = Parse.parseCapture('Ruecksprache @kollege_mueller');
  assert.strictEqual(r.title, 'Ruecksprache @kollege_mueller');
  assert.strictEqual(r.source, 'sonstiges');
});

test('Ticketnummer setzt Referenz und Quelle', () => {
  const r = Parse.parseCapture('INC0012345 pruefen');
  assert.strictEqual(r.ref, 'INC0012345');
  assert.strictEqual(r.source, 'ticket');
  assert.strictEqual(r.title, 'INC0012345 pruefen', 'Nummer bleibt im Titel lesbar');
});

test('explizite Quelle schlaegt die Ticket-Automatik', () => {
  const r = Parse.parseCapture('INC0012345 kam per Zuruf @muendlich');
  assert.strictEqual(r.ref, 'INC0012345');
  assert.strictEqual(r.source, 'muendlich');
});

test('Zieltag: relative Angaben', () => {
  const base = '2026-08-17'; // Montag
  assert.strictEqual(Parse.parseCapture('a >heute', base).day, '2026-08-17');
  assert.strictEqual(Parse.parseCapture('a >morgen', base).day, '2026-08-18');
  assert.strictEqual(Parse.parseCapture('a >uebermorgen', base).day, '2026-08-19');
  assert.strictEqual(Parse.parseCapture('a >+5', base).day, '2026-08-22');
  assert.strictEqual(Parse.parseCapture('a >-1', base).day, '2026-08-16');
});

test('Zieltag: Wochentage zielen immer nach vorne', () => {
  const base = '2026-08-17'; // Montag
  assert.strictEqual(Parse.parseCapture('a >fr', base).day, '2026-08-21');
  assert.strictEqual(Parse.parseCapture('a >mo', base).day, '2026-08-24', 'gleicher Wochentag = naechste Woche');
});

test('Zieltag: konkrete Daten', () => {
  const base = '2026-08-17';
  assert.strictEqual(Parse.parseCapture('a >24.12.', base).day, '2026-12-24');
  assert.strictEqual(Parse.parseCapture('a >24.12.2027', base).day, '2027-12-24');
  assert.strictEqual(Parse.parseCapture('a >2026-09-01', base).day, '2026-09-01');
});

test('unbrauchbares >wort bleibt im Titel', () => {
  const r = Parse.parseCapture('Umsatz >1000 pruefen', '2026-08-17');
  assert.strictEqual(r.title, 'Umsatz >1000 pruefen');
  assert.strictEqual(r.dayExplicit, false);
});

test('leere Eingabe wird als leer gemeldet', () => {
  assert.ok(Parse.parseCapture('   ').isEmpty);
  assert.ok(Parse.parseCapture('@teams #nur-metadaten').isEmpty);
});

test('toCaptureLine ist zum Parser passend', () => {
  const item = { title: 'Angebot schreiben', source: 'mail', tags: ['vertrieb'], priority: 1 };
  const line = Parse.toCaptureLine(item);
  const back = Parse.parseCapture(line);
  assert.strictEqual(back.title, item.title);
  assert.strictEqual(back.source, item.source);
  assert.deepStrictEqual(back.tags, item.tags);
  assert.strictEqual(back.priority, item.priority);
});

// ------------------------------------------------------------------ Modell

test('nextStatus laeuft im Kreis', () => {
  let s = 'offen';
  const seen = [];
  for (let i = 0; i < 4; i++) {
    s = Model.nextStatus(s);
    seen.push(s);
  }
  assert.deepStrictEqual(seen, ['aktiv', 'wartet', 'erledigt', 'offen']);
});

test('compareItems: aktiv vor offen, Prioritaet vor Alter, erledigt zuletzt', () => {
  const mk = (id, status, priority, createdAt) => ({ id, status, priority, createdAt, title: id });
  const items = [
    mk('c', 'erledigt', 2, '2026-08-17T08:00:00Z'),
    mk('a', 'offen', 0, '2026-08-17T09:00:00Z'),
    mk('b', 'offen', 2, '2026-08-17T10:00:00Z'),
    mk('d', 'aktiv', 0, '2026-08-17T11:00:00Z'),
  ];
  const order = items.sort(Model.compareItems).map((i) => i.id);
  assert.deepStrictEqual(order, ['d', 'b', 'a', 'c']);
});

// ------------------------------------------------------------------ Export

const sample = [
  {
    id: '1', title: 'Switch tauschen', notes: '', source: 'muendlich', status: 'erledigt', priority: 0,
    ref: null, tags: ['netzwerk'], day: '2026-08-17', createdAt: '2026-08-17T07:10:00.000Z',
    updatedAt: '2026-08-17T09:00:00.000Z', doneAt: '2026-08-17T09:00:00.000Z',
  },
  {
    id: '2', title: 'INC0012345 pruefen', notes: 'Rueckruf bei Frau Meier', source: 'ticket', status: 'offen',
    priority: 2, ref: 'INC0012345', tags: [], day: '2026-08-17', createdAt: '2026-08-17T08:00:00.000Z',
    updatedAt: '2026-08-17T08:00:00.000Z', doneAt: null,
  },
  {
    id: '3', title: 'Angebot schreiben', notes: '', source: 'mail', status: 'wartet', priority: 1,
    ref: null, tags: ['vertrieb'], day: '2026-08-18', createdAt: '2026-08-18T06:30:00.000Z',
    updatedAt: '2026-08-18T06:30:00.000Z', doneAt: null,
  },
];

test('Tages-Markdown enthaelt nur den gewaehlten Tag', () => {
  const md = Exporter.dayMarkdown(sample, '2026-08-17');
  assert.match(md, /# Montag, 17\. August 2026/);
  assert.match(md, /- \[x\] Switch tauschen/);
  assert.match(md, /- \[ \] INC0012345 pruefen/);
  assert.ok(!md.includes('Angebot schreiben'));
  assert.match(md, /Rueckruf bei Frau Meier/, 'Notizen werden eingerueckt mitgenommen');
});

test('Wochen-Markdown gruppiert nach Tagen und zaehlt', () => {
  const days = Dates.daysFrom('2026-08-17', 5);
  const md = Exporter.weekMarkdown(sample, days);
  assert.match(md, /# KW 34/);
  assert.match(md, /3 Aufgaben erfasst, 1 erledigt/);
  assert.match(md, /## Montag, 17\. August 2026/);
  assert.match(md, /## Dienstag, 18\. August 2026/);
  assert.match(md, /## Nimmt man mit/);
});

test('CSV hat Kopfzeile, BOM und maskiert Trennzeichen', () => {
  const csv = Exporter.csv([{ ...sample[1], title: 'Titel; mit "Zeichen"' }]);
  assert.ok(csv.startsWith('﻿'), 'BOM fuer Excel');
  assert.match(csv, /Tag;Titel;Quelle/);
  assert.match(csv, /"Titel; mit ""Zeichen"""/);
});

test('leerer Tag erzeugt trotzdem gueltiges Markdown', () => {
  const md = Exporter.dayMarkdown([], '2026-08-17');
  assert.match(md, /Keine Einträge/);
});
