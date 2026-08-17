# Tagwerk

Eine kleine Electron-App, um festzuhalten, was im Laufe eines Arbeitstages so
reinkommt – aus Teams, aus Outlook, aus ServiceNow, per Telefon oder einfach als
Zuruf im Flur. Eine Zeile tippen, Enter, weiter arbeiten. Am Ende der Woche
steht da, was man gemacht hat.

![Tagesansicht](docs/screenshot-tag.png)

## Was die App kann

- **Erfassen in einer Zeile** – Quelle, Tags, Priorität und Zieltag stehen mit
  im Text (`Switch tauschen @muendlich #netzwerk ! >nächste woche`), der Rest
  wird automatisch erkannt. Beim Tippen werden `@quellen` und `#schlagworte`
  vervollständigt.
- **Schnellerfassung per globalem Tastenkürzel** (`Strg + Alt + T`) – ein
  kleines Fenster erscheint über allem anderen, auch wenn Tagwerk gerade im
  Hintergrund läuft. Tippen, Enter, weg.
- **Tages- und Wochenansicht** – die Woche als Spalten, Aufgaben lassen sich
  zwischen den Tagen ziehen. Die Tagesliste lässt sich nach Status oder Quelle
  gruppieren.
- **Ohne Maus bedienbar** – durch die Liste blättern, erledigen, bearbeiten,
  verschieben, mehrere auswählen: alles über die Tastatur.
- **Nichts fällt hinten runter** – offene Aufgaben aus früheren Tagen stehen
  oben in der Tagesansicht, nach Tagen gebündelt, und lassen sich mit einem
  Klick herholen.
- **Vier Zustände**: offen → in Arbeit → wartet → erledigt, per Klick auf den
  Kreis links durchschaltbar.
- **Export** als Markdown-Bericht mit Kennzahlen, als **HTML zum Einfügen in
  eine Outlook-Mail** (Outlook versteht kein Markdown), als Standup-Liste, als
  CSV für Excel oder als JSON zur Sicherung – wahlweise in eine Datei oder
  direkt in die Zwischenablage, gegliedert nach Tag, Kalenderwoche, Quelle
  oder Schlagwort.
- **Die Daten sind sicher** – atomares Schreiben, tägliche Sicherungen mit
  Rotation, Sicherung vor jeder riskanten Aktion.
- **Läuft im Infobereich weiter**, wenn man das Fenster schließt.
- **Hell/Dunkel** nach Systemeinstellung oder fest gewählt.

![Wochenansicht](docs/screenshot-woche.png)

## Starten

```bash
npm install     # einmalig, lädt Electron herunter
npm start       # App starten
npm run dev     # dasselbe mit geöffneten Entwicklertools
npm test        # 108 Tests für Datum, Parser, Export und Persistenz
```

Getestet mit Node 22 und Electron 43.

## Bedienung

### Die Erfassungszeile

Alles kommt in eine Zeile, die Reihenfolge ist egal:

| Eingabe | Bedeutung |
| --- | --- |
| `@teams` | Quelle: `@teams` `@mail` `@ticket` `@jira` `@muendlich` `@telefon` `@meeting` `@vorort` `@wiki` `@selbst` `@sonstiges` |
| `#netzwerk` | Schlagwort, beliebig viele |
| `!` bzw. `!!` | Priorität hoch bzw. dringend |
| `>morgen` | Zieltag: `>heute` `>morgen` `>uebermorgen`, Wochentage `>mo`…`>so`, `>+3`, `>24.12.`, `>2026-12-24` |
| `>nächste woche` | Auch in Worten: `>ende der woche` `>nächsten montag` `>kw35` `>monatsende` `>in 3 tagen` `>in 2 wochen` |
| `INC0012345` | Ticketnummern (INC, RITM, REQ, CHG, PRB, SR, SCTASK, CTASK, TASK, KB) werden als Referenz erkannt und setzen die Quelle auf Ticket – auch aus einem eingefügten ServiceNow- oder Jira-Link |

Kurzformen und Tippfehler bei der Quelle sind erlaubt: `@out` → Outlook,
`@snow` → ServiceNow, `@tems` → Teams. Umlaute spielen keine Rolle
(`@Mündlich` = `@muendlich`).

Unter dem Feld steht live, was erkannt wurde. Alles, was **nicht sicher**
erkannt wird, bleibt einfach Teil des Titels – `Umsatz >1000 prüfen` wird also
nicht versehentlich verschoben, und eine mehrdeutige Abkürzung wie `@m` (Mail?
Meeting? Mündlich?) wird bewusst nicht geraten, sondern stehen gelassen.

### Tastenkürzel

| Kürzel | Wirkung |
| --- | --- |
| `Strg + Alt + T` | Schnellerfassung – wirkt systemweit (in den Einstellungen änderbar) |
| `Strg + N` | Cursor in die Erfassungszeile |
| `Tab` | In der Erfassungszeile: nächster Vorschlag für `@quelle` / `#tag` |
| `Strg + F` | Suchen |
| `Strg + Umschalt + F` | Alle Filter zurücksetzen |
| `Strg + 1` / `Strg + 2` | Tages- / Wochenansicht |
| `Strg + E` | Exportieren |
| `Strg + ,` | Einstellungen |
| `Alt + ←` / `Alt + →` | einen Tag bzw. eine Woche zurück / vor |
| `Alt + ↓` | zurück zu heute |
| `F1` | Kurzanleitung |
| `Esc` | Vorschlag verwerfen, Feld leeren, Filter zurücksetzen, Dialog schließen |

In der Liste (sobald eine Karte den Fokus hat):

| Kürzel | Wirkung |
| --- | --- |
| `↑` / `↓` | durch die Aufgaben blättern (in der Wochenansicht auch `←` / `→`) |
| `Leertaste` | erledigt / wieder offen |
| `Enter` | auf- und zuklappen |
| `e` | bearbeiten |
| `m` | einen Tag weiterschieben (Liegengebliebenes auf heute) |
| `x` | auswählen – mehrere auf einmal bearbeiten |
| `Umschalt + ↑`/`↓` | mehrere am Stück auswählen |
| `Entf` | löschen (mit Rückgängig-Hinweis) |

In der Bearbeitungsmaske speichert `Strg + Enter`. In der Schnellerfassung
speichert `Umschalt + Enter`, ohne das Fenster zu schließen – so lassen sich
mehrere Aufgaben hintereinander erfassen; `↑`/`↓` blättert durch die zuletzt
erfassten Zeilen.

## Wo liegen die Daten?

Alles in einer einzigen JSON-Datei im Benutzerprofil – zum Sichern reicht es,
den Ordner zu kopieren. Über *Einstellungen → Datenordner öffnen* kommt man
direkt hin.

| System | Pfad |
| --- | --- |
| Windows | `%APPDATA%\Tagwerk\tagwerk-data.json` |
| macOS | `~/Library/Application Support/Tagwerk/tagwerk-data.json` |
| Linux | `~/.config/Tagwerk/tagwerk-data.json` |

Daneben liegen `settings.json` (Einstellungen, Fensterposition),
`tagwerk-data.json.bak` (die jeweils vorherige Fassung) und der Ordner
`backups/`:

| Datei | wann sie entsteht |
| --- | --- |
| `tag-JJJJ-MM-TT.json` | einmal täglich beim Start, die letzten 14 Tage (einstellbar) |
| `sicherung-<zeit>-<grund>.json` | vor riskanten Aktionen: Import, Aufräumen, Wiederherstellen |
| `defekt-<zeit>.json` | eine unlesbare Datendatei wird weggesichert, nie überschrieben |
| `konflikt-<zeit>.json` | jemand anders hat die Datei verändert (zweite Instanz, Cloud-Ordner) |

Geschrieben wird gebündelt und wirklich atomar: erst in eine `.tmp`-Datei,
dann `fsync`, dann umbenennen, dann das Verzeichnis synchronisieren. Ohne das
`fsync` stünde nach einem Stromausfall zwar der richtige Dateiname da –
möglicherweise aber mit leerem Inhalt.

Stammt die Datei aus einer neueren Programmversion oder lässt sie sich nicht
schreiben, rührt Tagwerk sie **nicht** an, sondern legt Änderungen in einer
Notablage ab und sagt Bescheid. Lieber ein sichtbarer Fehler als stiller
Datenverlust.

## Aufbau des Projekts

```
src/
  main/           Main-Prozess (Node)
    main.js       Fenster, Tray, globales Tastenkürzel, App-Lebenszyklus
    store.js      Aufgaben laden/speichern (JSON, atomar, mit Backup)
    settings.js   Einstellungen und Fensterposition
    ipc.js        alle IPC-Handler an einem Ort
  preload/
    preload.js    contextBridge: die einzige Brücke zum Renderer
  renderer/       Oberfläche (klassisches HTML/CSS/JS, kein Build-Schritt)
    index.html    Hauptfenster
    quick.html    Schnellerfassung
    styles.css    komplette Oberfläche, Farben als CSS-Variablen
    js/
      util.js     DOM-Helfer, Toasts
      state.js    Zustand des Renderers + alle Aktionen
      item.js     Darstellung einer Aufgabe (ausführlich und kompakt)
      views.js    Tages- und Wochenansicht
      dialogs.js  Einstellungen, Export, Hilfe
      app.js      Kopfzeile, Erfassungszeile, Filter, Tastenkürzel
      quick.js    Logik der Schnellerfassung
  shared/         von Main *und* Renderer genutzt (UMD-Wrapper)
    dates.js      Tagesschlüssel 'YYYY-MM-DD', Wochen, Formatierung
    model.js      Quellen, Status, Prioritäten, Sortierung
    parse.js      Parser der Erfassungszeile
    export.js     Markdown / CSV
test/             Tests (node --test, ohne Electron)
scripts/
  make-icons.js   erzeugt die Icons in assets/ (reines Node, keine Abhängigkeiten)
```

### Wie es zusammenspielt

Die Daten liegen ausschließlich im Main-Prozess. Der Renderer schickt jede
Änderung per IPC dorthin; der Store meldet danach den kompletten neuen Stand an
**alle** Fenster (`data:changed`). Deshalb können Hauptfenster und
Schnellerfassung nie auseinanderlaufen, und der Renderer braucht keine eigene
Synchronisationslogik.

`contextIsolation` ist an, `nodeIntegration` aus – der Renderer sieht nur die
Funktionen aus `preload.js`. Beide Fenster haben eine strenge CSP; Texte werden
grundsätzlich über `textContent` gesetzt, nie über `innerHTML`.

### Datenmodell

```jsonc
{
  "version": 1,
  "items": [
    {
      "id": "itm_m4x1k2_a7b3c9",
      "title": "Switch im Serverraum tauschen",
      "notes": "",
      "source": "muendlich",          // teams | mail | ticket | muendlich | telefon | meeting | selbst | sonstiges
      "status": "offen",              // offen | aktiv | wartet | erledigt
      "priority": 2,                  // 0 normal, 1 hoch, 2 dringend
      "ref": null,                    // Ticketnummer o. Ä.
      "tags": ["netzwerk"],
      "day": "2026-08-17",            // lokaler Tag, nicht UTC
      "createdAt": "2026-08-17T05:45:00.000Z",
      "updatedAt": "2026-08-17T05:45:00.000Z",
      "doneAt": null
    }
  ]
}
```

Unbekannte oder unvollständige Felder werden beim Laden geradegezogen
(`normalize` in `store.js`), eine kaputte Datei fällt automatisch auf `.bak`
zurück. Für spätere Schema-Änderungen ist `migrate()` der richtige Ort.

## Selbst weiterbauen

Ein paar naheliegende Stellen:

- **Neue Quelle** (z. B. Jira, SAP): einen Eintrag in `SOURCES` in
  `src/shared/model.js` ergänzen – Filter, Editor, Parser-Aliase und Export
  ziehen automatisch nach.
- **Neuer Status**: `STATUSES` und `STATUS_CYCLE` in derselben Datei, dazu eine
  Farbregel in `styles.css` (`.item[data-status='…']`).
- **Weitere Ticket-Präfixe**: `REF_PATTERN` in `src/shared/parse.js`.
- **Anderes Exportformat**: eine Funktion in `src/shared/export.js`, einen
  Eintrag in dessen `FORMATS` und einen Zweig in `build()` – der Export-Dialog
  liest die Liste selbst aus und zeigt das Format ohne weiteres Zutun an.
- **Eigenes Icon**: die PNGs in `assets/` ersetzen (oder `scripts/make-icons.js`
  anpassen und `npm run icons` laufen lassen).

Die Renderer-Dateien sind bewusst klassische `<script>`-Dateien ohne Bundler:
Datei ändern, `Strg + R` im Fenster, fertig.

### Ideen für später

- Verknüpfung mit Outlook/ServiceNow (Aufgaben direkt aus einer Mail oder einem
  Ticket anlegen)
- Zeiterfassung pro Aufgabe
- Wiederkehrende Aufgaben
- Volltextsuche über alle Wochen mit Zeitfilter
- Statistik: Woher kommt eigentlich die meiste Arbeit?

## Paketieren

```bash
npm run pack    # entpackter Build in dist/ (zum Ausprobieren)
npm run dist    # Installer bauen
```

Konfiguriert sind Windows (NSIS-Installer + portable Exe), Linux (AppImage) und
macOS (DMG) – siehe `build` in der `package.json`. Für einen Windows-Build
sollte man auf Windows bauen.

Die portable Exe ist praktisch, wenn auf dem Arbeitsrechner keine Software
installiert werden darf: einmal bauen, Datei auf den Rechner kopieren, fertig.
Die Daten landen trotzdem im Benutzerprofil unter `%APPDATA%\Tagwerk`.

## Lizenz

MIT
