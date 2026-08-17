'use strict';

/**
 * Tests fuer die geteilte Logik (Datum, Modell, Parser, Export).
 * Laufen ohne Electron:  npm test
 *
 * Fuer jede Parser-Regel steht hier auch der Fehlalarm-Fall: was nicht
 * sicher erkannt wird, muss im Titel stehen bleiben.
 */

const test = require('node:test');
const assert = require('node:assert');

const Dates = require('../src/shared/dates');
const Model = require('../src/shared/model');
const Parse = require('../src/shared/parse');
const Exporter = require('../src/shared/export');

const MONTAG = '2026-08-17'; // Montag, KW 34

// ------------------------------------------------------------------- Datum

test('keyOf/parseKey sind zueinander invers', () => {
  assert.strictEqual(Dates.keyOf(Dates.parseKey(MONTAG)), MONTAG);
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
  assert.strictEqual(Dates.startOfWeek(MONTAG), MONTAG);
  assert.strictEqual(Dates.startOfWeek('2026-08-23'), MONTAG); // Sonntag
  assert.strictEqual(Dates.startOfWeek('2026-08-19'), MONTAG); // Mittwoch
});

test('isoWeek rechnet nach ISO-8601', () => {
  assert.deepStrictEqual(Dates.isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepStrictEqual(Dates.isoWeek('2027-01-01'), { year: 2026, week: 53 });
  assert.deepStrictEqual(Dates.isoWeek(MONTAG), { year: 2026, week: 34 });
});

test('mondayOfIsoWeek ist die Umkehrung von isoWeek', () => {
  assert.strictEqual(Dates.mondayOfIsoWeek(2026, 35), '2026-08-24');
  assert.strictEqual(Dates.mondayOfIsoWeek(2026, 1), '2025-12-29', 'KW 1 kann im Vorjahr beginnen');
  assert.strictEqual(Dates.mondayOfIsoWeek(2026, 53), '2026-12-28', '2026 hat eine KW 53');
  assert.strictEqual(Dates.mondayOfIsoWeek(2025, 53), null, '2025 hat keine KW 53');
  assert.strictEqual(Dates.mondayOfIsoWeek(2026, 0), null);
  assert.strictEqual(Dates.mondayOfIsoWeek(2026, 54), null);
  for (const week of [1, 12, 34, 52]) {
    const key = Dates.mondayOfIsoWeek(2026, week);
    assert.strictEqual(Dates.isoWeek(key).week, week);
  }
});

test('isValidKey erkennt Unsinn - auch Daten, die es nicht gibt', () => {
  assert.ok(Dates.isValidKey(MONTAG));
  assert.ok(!Dates.isValidKey('17.08.2026'));
  assert.ok(!Dates.isValidKey(''));
  assert.ok(!Dates.isValidKey(null));
  assert.ok(!Dates.isValidKey('2026-02-31'), '31. Februar rutscht sonst still in den Maerz');
  assert.ok(!Dates.isValidKey('2026-13-01'));
});

test('Monatsgrenzen, auch im Schaltjahr', () => {
  assert.strictEqual(Dates.startOfMonth(MONTAG), '2026-08-01');
  assert.strictEqual(Dates.endOfMonth(MONTAG), '2026-08-31');
  assert.strictEqual(Dates.endOfMonth('2027-02-10'), '2027-02-28');
  assert.strictEqual(Dates.endOfMonth('2028-02-10'), '2028-02-29');
  assert.strictEqual(Dates.startOfMonth('2026-12-31'), '2026-12-01');
});

test('daysBetween und lastDays liefern zusammenhaengende Zeitraeume', () => {
  assert.deepStrictEqual(Dates.daysBetween('2026-08-17', '2026-08-19'), [
    '2026-08-17', '2026-08-18', '2026-08-19',
  ]);
  assert.deepStrictEqual(Dates.daysBetween(MONTAG, MONTAG), [MONTAG]);
  assert.deepStrictEqual(Dates.daysBetween('2026-08-19', '2026-08-17'), [], 'Ende vor Start = leer');
  assert.deepStrictEqual(Dates.lastDays(3, MONTAG), ['2026-08-15', '2026-08-16', MONTAG]);
  assert.strictEqual(Dates.daysBetween('2026-12-30', '2027-01-02').length, 4, 'ueber den Jahreswechsel');
});

test('Beschriftungen fuer Berichte', () => {
  assert.strictEqual(Dates.formatNumeric(MONTAG), '17.08.2026');
  assert.strictEqual(Dates.monthLabel(MONTAG), 'August 2026');
  assert.strictEqual(Dates.rangeLabel(MONTAG, '2026-08-21'), '17.–21.08.2026');
  assert.strictEqual(Dates.rangeLabel(MONTAG, '2026-09-03'), '17.08. – 03.09.2026');
  assert.strictEqual(Dates.rangeLabel('2026-12-28', '2027-01-03'), '28.12.2026 – 03.01.2027');
  assert.strictEqual(Dates.rangeLabel(MONTAG, MONTAG), '17.08.2026');
});

test('Beschriftungen bleiben leer statt "Invalid Date"', () => {
  // Ein Bericht darf bei einer Aufgabe ohne gueltigen Tag nichts erfinden
  for (const kaputt of [undefined, null, '', 'morgen', '2026-02-31']) {
    assert.strictEqual(Dates.formatLong(kaputt), '');
    assert.strictEqual(Dates.formatShort(kaputt), '');
    assert.strictEqual(Dates.formatNumeric(kaputt), '');
    assert.strictEqual(Dates.monthLabel(kaputt), '');
    assert.strictEqual(Dates.shortWeekday(kaputt), '');
    assert.strictEqual(Dates.rangeLabel(kaputt, MONTAG), '');
  }
  assert.strictEqual(Dates.rangeLabel(MONTAG, 'kaputt'), '17.08.2026', 'ein gueltiger Anfang reicht');
});

test('formatDateTime bleibt leer, wenn nichts da ist', () => {
  assert.match(Dates.formatDateTime('2026-08-17T08:00:00.000Z'), /^\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/);
  assert.strictEqual(Dates.formatDateTime(null), '');
  assert.strictEqual(Dates.formatDateTime('kaputt'), '');
});

// ------------------------------------------------------------------ Parser

test('einfacher Text bleibt einfacher Text', () => {
  const r = Parse.parseCapture('Drucker im 2. OG einrichten', MONTAG);
  assert.strictEqual(r.title, 'Drucker im 2. OG einrichten');
  assert.strictEqual(r.source, 'sonstiges');
  assert.strictEqual(r.priority, 0);
  assert.strictEqual(r.day, MONTAG);
  assert.ok(!r.isEmpty);
});

test('Quelle, Tags und Prioritaet werden erkannt und aus dem Titel entfernt', () => {
  const r = Parse.parseCapture('Switch tauschen @muendlich #netzwerk #dringend !!', MONTAG);
  assert.strictEqual(r.title, 'Switch tauschen');
  assert.strictEqual(r.source, 'muendlich');
  assert.deepStrictEqual(r.tags, ['netzwerk', 'dringend']);
  assert.strictEqual(r.priority, 2);
});

test('Quellen-Aliase und eindeutige Praefixe funktionieren', () => {
  assert.strictEqual(Parse.parseCapture('x @outlook').source, 'mail');
  assert.strictEqual(Parse.parseCapture('x @snow').source, 'ticket');
  assert.strictEqual(Parse.parseCapture('x @tel').source, 'telefon');
  assert.strictEqual(Parse.parseCapture('x @teams').source, 'teams');
});

test('Umlaute und Grossschreibung stoeren die Quelle nicht', () => {
  assert.strictEqual(Parse.parseCapture('x @Mündlich').source, 'muendlich');
  assert.strictEqual(Parse.parseCapture('x @MUENDLICH').source, 'muendlich');
});

test('neue Quellen: Jira, Wiki, Vor Ort', () => {
  assert.strictEqual(Parse.parseCapture('x @jira').source, 'jira');
  assert.strictEqual(Parse.parseCapture('x @confluence').source, 'wiki');
  assert.strictEqual(Parse.parseCapture('x @vor-ort').source, 'vorort');
  assert.strictEqual(Parse.parseCapture('x @werkstatt').source, 'vorort');
});

test('kleine Tippfehler bei @quelle werden verziehen', () => {
  assert.strictEqual(Parse.parseCapture('x @outlok').source, 'mail');
  assert.strictEqual(Parse.parseCapture('x @tems').source, 'teams');
  assert.strictEqual(Parse.parseCapture('x @meting').source, 'meeting');
  assert.strictEqual(Parse.parseCapture('x @servicenwo').source, 'ticket');
});

test('Fehlalarm: fremde @woerter bleiben Teil des Titels', () => {
  const r = Parse.parseCapture('Ruecksprache @kollege_mueller');
  assert.strictEqual(r.title, 'Ruecksprache @kollege_mueller');
  assert.strictEqual(r.source, 'sonstiges');
  assert.strictEqual(Parse.parseCapture('Rueckruf @meier').title, 'Rueckruf @meier');
  assert.strictEqual(Parse.parseCapture('Post an @firma.de').title, 'Post an @firma.de');
});

test('Fehlalarm: mehrdeutige Abkuerzungen werden nicht geraten', () => {
  // @m koennte mail, meeting oder muendlich sein - also lieber gar nichts
  const r = Parse.parseCapture('Notiz @m');
  assert.strictEqual(r.title, 'Notiz @m');
  assert.strictEqual(r.sourceExplicit, false);
});

test('Prioritaet nur als eigenstaendiges Ausrufezeichen', () => {
  assert.strictEqual(Parse.parseCapture('Anruf !').priority, 1);
  assert.strictEqual(Parse.parseCapture('Anruf !!').priority, 2);
  assert.strictEqual(Parse.parseCapture('Anruf !!!').priority, 2, 'mehr als dringend gibt es nicht');
  // Fehlalarm: Ausrufezeichen am Wort sind Satzzeichen
  const r = Parse.parseCapture('Fertig! melden');
  assert.strictEqual(r.title, 'Fertig! melden');
  assert.strictEqual(r.priority, 0);
  assert.strictEqual(Parse.parseCapture('Achtung !!!! lesen').title, 'Achtung !!!! lesen');
});

test('Schlagworte brauchen mindestens einen Buchstaben', () => {
  assert.deepStrictEqual(Parse.parseCapture('Kabel ziehen #netzwerk #3d-druck').tags, ['netzwerk', '3d-druck']);
  assert.deepStrictEqual(Parse.parseCapture('Umbau #Netzwerk #NETZWERK').tags, ['netzwerk'], 'keine Dubletten');
  // Fehlalarm: Nummern und Satzzeichen sind keine Schlagworte und bleiben stehen
  const r = Parse.parseCapture('Rechnung #4711 pruefen');
  assert.strictEqual(r.title, 'Rechnung #4711 pruefen');
  assert.deepStrictEqual(r.tags, []);
  assert.strictEqual(Parse.parseCapture('Angebot #!! schicken').title, 'Angebot #!! schicken');
});

test('Ticketnummer setzt Referenz und Quelle', () => {
  const r = Parse.parseCapture('INC0012345 pruefen');
  assert.strictEqual(r.ref, 'INC0012345');
  assert.strictEqual(r.source, 'ticket');
  assert.strictEqual(r.title, 'INC0012345 pruefen', 'Nummer bleibt im Titel lesbar');
});

test('Ticketnummer auch mit Leerzeichen oder Bindestrich', () => {
  assert.strictEqual(Parse.parseCapture('REQ 4711 abarbeiten').ref, 'REQ4711');
  assert.strictEqual(Parse.parseCapture('CHG-0004711 einplanen').ref, 'CHG-0004711');
  assert.strictEqual(Parse.parseCapture('sctask0099 erledigen').ref, 'SCTASK0099');
});

test('Fehlalarm: Zahlen und Woerter ohne Ticket-Praefix bleiben Text', () => {
  assert.strictEqual(Parse.parseCapture('Umsatz 1000 pruefen').ref, null);
  assert.strictEqual(Parse.parseCapture('Subtask 123 pruefen').ref, null, 'Praefix muss am Wortanfang stehen');
  assert.strictEqual(Parse.parseCapture('INC pruefen').ref, null, 'ohne Nummer keine Referenz');
  assert.strictEqual(Parse.parseCapture('Raum 12 aufraeumen').source, 'sonstiges');
});

test('ServiceNow-Link: die Nummer wird aus der URL geholt', () => {
  const url = 'https://acme.service-now.com/nav_to.do?uri=incident.do%3Fsysparm_query%3Dnumber%3DINC0099887';
  const r = Parse.parseCapture(url + ' anschauen');
  assert.strictEqual(r.ref, 'INC0099887');
  assert.strictEqual(r.source, 'ticket');
  assert.ok(r.title.includes('https://'), 'der Link bleibt im Titel');
});

test('Jira-Link: /browse/KEY-123 wird erkannt', () => {
  const r = Parse.parseCapture('https://jira.firma.de/browse/NET-1234 umsetzen');
  assert.strictEqual(r.ref, 'NET-1234');
  assert.strictEqual(r.source, 'jira');
});

test('Fehlalarm: Links ohne Ticketnummer ergeben keine Referenz', () => {
  const r = Parse.parseCapture('https://acme.service-now.com/home.do aufraeumen');
  assert.strictEqual(r.ref, null);
  assert.strictEqual(r.source, 'sonstiges');
});

test('Projekt-Kuerzel nur, wenn die Quelle es hergibt', () => {
  assert.strictEqual(Parse.parseCapture('NET-1234 umsetzen @jira').ref, 'NET-1234');
  assert.strictEqual(Parse.parseCapture('NET-1234 umsetzen @ticket').ref, 'NET-1234');
  // Fehlalarm: Normen und Bauteile sehen genauso aus
  assert.strictEqual(Parse.parseCapture('Norm DIN-476 pruefen').ref, null);
  assert.strictEqual(Parse.parseCapture('Kabel RS-232 bestellen').ref, null);
});

test('explizite Quelle schlaegt die Ticket-Automatik', () => {
  const r = Parse.parseCapture('INC0012345 kam per Zuruf @muendlich');
  assert.strictEqual(r.ref, 'INC0012345');
  assert.strictEqual(r.source, 'muendlich');
});

test('Zieltag: relative Angaben', () => {
  assert.strictEqual(Parse.parseCapture('a >heute', MONTAG).day, MONTAG);
  assert.strictEqual(Parse.parseCapture('a >morgen', MONTAG).day, '2026-08-18');
  assert.strictEqual(Parse.parseCapture('a >uebermorgen', MONTAG).day, '2026-08-19');
  assert.strictEqual(Parse.parseCapture('a >übermorgen', MONTAG).day, '2026-08-19');
  assert.strictEqual(Parse.parseCapture('a >gestern', MONTAG).day, '2026-08-16');
  assert.strictEqual(Parse.parseCapture('a >vorgestern', MONTAG).day, '2026-08-15');
  assert.strictEqual(Parse.parseCapture('a >+5', MONTAG).day, '2026-08-22');
  assert.strictEqual(Parse.parseCapture('a >-1', MONTAG).day, '2026-08-16');
});

test('Zieltag: Wochen als Einheit (+2w)', () => {
  assert.strictEqual(Parse.parseCapture('a >+2w', MONTAG).day, '2026-08-31');
  assert.strictEqual(Parse.parseCapture('a >-1w', MONTAG).day, '2026-08-10');
  // Fehlalarm
  const r = Parse.parseCapture('Bestellung >+2x pruefen', MONTAG);
  assert.strictEqual(r.title, 'Bestellung >+2x pruefen');
  assert.strictEqual(r.dayExplicit, false);
});

test('Zieltag: Wochentage zielen immer nach vorne', () => {
  assert.strictEqual(Parse.parseCapture('a >fr', MONTAG).day, '2026-08-21');
  assert.strictEqual(Parse.parseCapture('a >mo', MONTAG).day, '2026-08-24', 'gleicher Wochentag = naechste Woche');
  assert.strictEqual(Parse.parseCapture('a >am mittwoch', MONTAG).day, '2026-08-19');
});

test('Zieltag: diesen/naechsten Wochentag', () => {
  assert.strictEqual(Parse.parseCapture('a >diesen freitag', MONTAG).day, '2026-08-21');
  assert.strictEqual(Parse.parseCapture('a >naechsten freitag', MONTAG).day, '2026-08-28');
  assert.strictEqual(Parse.parseCapture('a >nächsten Freitag', MONTAG).day, '2026-08-28');
  // Fehlalarm: 'naechsten' vor irgendetwas anderem bleibt Text
  const r = Parse.parseCapture('Frage >naechsten Kollegen fragen', MONTAG);
  assert.strictEqual(r.title, 'Frage >naechsten Kollegen fragen');
  assert.strictEqual(r.dayExplicit, false);
});

test('Zieltag: naechste Woche', () => {
  assert.strictEqual(Parse.parseCapture('a >naechste woche', MONTAG).day, '2026-08-24');
  assert.strictEqual(Parse.parseCapture('a >nächste Woche', MONTAG).day, '2026-08-24');
  assert.strictEqual(Parse.parseCapture('a >kommende woche', MONTAG).day, '2026-08-24');
  assert.strictEqual(Parse.parseCapture('a >uebernaechste woche', MONTAG).day, '2026-08-31');
  assert.strictEqual(Parse.parseCapture('a >naechste-woche', MONTAG).day, '2026-08-24');
  // Fehlalarm
  const r = Parse.parseCapture('Angebot >naechste Preise abwarten', MONTAG);
  assert.strictEqual(r.title, 'Angebot >naechste Preise abwarten');
});

test('Zieltag: Ende der Woche', () => {
  assert.strictEqual(Parse.parseCapture('a >ende der woche', MONTAG).day, '2026-08-21');
  assert.strictEqual(Parse.parseCapture('a >eow', MONTAG).day, '2026-08-21');
  assert.strictEqual(
    Parse.parseCapture('a >ende der woche', '2026-08-22').day,
    '2026-08-28',
    'am Samstag ist der Freitag schon vorbei'
  );
  assert.strictEqual(Parse.parseCapture('a >anfang der woche', '2026-08-19').day, '2026-08-24');
  // Fehlalarm
  const r = Parse.parseCapture('Bericht >ende Juli einreichen', MONTAG);
  assert.strictEqual(r.title, 'Bericht >ende Juli einreichen');
});

test('Zieltag: Monatsgrenzen', () => {
  assert.strictEqual(Parse.parseCapture('a >monatsende', MONTAG).day, '2026-08-31');
  assert.strictEqual(Parse.parseCapture('a >ende des monats', MONTAG).day, '2026-08-31');
  assert.strictEqual(Parse.parseCapture('a >naechsten monat', MONTAG).day, '2026-09-01');
  assert.strictEqual(Parse.parseCapture('a >monatsanfang', MONTAG).day, '2026-09-01', 'der 1. ist vorbei');
  assert.strictEqual(Parse.parseCapture('a >monatsende', '2026-12-05').day, '2026-12-31');
  // Fehlalarm
  const r = Parse.parseCapture('Abrechnung >monat pruefen', MONTAG);
  assert.strictEqual(r.title, 'Abrechnung >monat pruefen');
});

test('Zieltag: Kalenderwoche', () => {
  assert.strictEqual(Parse.parseCapture('a >kw35', MONTAG).day, '2026-08-24');
  assert.strictEqual(Parse.parseCapture('a >KW 35', MONTAG).day, '2026-08-24');
  assert.strictEqual(Parse.parseCapture('a >kw02', '2026-12-14').day, '2027-01-11', 'vergangene KW = naechstes Jahr');
  assert.strictEqual(Parse.parseCapture('a >kw35/2027', MONTAG).day, '2027-08-30');
  // Fehlalarm
  assert.strictEqual(Parse.parseCapture('a >kw99', MONTAG).title, 'a >kw99');
  assert.strictEqual(Parse.parseCapture('Kosten >kw pruefen', MONTAG).title, 'Kosten >kw pruefen');
});

test('Zieltag: in N Tagen / Wochen', () => {
  assert.strictEqual(Parse.parseCapture('a >in 3 tagen', MONTAG).day, '2026-08-20');
  assert.strictEqual(Parse.parseCapture('a >in 2 wochen', MONTAG).day, '2026-08-31');
  assert.strictEqual(Parse.parseCapture('a >in einer woche', MONTAG).day, '2026-08-24');
  // Fehlalarm
  const r = Parse.parseCapture('Termin >in 3 Raeumen pruefen', MONTAG);
  assert.strictEqual(r.title, 'Termin >in 3 Raeumen pruefen');
  assert.strictEqual(r.dayExplicit, false);
});

test('Zieltag: konkrete Daten', () => {
  assert.strictEqual(Parse.parseCapture('a >24.12.', MONTAG).day, '2026-12-24');
  assert.strictEqual(Parse.parseCapture('a >24.12.2027', MONTAG).day, '2027-12-24');
  assert.strictEqual(Parse.parseCapture('a >24.12.27', MONTAG).day, '2027-12-24');
  assert.strictEqual(Parse.parseCapture('a >2026-09-01', MONTAG).day, '2026-09-01');
  // Fehlalarm: Daten, die es nicht gibt
  assert.strictEqual(Parse.parseCapture('a >31.02.', MONTAG).title, 'a >31.02.');
  assert.strictEqual(Parse.parseCapture('a >2026-02-31', MONTAG).title, 'a >2026-02-31');
});

test('mehrwortige Zieltage fressen keine Titelwoerter', () => {
  const r = Parse.parseCapture('Bericht >montag abgeben', MONTAG);
  assert.strictEqual(r.title, 'Bericht abgeben');
  assert.strictEqual(r.day, '2026-08-24');

  const r2 = Parse.parseCapture('Inventur >ende der woche vorbereiten', MONTAG);
  assert.strictEqual(r2.title, 'Inventur vorbereiten');
  assert.strictEqual(r2.day, '2026-08-21');
});

test('unbrauchbares >wort bleibt im Titel', () => {
  const r = Parse.parseCapture('Umsatz >1000 pruefen', MONTAG);
  assert.strictEqual(r.title, 'Umsatz >1000 pruefen');
  assert.strictEqual(r.dayExplicit, false);
  assert.strictEqual(Parse.parseCapture('Wert >100 >200 vergleichen', MONTAG).dayExplicit, false);
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

test('toCaptureLine nimmt auf Wunsch den Zieltag mit', () => {
  const item = { title: 'Begehung', source: 'vorort', tags: [], priority: 2, day: '2026-08-20' };
  const line = Parse.toCaptureLine(item, MONTAG);
  assert.match(line, />2026-08-20$/);
  const back = Parse.parseCapture(line, MONTAG);
  assert.strictEqual(back.title, 'Begehung');
  assert.strictEqual(back.source, 'vorort');
  assert.strictEqual(back.priority, 2);
  assert.strictEqual(back.day, '2026-08-20');
  assert.strictEqual(Parse.toCaptureLine(item, '2026-08-20'), 'Begehung @vorort !!', 'gleicher Tag = kein >');
});

// ------------------------------------------------------------------ Modell

test('jede Quelle hat Icon, Label und Aliase', () => {
  for (const source of Model.SOURCES) {
    assert.ok(source.id && source.label && source.icon, `unvollstaendig: ${source.id}`);
    assert.ok(Array.isArray(source.aliases) && source.aliases.length, `ohne Aliase: ${source.id}`);
    assert.strictEqual(Model.sourceById(source.id).id, source.id);
  }
  assert.strictEqual(Model.sourceById('gibtsnicht').id, Model.DEFAULT_SOURCE);
});

test('jede Quelle und jeder Status hat eine stabile Icon-Kennung', () => {
  // Diese Liste ist eine Zusage an die Oberflaeche: die Kennungen benennen das
  // Motiv des SVG-Icons und duerfen sich nicht still aendern.
  assert.deepStrictEqual(
    Object.fromEntries(Model.SOURCES.map((s) => [s.id, s.iconId])),
    {
      teams: 'chat',
      mail: 'mail',
      ticket: 'ticket',
      jira: 'puzzle',
      muendlich: 'sprechblase',
      telefon: 'telefon',
      meeting: 'kalender',
      vorort: 'standort',
      wiki: 'buch',
      selbst: 'notiz',
      sonstiges: 'punkte',
    }
  );
  assert.deepStrictEqual(Model.STATUSES.map((s) => s.iconId), ['kreis', 'halbkreis', 'pause', 'haken']);

  const alle = [...Model.SOURCES, ...Model.STATUSES].map((e) => e.iconId);
  assert.strictEqual(new Set(alle).size, alle.length, 'Kennungen muessen eindeutig sein');
  for (const id of alle) assert.match(id, /^[a-z][a-z-]*$/, `unsauber: ${id}`);
});

test('die Emoji bleiben neben den Icon-Kennungen erhalten', () => {
  // Text- und Mail-Export haben keine SVGs - dort ist das Emoji richtig.
  for (const source of Model.SOURCES) assert.ok(source.icon, `ohne Emoji: ${source.id}`);
  for (const status of Model.STATUSES) assert.ok(status.icon, `ohne Zeichen: ${status.id}`);
});

test('die vier Status bleiben unveraendert', () => {
  assert.deepStrictEqual(Model.STATUSES.map((s) => s.id), ['offen', 'aktiv', 'wartet', 'erledigt']);
  assert.deepStrictEqual(Model.STATUS_CYCLE, ['offen', 'aktiv', 'wartet', 'erledigt']);
});

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

test('compareItems sortiert Erledigtes nach dem Abhaken', () => {
  const mk = (id, doneAt) => ({ id, status: 'erledigt', priority: 0, createdAt: '2026-08-17T06:00:00Z', doneAt });
  const items = [mk('spaet', '2026-08-17T16:00:00Z'), mk('frueh', '2026-08-17T08:00:00Z')];
  assert.deepStrictEqual(items.sort(Model.compareItems).map((i) => i.id), ['frueh', 'spaet']);
});

test('compareByDay sortiert erst nach Tag', () => {
  const mk = (id, day) => ({ id, day, status: 'offen', priority: 0, createdAt: '2026-08-17T06:00:00Z' });
  const items = [mk('b', '2026-08-18'), mk('a', '2026-08-17'), mk('c', '2026-08-19')];
  assert.deepStrictEqual(items.sort(Model.compareByDay).map((i) => i.id), ['a', 'b', 'c']);
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

const woche = Dates.daysFrom(MONTAG, 5);

test('Tages-Markdown enthaelt nur den gewaehlten Tag', () => {
  const md = Exporter.dayMarkdown(sample, MONTAG);
  assert.match(md, /# Montag, 17\. August 2026/);
  assert.match(md, /- \[x\] Switch tauschen/);
  assert.match(md, /- \[ \] INC0012345 pruefen/);
  assert.ok(!md.includes('Angebot schreiben'));
  assert.match(md, /Rueckruf bei Frau Meier/, 'Notizen werden eingerueckt mitgenommen');
  assert.match(md, /2 Aufgaben · 1 erledigt \(50 %\)/, 'Kennzahlen fuer den Tag');
});

test('Wochen-Markdown gruppiert nach Tagen, zaehlt und fasst zusammen', () => {
  const md = Exporter.weekMarkdown(sample, woche);
  assert.match(md, /# KW 34 · 17\.–21\.08\.2026/);
  assert.match(md, /\*\*3 Aufgaben\*\* · 1 erledigt \(33 %\)/);
  assert.match(md, /1 offen/);
  assert.match(md, /1 wartet/);
  assert.match(md, /Quellen: /);
  assert.match(md, /Schlagworte: #netzwerk 1/);
  assert.match(md, /## Montag, 17\. August 2026/);
  assert.match(md, /## Dienstag, 18\. August 2026/);
  assert.ok(!md.includes('Mittwoch'), 'leere Tage fallen weg');
  assert.match(md, /## Nimmt man mit \(2\)/);
  assert.match(md, /- \[ \] Angebot schreiben {2}_\(Di 18\.08\./, 'im Uebertrag steht der Tag dabei');
});

test('Notizen stehen als eingerueckte Fortsetzung, nicht als Code-Block', () => {
  const mit = [{ ...sample[1], notes: 'Zeile eins\nZeile zwei' }];
  const md = Exporter.dayMarkdown(mit, MONTAG);
  assert.match(md, /\n {2}Zeile eins {2}\n {2}Zeile zwei/);
  assert.ok(!/\n {4}Zeile eins/.test(md), 'vier Leerzeichen waeren ein Code-Block');
});

test('Zeitraum-Markdown kann nach Quelle gruppieren', () => {
  const md = Exporter.rangeMarkdown(sample, woche, { groupBy: 'quelle', title: 'Woher kam die Arbeit' });
  assert.match(md, /# Woher kam die Arbeit/);
  assert.match(md, /## Outlook \/ Mail/);
  assert.match(md, /## ServiceNow \/ Ticket/);
  assert.match(md, /## Mündlich/);
  assert.match(md, /_\(Mo 17\.08\./, 'ausserhalb der Tagesgruppierung steht der Tag am Eintrag');
});

test('Zeitraum-Markdown kann nach Schlagwort gruppieren', () => {
  const md = Exporter.rangeMarkdown(sample, woche, { groupBy: 'schlagwort', carry: false });
  assert.match(md, /## #netzwerk/);
  assert.match(md, /## #vertrieb/);
  assert.match(md, /## Ohne Schlagwort/);
  assert.ok(!md.includes('Nimmt man mit'), 'carry: false laesst den Uebertrag weg');
});

test('Monats-Markdown gruppiert nach Kalenderwochen', () => {
  const md = Exporter.monthMarkdown(sample, MONTAG);
  assert.match(md, /# August 2026/);
  assert.match(md, /## KW 34 · 17\.–23\.08\.2026/);
  assert.ok(!md.includes('KW 33'), 'Wochen ohne Aufgaben fallen weg');
});

test('leerer Zeitraum erzeugt trotzdem gueltiges Markdown', () => {
  assert.match(Exporter.dayMarkdown([], MONTAG), /Keine Einträge/);
  assert.match(Exporter.weekMarkdown([], woche), /Keine Einträge/);
  assert.match(Exporter.monthMarkdown([], MONTAG), /Keine Einträge/);
});

test('Standup nennt Erledigtes, Anstehendes und Blockiertes', () => {
  const txt = Exporter.standup(sample, woche, { today: '2026-08-18' });
  assert.match(txt, /^Standup 18\.08\.2026/);
  assert.match(txt, /Erledigt:\n {2}Mo Switch tauschen/);
  assert.match(txt, /Dran:\n {2}Mo INC0012345 pruefen \(INC0012345\)/);
  assert.match(txt, /Blockiert:\n {2}Angebot schreiben/, 'der heutige Tag wird nicht extra genannt');
});

test('Standup ohne Aufgaben sagt das auch', () => {
  assert.match(Exporter.standup([], woche), /Nichts erfasst/);
});

// Der HTML-Export landet in einer Outlook-Mail, und Outlook fuer Windows
// rendert mit der Word-Engine. Die folgenden Tests halten fest, was daraus
// folgt - die Begruendung im Einzelnen steht in export.js.

/** Alle style="..."-Inhalte des Berichts. */
function styleAttrs(html) {
  return [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
}

/** Alle Einzelangaben ('padding:0 0 3pt') aus allen style-Attributen. */
function declarations(html) {
  return styleAttrs(html)
    .flatMap((s) => s.split(';'))
    .map((d) => d.trim())
    .filter(Boolean);
}

test('HTML ist ein Tabellen-Layout, kein div-Geflecht', () => {
  const out = Exporter.html(sample, woche);
  assert.match(out, /^<!doctype html>/);
  assert.ok(!/<div/i.test(out), 'Word wirft margin/padding an <div> weg');
  assert.ok(!/<ul|<li[ >]/i.test(out), 'Word setzt an Listen seine eigene Einrueckung');
  assert.match(out, /<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"/);
  assert.match(out, /border-collapse:collapse/);
  assert.match(out, /mso-table-lspace:0pt;mso-table-rspace:0pt/, 'sonst setzt Word 7,5pt Luft daneben');
  assert.match(out, /<td[^>]*>KW 34/, 'der Titel steht in einer Zelle');
  assert.match(out, /Montag, 17\. August 2026/);
  assert.match(out, /&#10003;/, 'Haken fuer Erledigtes');
  assert.match(out, /Rueckruf bei Frau Meier/);
});

test('HTML meidet alles, was die Word-Engine nicht kann', () => {
  const out = Exporter.html(sample, woche);
  for (const verboten of [/<style/i, /class=/i, /@media/i, /@font-face/i, /<font\b/i, /fonts\.googleapis/i]) {
    assert.ok(!verboten.test(out), `nicht erlaubt: ${verboten}`);
  }
  for (const decl of declarations(out)) {
    assert.ok(!/^(float|position)\s*:/.test(decl), `Word kennt kein ${decl}`);
    assert.ok(!/^max-width/.test(decl), `Word kennt kein ${decl}`);
    assert.ok(!/^display\s*:\s*(flex|grid|inline-flex)/.test(decl), `Word kennt kein ${decl}`);
    assert.ok(!/^background/.test(decl), `Hintergrundbilder und -flaechen: ${decl}`);
  }
});

test('HTML misst in pt - rem und em kennt Word nicht', () => {
  const out = Exporter.html(sample, woche);
  for (const decl of declarations(out)) {
    assert.ok(!/\d\s*r?em\b/.test(decl), `relative Einheit in "${decl}"`);
    // px bleibt der Linienstaerke vorbehalten, alles andere rechnet Word krumm
    if (/\dpx/.test(decl)) assert.match(decl, /^border/, `px ausserhalb einer Linie: "${decl}"`);
  }
  assert.match(out, /font-size:11pt/);
  assert.match(out, /padding:\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?pt/, 'Abstaende in pt');
});

test('HTML bringt Schrift und Zeilenhoehe an jeder Textzelle selbst mit', () => {
  const out = Exporter.html(sample, woche);
  const zellen = [...out.matchAll(/<td[^>]*style="([^"]*)"[^>]*>([^<]*)/g)];
  let mitText = 0;
  for (const [, stil, inhalt] of zellen) {
    if (!inhalt.replace(/&nbsp;/g, '').trim()) continue;
    mitText++;
    assert.match(stil, /font-family:'Segoe UI',Calibri,Arial,sans-serif/, 'Word vererbt Schrift nicht in Zellen');
    assert.match(stil, /line-height:\d+(\.\d+)?pt/, 'Zeilenhoehe absolut');
    assert.match(stil, /mso-line-height-rule:exactly/, 'sonst zieht Word die Zeile auf');
  }
  assert.ok(mitText >= 5, `zu wenige Textzellen geprueft: ${mitText}`);
});

test('HTML faerbt keine Flaechen ein - wegen des Dunkelmodus', () => {
  const out = Exporter.html(sample, woche);
  assert.ok(!/bgcolor=/i.test(out), 'Outlook laesst gesetzte Flaechen im Dunkelmodus stehen');
  assert.ok(!/background(-color)?\s*:/i.test(out));
  assert.match(out, /<meta name="color-scheme" content="light dark">/);
  assert.match(out, /<body style="margin:0;padding:12pt;">/, 'auch der Rumpf bleibt ungefaerbt');
  // Zustand haengt nie allein an der Farbe
  assert.match(out, /Erledigt \(1\)/);
});

test('HTML maskiert alles, was wie Markup aussieht', () => {
  const boese = [{ ...sample[0], title: '<b>Skript</b> & "Anfuehrung" \'einfach\'', notes: 'Zeile 1\nZeile 2' }];
  const out = Exporter.html(boese, [MONTAG], { fragment: true });
  assert.ok(!out.includes('<b>Skript</b>'));
  assert.match(out, /&lt;b&gt;Skript&lt;\/b&gt; &amp; &quot;Anfuehrung&quot; &#39;einfach&#39;/);
  assert.match(out, /Zeile 1<br>Zeile 2/);
  assert.strictEqual(out.split('<td').length - 1, out.split('</td>').length - 1, 'Zellen bleiben paarig');
});

test('HTML als Fragment ist genau das, was in die Zwischenablage gehoert', () => {
  const out = Exporter.html(sample, woche, { fragment: true });
  assert.ok(out.startsWith('<table '), 'kein <html>-Geruest');
  assert.ok(out.endsWith('</table>'));
  assert.ok(!out.includes('<!doctype'));
  assert.ok(!out.includes('<meta'));
});

test('HTML: Uebertrag nur, wenn der Bericht ueber mehrere Tage geht', () => {
  const woche_ = Exporter.html(sample, woche, { fragment: true });
  assert.match(woche_, /Nimmt man mit \(2\)/);
  assert.match(woche_, /\(Di 18\.08\..*Angebot|Angebot schreiben <span[^>]*>\(Di 18\.08\./, 'im Uebertrag steht der Tag');

  const tag = Exporter.html(sample, [MONTAG], { fragment: true });
  assert.ok(!tag.includes('Nimmt man mit'), 'an einem Tag stuende sonst alles doppelt');
  assert.ok(!Exporter.html(sample, woche, { fragment: true, carry: false }).includes('Nimmt man mit'));
});

test('HTML kann Notizen weglassen und gruppiert wie Markdown', () => {
  const ohne = Exporter.html(sample, woche, { fragment: true, notes: false });
  assert.ok(!ohne.includes('Rueckruf bei Frau Meier'));

  const quelle = Exporter.html(sample, woche, { fragment: true, groupBy: 'quelle' });
  assert.match(quelle, /ServiceNow \/ Ticket/);
  assert.match(quelle, /\(Mo 17\.08\./, 'ausserhalb der Tagesgruppierung steht der Tag am Eintrag');
});

test('HTML bleibt auch ohne Aufgaben gueltig', () => {
  const leer = Exporter.html([], woche);
  assert.match(leer, /Keine Einträge/);
  assert.match(leer, /<table role="presentation"/);
  assert.ok(!/<div/i.test(leer));
});

test('CSV hat Kopfzeile, BOM und maskiert Trennzeichen', () => {
  const csv = Exporter.csv([{ ...sample[1], title: 'Titel; mit "Zeichen"' }]);
  assert.ok(csv.startsWith('﻿'), 'BOM fuer Excel');
  assert.match(csv, /Tag;Wochentag;KW;Titel;Quelle/);
  assert.match(csv, /"Titel; mit ""Zeichen"""/);
  assert.ok(csv.endsWith('\r\n'), 'CRLF am Zeilenende');
  assert.match(csv, /;34;/, 'Kalenderwoche steht mit drin');
  assert.match(csv, /17\.08\.2026 \d{2}:\d{2}/, 'Zeitstempel im deutschen Format');
});

test('CSV behaelt Zeilenumbrueche in Notizen - in Anfuehrungszeichen', () => {
  const csv = Exporter.csv([{ ...sample[1], notes: 'Zeile 1\r\nZeile 2' }]);
  assert.match(csv, /"Zeile 1\nZeile 2"/);
  assert.strictEqual(csv.trimEnd().split('\r\n').length, 2, 'trotzdem nur zwei Datensaetze-Zeilen');
});

test('CSV entschaerft Zellen, die Excel als Formel lesen wuerde', () => {
  const csv = Exporter.csv([
    { ...sample[0], title: '=SUMME(A1:A9) pruefen' },
    { ...sample[0], id: 'x', title: '-Update einspielen' },
    { ...sample[0], id: 'y', title: '-1 Tag verschieben' },
  ]);
  assert.match(csv, /'=SUMME/);
  assert.match(csv, /'-Update/);
  assert.match(csv, /;-1 Tag verschieben;/, 'normale Minus-Zahlen bleiben unangetastet');
});

test('CSV laesst sich auf Komma umstellen', () => {
  const csv = Exporter.csv([sample[0]], { delimiter: ',', bom: false });
  assert.ok(!csv.startsWith('﻿'));
  assert.match(csv, /Tag,Wochentag,KW,Titel/);
});

test('summarize zaehlt Status, Quellen und Schlagworte', () => {
  const sum = Exporter.summarize(sample);
  assert.strictEqual(sum.total, 3);
  assert.strictEqual(sum.done, 1);
  assert.strictEqual(sum.open, 1);
  assert.strictEqual(sum.waiting, 1);
  assert.strictEqual(sum.sources.length, 3);
  assert.deepStrictEqual(sum.tags.map((t) => t.tag).sort(), ['netzwerk', 'vertrieb']);
});

test('build waehlt das passende Format', () => {
  assert.match(Exporter.build('md', sample, [MONTAG]), /# Montag, 17\. August 2026/);
  assert.match(Exporter.build('md', sample, woche), /# KW 34/);
  assert.match(Exporter.build('html', sample, woche), /^<!doctype html>/);
  assert.match(Exporter.build('standup', sample, woche), /^Standup/);
  assert.deepStrictEqual(Exporter.build('liste', sample, woche).split('\n'), [
    '· INC0012345 pruefen (INC0012345)',
    '✓ Switch tauschen',
    '· Angebot schreiben',
  ]);
  assert.ok(Exporter.build('csv', sample, woche).startsWith('﻿'));
});

test('build ohne Tagesliste nimmt alle Aufgaben', () => {
  const md = Exporter.build('md', sample, null);
  assert.match(md, /Switch tauschen/);
  assert.match(md, /Angebot schreiben/);
});

test('build grenzt auf die uebergebenen Tage ein', () => {
  const csv = Exporter.build('csv', sample, [MONTAG]);
  assert.ok(!csv.includes('Angebot schreiben'));
});

test('build liefert JSON mit Version und sortierten Aufgaben', () => {
  const data = JSON.parse(Exporter.build('json', sample, woche, { version: 2 }));
  assert.strictEqual(data.version, 2);
  assert.deepStrictEqual(data.items.map((i) => i.day), ['2026-08-17', '2026-08-17', '2026-08-18']);
});

test('lange Zeitraeume werden nach Kalenderwochen gebuendelt', () => {
  const keys = Dates.daysBetween('2026-08-01', '2026-09-15');
  const md = Exporter.build('md', sample, keys);
  assert.match(md, /## KW 34/);
  assert.ok(!md.includes('## Montag, 17. August 2026'), 'sonst wuerde der Bericht ausufern');
});

test('FORMATS und formatById passen zusammen', () => {
  for (const format of Exporter.FORMATS) {
    assert.ok(format.id && format.label && format.ext);
    assert.strictEqual(Exporter.formatById(format.id).id, format.id);
    assert.strictEqual(typeof Exporter.build(format.id, sample, woche), 'string');
  }
  assert.strictEqual(Exporter.formatById('gibtsnicht').id, 'md');
});
