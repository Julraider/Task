'use strict';

/**
 * Tests fuer die Persistenz und die Einstellungen. Laufen ohne Electron -
 * beide Klassen kennen nur einen Dateipfad.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/main/store');
const { Settings, DEFAULTS } = require('../src/main/settings');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tagwerk-test-'));
}

function tmpStore(options) {
  const dir = tmpDir();
  const file = path.join(dir, 'data.json');
  return { dir, file, backups: path.join(dir, 'backups'), store: new Store(file, options).load() };
}

/** Heutiger Tagesschluessel - bewusst ohne den Datums-Helfer, damit der Test unabhaengig bleibt. */
function todayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function names(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => !prefix || n.startsWith(prefix))
    .sort();
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

// --------------------------------------------------------------- Sicherheit

test('ohne Aenderung wird nicht geschrieben', () => {
  const { file, store } = tmpStore();
  store.add(base);
  store.flush();

  fs.unlinkSync(file);
  store.flush();
  assert.ok(!fs.existsSync(file), 'flush() ohne Aenderung fasst die Datei nicht an');

  store.add({ ...base, title: 'Neu' });
  store.flush();
  assert.ok(fs.existsSync(file), 'nach einer Aenderung aber schon');
});

test('eine defekte Hauptdatei ueberschreibt das Backup nicht', () => {
  const { file, backups, store } = tmpStore();
  store.add(base);
  store.flush();
  store.add({ ...base, title: 'Zweite' });
  store.flush();
  assert.ok(fs.existsSync(file + '.bak'));

  fs.writeFileSync(file, '{ das ist kein json', 'utf8');
  const wieder = new Store(file).load();

  assert.strictEqual(wieder.snapshot().items.length, 1, 'das .bak kennt den vorletzten Stand');
  const bak = JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
  assert.strictEqual(bak.items.length, 1, 'und wurde nicht mit dem Schrott ueberbuegelt');
  assert.strictEqual(names(backups, 'defekt-').length, 1, 'die kaputte Fassung liegt in backups/');
  assert.ok(wieder.status().problems.some((p) => p.code === 'defekt'));
});

test('eine Datei aus einer neueren Version wird nicht angefasst', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'data.json');
  const original = JSON.stringify({ version: 99, items: [{ id: 'a', title: 'Aus der Zukunft', day: '2026-08-17' }] });
  fs.writeFileSync(file, original, 'utf8');

  const store = new Store(file).load();
  assert.strictEqual(store.status().readOnly, true);
  assert.strictEqual(store.snapshot().items.length, 1);

  store.add(base);
  assert.strictEqual(store.flush(), false, 'Speichern wird verweigert');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), original, 'die Datei bleibt Zeichen fuer Zeichen gleich');

  const rescue = names(path.join(dir, 'backups'), 'nicht-gespeichert-');
  assert.strictEqual(rescue.length, 1, 'die Eingaben landen in der Notablage');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'backups', rescue[0]), 'utf8')).items.length, 2);
});

test('eine unlesbare Datendatei fuehrt in die Notablage', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'data.json');
  fs.mkdirSync(file); // an der Stelle liegt etwas, das sich nicht lesen laesst

  const store = new Store(file).load();
  assert.strictEqual(store.status().readOnly, true);
  assert.ok(store.status().problems.some((p) => p.code === 'lesefehler'));

  store.add(base);
  assert.strictEqual(store.flush(), false);
  assert.strictEqual(names(path.join(dir, 'backups'), 'nicht-gespeichert-').length, 1);
  assert.ok(fs.statSync(file).isDirectory(), 'das Hindernis wird nicht weggeraeumt');
});

test('unbekannte Felder ueberleben das Laden', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, items: [{ id: 'a', title: 'Mit Extra', day: '2026-08-17', dauerMinuten: 45 }] }),
    'utf8'
  );

  const store = new Store(file).load();
  assert.strictEqual(store.find('a').dauerMinuten, 45);

  store.update('a', { title: 'Geaendert' });
  store.flush();
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).items[0].dauerMinuten, 45);
});

test('unspeicherbare Werte blockieren das Schreiben nicht', () => {
  const { file, store } = tmpStore();
  const zirkel = { id: 'z1', title: 'Zirkelbezug', day: '2026-08-17' };
  zirkel.selbst = zirkel;

  store.restore([zirkel]);
  assert.strictEqual(store.flush(), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).items.length, 1);
});

test('eine fremde Aenderung an der Datei wird weggesichert', () => {
  const { file, backups, store } = tmpStore();
  store.add(base);
  store.flush();

  // zweite Instanz / Editor / Cloud-Ordner schreibt dazwischen
  fs.writeFileSync(file, JSON.stringify({ version: 1, items: [{ id: 'fremd', title: 'Von aussen', day: '2026-08-17' }] }), 'utf8');

  store.add({ ...base, title: 'Danach' });
  store.flush();

  const kept = names(backups, 'konflikt-');
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(backups, kept[0]), 'utf8')).items[0].title, 'Von aussen');
  assert.ok(store.status().problems.some((p) => p.code === 'fremdaenderung'));
});

test('taegliche Sicherung beim Start, aber nur eine pro Tag', () => {
  const { file, backups, store } = tmpStore();
  store.add(base);
  store.flush();
  assert.deepStrictEqual(names(backups), [], 'ohne Neustart passiert nichts');

  new Store(file).load();
  assert.deepStrictEqual(names(backups), [`tag-${todayKey()}.json`]);

  new Store(file).load();
  assert.strictEqual(names(backups, 'tag-').length, 1, 'der zweite Start legt nichts obendrauf');
});

test('alte Tagessicherungen werden nach Anzahl aufgeraeumt', () => {
  const { backups, store } = tmpStore({ keepDaily: 2 });
  store.add(base);
  store.flush();

  fs.mkdirSync(backups, { recursive: true });
  for (const day of ['2020-01-01', '2020-01-02', '2020-01-03']) {
    fs.writeFileSync(path.join(backups, `tag-${day}.json`), '{"version":1,"items":[]}', 'utf8');
  }

  store.backupDaily();
  const left = names(backups, 'tag-');
  assert.strictEqual(left.length, 2);
  assert.ok(left.includes(`tag-${todayKey()}.json`), 'die neueste bleibt');
  assert.ok(!left.includes('tag-2020-01-01.json'), 'die aelteste faellt weg');
});

test('Sicherung anlegen, auflisten und zurueckholen', () => {
  const { store } = tmpStore();
  store.add(base);
  const made = store.createBackup('manuell');
  assert.ok(made.name.startsWith('sicherung-'));

  store.add({ ...base, title: 'Danach' });
  assert.strictEqual(store.snapshot().items.length, 2);

  const list = store.backups();
  assert.ok(list.some((b) => b.name === made.name && b.count === 1 && b.readable));

  const result = store.restoreBackup(made.name);
  assert.deepStrictEqual({ ok: result.ok, count: result.count }, { ok: true, count: 1 });
  assert.strictEqual(store.snapshot().items.length, 1);
  assert.ok(store.backups().some((b) => b.name.includes('vor-wiederherstellung')), 'der Stand davor ist gesichert');
});

test('restoreBackup laesst sich nicht aus dem Ordner locken', () => {
  const { store } = tmpStore();
  assert.strictEqual(store.restoreBackup('../data.json').ok, false);
  assert.strictEqual(store.restoreBackup('/etc/passwd').ok, false);
  assert.strictEqual(store.restoreBackup(null).ok, false);
});

// ------------------------------------------------------------ Massenaktionen

test('updateMany aendert viele Aufgaben in einem Rutsch', () => {
  const { store } = tmpStore();
  const a = store.add(base);
  const b = store.add({ ...base, title: 'B' });
  let calls = 0;
  store.onChange(() => calls++);

  assert.strictEqual(store.updateMany([a.id, b.id, 'gibtsnicht'], { status: 'erledigt' }), 2);
  assert.strictEqual(calls, 1, 'ein Broadcast fuer alles');
  assert.ok(store.find(a.id).doneAt && store.find(b.id).doneAt);
});

test('removeMany liefert das Material fuers Undo', () => {
  const { store } = tmpStore();
  const a = store.add(base);
  const b = store.add({ ...base, title: 'B' });

  const removed = store.removeMany([a.id, b.id]);
  assert.strictEqual(removed.length, 2);
  assert.strictEqual(store.snapshot().items.length, 0);
  assert.strictEqual(store.restore(removed), 2);
});

test('purgeDoneBefore raeumt nur Erledigtes und sichert vorher', () => {
  const { store } = tmpStore();
  const alt = store.add({ ...base, title: 'Alt erledigt', day: '2026-01-05' });
  const offen = store.add({ ...base, title: 'Alt offen', day: '2026-01-05' });
  const neu = store.add({ ...base, title: 'Neu erledigt', day: '2026-08-17' });
  store.updateMany([alt.id, neu.id], { status: 'erledigt' });

  const result = store.purgeDoneBefore('2026-06-01');
  assert.strictEqual(result.count, 1);
  assert.ok(result.backup.includes('vor-aufraeumen'));
  assert.strictEqual(store.find(alt.id), null);
  assert.ok(store.find(offen.id) && store.find(neu.id), 'Offenes und Neueres bleiben');

  assert.strictEqual(store.purgeDoneBefore('quatsch').ok, false);
});

// ------------------------------------------------------------------ Zahlen

test('counts trennt offen, ueberfaellig und heute', () => {
  const { store } = tmpStore();
  store.add({ ...base, title: 'Gestern offen', day: '2026-08-16' });
  store.add({ ...base, title: 'Heute offen', day: '2026-08-17' });
  const done = store.add({ ...base, title: 'Heute erledigt', day: '2026-08-17' });
  store.update(done.id, { status: 'erledigt' });

  assert.deepStrictEqual(store.counts('2026-08-17'), { total: 3, open: 2, done: 1, overdue: 1, today: 1 });
});

test('stats liefert Kennzahlen fuer eine spaetere Auswertung', () => {
  const { store } = tmpStore();
  store.add({ ...base, title: 'Eins', tags: ['netzwerk'], priority: 2 });
  store.add({ ...base, title: 'Zwei', source: 'mail', tags: ['netzwerk', 'vertrieb'] });
  const done = store.add({ ...base, title: 'Drei', day: '2026-08-16' });
  store.update(done.id, { status: 'erledigt' });

  const s = store.stats('2026-08-17');
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.byStatus.offen, 2);
  assert.strictEqual(s.bySource.teams, 2);
  assert.strictEqual(s.byPriority[2], 1);
  assert.deepStrictEqual(s.topTags[0], { tag: 'netzwerk', count: 2 });
  assert.strictEqual(s.firstDay, '2026-08-16');
  assert.strictEqual(s.dayCount, 2);
  assert.strictEqual(typeof s.medianDoneMinutes, 'number');
});

test('kaputte Statuswerte werden auf bekannte Werte gezogen', () => {
  const { store } = tmpStore();
  const item = store.add({ ...base, status: 'hurz', source: 'jira-von-morgen' });
  assert.strictEqual(item.status, 'offen');
  assert.strictEqual(item.source, 'sonstiges');
});

// ------------------------------------------------------------ Einstellungen

function tmpSettings() {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  return { dir, file, settings: new Settings(file).load() };
}

test('Einstellungen ueberleben einen Neustart', () => {
  const { file, settings } = tmpSettings();
  settings.set({ theme: 'dark', showWeekend: true });
  settings.flush();

  const wieder = new Settings(file).load();
  assert.strictEqual(wieder.get('theme'), 'dark');
  assert.strictEqual(wieder.get('showWeekend'), true);
  assert.strictEqual(wieder.get('closeToTray'), DEFAULTS.closeToTray, 'der Rest bleibt Standard');
});

test('unsinnige Werte werden verworfen, nicht uebernommen', () => {
  const { settings } = tmpSettings();
  settings.set({ theme: 'neongruen', globalShortcutEnabled: 'ja', backupKeepDays: 9999 });

  assert.strictEqual(settings.get('theme'), 'system');
  assert.strictEqual(settings.get('globalShortcutEnabled'), true);
  assert.strictEqual(settings.get('backupKeepDays'), 365, 'wird begrenzt statt abgelehnt');
});

test('unbekannte Schluessel bleiben erhalten, kaputte Werte fliegen raus', () => {
  const { file, settings } = tmpSettings();
  const zirkel = { a: 1 };
  zirkel.selbst = zirkel;
  settings.set({ eigeneAnsicht: 'liste', irgendwas: zirkel });
  settings.flush();

  const wieder = new Settings(file).load();
  assert.strictEqual(wieder.get('eigeneAnsicht'), 'liste', 'die Oberflaeche darf neue Einstellungen einfuehren');
  assert.doesNotThrow(() => JSON.stringify(wieder.get()));
});

test('Fensterposition wird geprueft', () => {
  const { settings } = tmpSettings();
  settings.set({ window: { width: 900, height: 700, x: 10, y: 20 } });
  assert.deepStrictEqual(settings.get('window'), { width: 900, height: 700, x: 10, y: 20, maximized: false });

  settings.set({ window: { width: 'breit', x: null } });
  assert.strictEqual(settings.get('window').width, 900, 'Unsinn aendert nichts');
  assert.strictEqual(settings.get('window').x, null, 'null heisst: keine Position');
});

test('kaputte Einstellungsdatei faellt auf die Sicherung zurueck', () => {
  const { file, settings } = tmpSettings();
  settings.set({ theme: 'dark' });
  settings.flush();
  settings.set({ theme: 'light' });
  settings.flush();
  assert.ok(fs.existsSync(file + '.bak'));

  fs.writeFileSync(file, 'kaputt', 'utf8');
  assert.strictEqual(new Settings(file).load().get('theme'), 'dark');
});

test('gebuendeltes Speichern schreibt erst beim flush', () => {
  const { file, settings } = tmpSettings();
  settings.set({ theme: 'dark' });
  assert.ok(!fs.existsSync(file), 'waehrend des Fensterziehens wird nicht jedes Mal geschrieben');
  settings.flush();
  assert.ok(fs.existsSync(file));
});
