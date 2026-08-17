'use strict';

/**
 * Tests fuer die Persistenz. Laufen ohne Electron - der Store kennt nur
 * einen Dateipfad.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/main/store');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagwerk-test-'));
  const file = path.join(dir, 'data.json');
  return { dir, file, store: new Store(file).load() };
}

const base = { title: 'Testaufgabe', source: 'teams', day: '2026-08-17' };

test('add legt eine vollstaendige Aufgabe an', () => {
  const { store } = tmpStore();
  const item = store.add(base);

  assert.ok(item.id.startsWith('itm_'));
  assert.strictEqual(item.title, 'Testaufgabe');
  assert.strictEqual(item.status, 'offen');
  assert.strictEqual(item.priority, 0);
  assert.deepStrictEqual(item.tags, []);
  assert.strictEqual(item.doneAt, null);
  assert.ok(item.createdAt && item.updatedAt);
});

test('add ohne Titel wird abgelehnt', () => {
  const { store } = tmpStore();
  assert.strictEqual(store.add({ title: '   ' }), null);
  assert.strictEqual(store.snapshot().items.length, 0);
});

test('update setzt und loescht doneAt', () => {
  const { store } = tmpStore();
  const item = store.add(base);

  store.update(item.id, { status: 'erledigt' });
  assert.ok(store.find(item.id).doneAt, 'doneAt wird beim Erledigen gesetzt');

  store.update(item.id, { status: 'offen' });
  assert.strictEqual(store.find(item.id).doneAt, null, 'und beim Wiederoeffnen entfernt');
});

test('update kann id und createdAt nicht ueberschreiben', () => {
  const { store } = tmpStore();
  const item = store.add(base);
  const created = item.createdAt;

  store.update(item.id, { id: 'gehackt', createdAt: '1999-01-01T00:00:00.000Z', title: 'Neu' });
  const after = store.find(item.id);

  assert.strictEqual(after.title, 'Neu');
  assert.strictEqual(after.createdAt, created);
  assert.strictEqual(store.find('gehackt'), null);
});

test('remove + restore ergibt den Ausgangszustand', () => {
  const { store } = tmpStore();
  const item = store.add(base);

  const removed = store.remove(item.id);
  assert.strictEqual(store.snapshot().items.length, 0);

  store.restore([removed]);
  assert.deepStrictEqual(store.find(item.id), removed);
});

test('restore legt bereits vorhandene Items nicht doppelt an', () => {
  const { store } = tmpStore();
  const item = store.add(base);
  assert.strictEqual(store.restore([item]), 0);
  assert.strictEqual(store.snapshot().items.length, 1);
});

test('moveToDay verschiebt nur, was sich aendert', () => {
  const { store } = tmpStore();
  const a = store.add(base);
  const b = store.add({ ...base, title: 'Zweite' });

  assert.strictEqual(store.moveToDay([a.id, b.id], '2026-08-18'), 2);
  assert.strictEqual(store.moveToDay([a.id], '2026-08-18'), 0, 'gleicher Tag = keine Aenderung');
  assert.strictEqual(store.find(a.id).day, '2026-08-18');
});

test('clearDone raeumt nur den angegebenen Tag auf', () => {
  const { store } = tmpStore();
  const a = store.add({ ...base, title: 'A' });
  const b = store.add({ ...base, title: 'B', day: '2026-08-18' });
  store.update(a.id, { status: 'erledigt' });
  store.update(b.id, { status: 'erledigt' });

  const removed = store.clearDone('2026-08-17');
  assert.strictEqual(removed.length, 1);
  assert.strictEqual(store.snapshot().items.length, 1);
  assert.strictEqual(store.find(b.id).title, 'B');
});

test('Daten ueberleben einen Neustart', () => {
  const { file, store } = tmpStore();
  store.add(base);
  store.add({ ...base, title: 'Noch eine', priority: 2 });
  store.flush();

  const wieder = new Store(file).load();
  assert.strictEqual(wieder.snapshot().items.length, 2);
  assert.strictEqual(wieder.snapshot().items[1].priority, 2);
});

test('kaputte Datei faellt auf das Backup zurueck', () => {
  const { file, store } = tmpStore();
  store.add(base);
  store.flush();

  // zweiter Schreibvorgang erzeugt das .bak aus der ersten Fassung
  store.add({ ...base, title: 'Zweite' });
  store.flush();
  assert.ok(fs.existsSync(file + '.bak'));

  fs.writeFileSync(file, '{ das ist kein json', 'utf8');

  const wieder = new Store(file).load();
  assert.ok(wieder.snapshot().items.length >= 1, 'Backup wurde genutzt');
  assert.strictEqual(wieder.snapshot().items[0].title, 'Testaufgabe');
});

test('leere oder fehlende Datei ergibt einen leeren Datensatz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagwerk-test-'));
  const file = path.join(dir, 'nichts.json');

  assert.strictEqual(new Store(file).load().snapshot().items.length, 0);

  fs.writeFileSync(file, '', 'utf8');
  assert.strictEqual(new Store(file).load().snapshot().items.length, 0);
});

test('fremde/unvollstaendige Items werden beim Laden geradegezogen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagwerk-test-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      items: [
        { title: 'Ohne alles' },
        { title: 'Kaputter Tag', day: 'irgendwann', priority: 99 },
        { title: '' },
      ],
    }),
    'utf8'
  );

  const items = new Store(file).load().snapshot().items;
  assert.strictEqual(items.length, 2, 'Eintraege ohne Titel fliegen raus');
  assert.match(items[0].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(items[1].priority, 2, 'Prioritaet wird begrenzt');
  assert.strictEqual(items[0].status, 'offen');
});

test('merge ergaenzt, replaceAll ersetzt', () => {
  const { store } = tmpStore();
  store.add(base);

  store.merge([{ title: 'Importiert', day: '2026-08-19' }]);
  assert.strictEqual(store.snapshot().items.length, 2);

  store.replaceAll([{ title: 'Nur noch das hier', day: '2026-08-20' }]);
  assert.strictEqual(store.snapshot().items.length, 1);
  assert.strictEqual(store.snapshot().items[0].title, 'Nur noch das hier');
});

test('merge vergibt neue IDs bei Kollisionen', () => {
  const { store } = tmpStore();
  const item = store.add(base);

  store.merge([{ id: item.id, title: 'Gleiche ID', day: '2026-08-17' }]);
  const items = store.snapshot().items;

  assert.strictEqual(items.length, 2);
  assert.notStrictEqual(items[0].id, items[1].id);
});

test('onChange meldet jede Aenderung', () => {
  const { store } = tmpStore();
  let calls = 0;
  const off = store.onChange(() => calls++);

  store.add(base);
  store.add({ ...base, title: 'B' });
  assert.strictEqual(calls, 2);

  off();
  store.add({ ...base, title: 'C' });
  assert.strictEqual(calls, 2, 'nach dem Abmelden kommt nichts mehr');
});
