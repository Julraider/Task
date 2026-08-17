# Tagwerk – Gestaltungsleitfaden

**Verbindlich.** Dieser Leitfaden ist keine Sammlung von Vorschlägen. Jede Zahl,
jeder Hex-Wert und jede Regel darin ist eine getroffene Entscheidung und wird so
umgesetzt. Wo etwas fehlt, gilt: *im Zweifel weniger, im Zweifel linksbündig, im
Zweifel ohne Schatten.*

Stand: 2026-08-17 · gilt für `src/renderer/styles.css`, `index.html`,
`quick.html` und alle Renderer-Module.

---

## 0. Die Entscheidung in fünf Sätzen

1. **Tagwerk sieht aus wie ein Kursbuch, nicht wie eine Landingpage.** Die
   Aufgabenliste ist eine Fahrplantafel: Zeilen, die durch Haarlinien getrennt
   sind, in festen Spalten, ohne Kästen, ohne Schatten, ohne Abstände dazwischen.
2. **Papier und Tinte statt Weiß und Grau.** Alle Flächen sind warm getönt
   (leichter Gelbstich, wie Werkdruckpapier), alle Grauwerte tragen denselben
   Stich; reines `#ffffff`, reines `#000000` und neutrale Grautöne kommen nicht vor.
3. **Genau ein Akzent: Petrol `#0F5B6E`.** Kein Indigo, kein Violett, kein
   Verlauf. Petrol markiert *jetzt* (heute, in Arbeit, Fokus, Auswahl) – sonst
   nichts.
4. **Erledigtes wird leiser, nicht bunter.** Es gibt kein Grün in dieser App. Wer
   40 Aufgaben am Tag sieht, braucht die *offenen* im Vordergrund; Erledigtes
   rutscht in Graphit und wird durchgestrichen wie in einem Papier-Tagebuch.
5. **Emoji verschwinden vollständig aus der Oberfläche** und werden durch
   einfarbige Inline-SVG auf 16-px-Raster ersetzt. Sie bleiben ausschließlich im
   Export (Markdown, Text, CSV, Standup, Outlook-HTML).

### Warum Kursbuch?

Ein gedruckter Fahrplan ist der Extremfall dessen, was diese App leisten muss: 40
und mehr Einträge pro Seite, rein typografisch geordnet, in Sekunden abzusuchen,
ohne eine einzige Dekoration. Er löst genau unsere Probleme – Dichte, Ordnung,
Wiederauffindbarkeit – und er löst sie mit Mitteln, die eine CSP-gesperrte
Electron-App auch hat: Linien, Spalten, Schriftschnitte, Ziffernbreiten.
Nebenbei ist es die einzige Formensprache in dieser Liste, die kein
KI-Bildgenerator und kein SaaS-Template von selbst produziert.

Konkret geerbt vom Kursbuch:

| Vorbild | Umsetzung in Tagwerk |
| --- | --- |
| Zeilen, keine Karten | Aufgaben sind 32 px hohe Zeilen mit Haarlinie unten, `border-radius: 0`, kein Abstand dazwischen |
| Feste Spalten über die ganze Tafel | Status / Quelle / Titel / Marken sitzen in jeder Ansicht an derselben x-Position |
| Tabellenziffern | `font-variant-numeric: tabular-nums` global; Zahlenkolonnen fluchten |
| Randstriche für Fußnoten | Priorität ist ein Randstrich links, kein farbiges Etikett |
| Ein einziger Sonderdruck (rot) | Ein einziger Akzent (Petrol) plus zwei Signalfarben (Ocker, Rot) |
| Kein Bild auf der Seite | Keine Illustrationen, keine leeren Hero-Flächen, keine Verläufe |

---

## 1. Farbe

### 1.1 Wertetafel

Beide Themes sind gleichrangig gebaut, nicht voneinander abgeleitet. Alles ist
warm getönt (Farbton ca. 40–45° bei den Neutralen, 192° beim Akzent).

```css
:root {
  /* Flächen ---------------------------------------------------------- */
  --bg:            #F2F0EA;  /* Anwendungsfläche hinter allem            */
  --paper:         #FBFAF7;  /* Listen, Kopfzeile, Statuszeile, Dialoge  */
  --sunken:        #EDEBE4;  /* eingelassen: Eingabefond, Notizen,
                                Vorschau, Wochenendspalte                */
  --hover:         #F4F2EC;  /* Zeilen-Hover                             */

  /* Linien ----------------------------------------------------------- */
  --hairline:      #E2DFD6;  /* Zeilentrenner, Spaltenlinien             */
  --line:          #CFCBC0;  /* stärkere Trennung: unter Kopfzeile,
                                über Statuszeile, Dialogkanten           */
  --line-strong:   #8E897E;  /* Rahmen bedienbarer Elemente (3.34:1)     */

  /* Schrift ---------------------------------------------------------- */
  --ink:           #1C1A16;  /* Titel, Fließtext                         */
  --ink-2:         #56524A;  /* zweite Ebene: Meta, Beschriftungen       */
  --ink-3:         #726D63;  /* dritte Ebene: leise Angaben, Erledigtes  */
  --ink-4:         #8E897E;  /* NUR nicht-textliche Glyphen, deaktiviert */

  /* Akzent (jetzt / aktiv / Fokus / Auswahl) --------------------------- */
  --accent:        #0F5B6E;
  --accent-on:     #FBFAF7;  /* Schrift auf gefüllter Akzentfläche       */
  --accent-quiet:  #DEEAEE;  /* Fond: Auswahl, heute, Ablageziel         */

  /* Signale ----------------------------------------------------------- */
  --wait:          #7E5206;  /* Status „wartet“ (Ocker)                  */
  --wait-quiet:    #F0E7D5;
  --alert:         #A32B23;  /* Priorität hoch/dringend, Löschen, Fehler */
  --alert-quiet:   #F5E3DF;
}

[data-theme='dark'] {
  --bg:            #151412;
  --paper:         #1C1B18;
  --sunken:        #232119;
  --hover:         #252320;

  --hairline:      #2E2C27;
  --line:          #423F38;
  --line-strong:   #736E65;  /* 3.40:1 gegen --paper                     */

  --ink:           #EDEAE3;
  --ink-2:         #B0AAA0;
  --ink-3:         #928D82;
  --ink-4:         #736E65;

  --accent:        #5FB6C8;
  --accent-on:     #151412;
  --accent-quiet:  #17343C;

  --wait:          #D69A3C;
  --wait-quiet:    #33291A;
  --alert:         #E2796B;
  --alert-quiet:   #37211E;
}
```

### 1.2 Kontraste (gemessen, WCAG 2.1)

Weil die Grundschriftgröße mit 13 px klein ist, liegt die Meßlatte für Textfarben
bei **AA (4.5:1) als Minimum** und **AAA (7:1) für alles, was man liest statt
überfliegt**. Alle Werte gegen `--paper`:

| Rolle | hell | Ratio | dunkel | Ratio | Anforderung |
| --- | --- | --- | --- | --- | --- |
| `--ink` | `#1C1A16` | **16.65** | `#EDEAE3` | **14.34** | AAA ✔ |
| `--ink-2` | `#56524A` | **7.45** | `#B0AAA0` | **7.47** | AAA ✔ |
| `--ink-3` | `#726D63` | **4.93** | `#928D82` | **5.21** | AA ✔ |
| `--ink-4` | `#8E897E` | 3.34 | `#736E65` | 3.40 | nur Nicht-Text (1.4.11 ✔) |
| `--accent` | `#0F5B6E` | **7.34** | `#5FB6C8` | **7.39** | AAA ✔ |
| `--wait` | `#7E5206` | **6.50** | `#D69A3C` | **7.01** | AAA ✔ |
| `--alert` | `#A32B23` | **6.87** | `#E2796B` | **5.89** | AA ✔ |
| `--line-strong` | `#8E897E` | 3.34 | `#736E65` | 3.40 | Bedienelement-Rahmen ✔ |
| `--accent-on` auf `--accent` | `#FBFAF7` | **7.34** | `#151412` | **7.90** | AAA ✔ |

Auf `--sunken` (hell): `--ink` 14.56 · `--ink-2` 6.52 · `--accent` 6.42 ·
`--wait` 5.68 · `--alert` 6.01.
Auf `--accent-quiet`: `--ink` 14.16 (hell) / 10.97 (dunkel), `--accent` 6.24 / 5.66.

**Zwei harte Regeln:**

- `--ink-3` erreicht auf `--sunken` (hell) nur 4.31:1. **Auf `--sunken` ist
  `--ink-3` verboten**; dort gilt `--ink-2`. (Betrifft Notizfeld, Export-Vorschau,
  Wochenendspalte.)
- `--ink-4` transportiert **nie** Information. Es ist die Farbe des leeren
  Status-Rings, deaktivierter Knöpfe und des Ziehgriffs – nie die Farbe eines
  Wortes, das man lesen muß.

### 1.3 Wofür Farbe *nicht* zuständig ist

Farbe ist in Tagwerk **Verstärkung, nie Träger** (WCAG 1.4.1). Jeder Zustand hat
eine zweite, farbunabhängige Kodierung:

| Zustand | Form (trägt) | Farbe (verstärkt) | Text (barrierefrei) |
| --- | --- | --- | --- |
| offen | leerer Ring | `--ink-4` | `aria-label="Offen"` |
| in Arbeit | Ring, linke Hälfte gefüllt | `--accent` | `aria-label="In Arbeit"` |
| wartet | Ring mit zwei senkrechten Balken | `--wait` | `aria-label="Wartet"` |
| erledigt | **gefüllte** Scheibe mit Haken, Titel durchgestrichen | `--ink-3` | `aria-label="Erledigt"` |
| Priorität hoch | Randstrich links **2 px** + Marke `!` | `--alert` | Titel-Attribut „Priorität: Hoch“ |
| Priorität dringend | Randstrich links **3 px** + Marke `!!` + Titel in 600 | `--alert` | Titel-Attribut „Priorität: Dringend“ |
| heute | Wort „heute“ als Versalienlabel + 2 px Unterstrich der Spalte | `--accent` | – |
| ausgewählt (`x`) | Fond `--accent-quiet` + Haken im Bundsteg | `--accent` | `aria-selected` |
| Tastaturfokus | 2 px Kontur innen | `--accent` | – |

Der Unterschied „hoch“ / „dringend“ läuft bewußt **nicht** über zwei Farbtöne,
sondern über Strichstärke und Zeichen. Zwei Rottöne nebeneinander sind bei 13 px
nicht unterscheidbar; 2 px gegen 3 px und `!` gegen `!!` sind es.

### 1.4 Warum kein Grün

Ein Häkchen in Grün ist die reflexhafte Lösung – und sie ist in einer dichten
Liste falsch. Erledigte Aufgaben sind das, was man *nicht* mehr sehen muß. Grün
ist eine der auffälligsten Farben im Interface und zieht die Aufmerksamkeit
genau dahin, wo nichts mehr zu tun ist. Erledigtes bekommt deshalb Graphit
(`--ink-3`), Durchstreichung und eine gefüllte (also formal starke, farblich
leise) Scheibe. Der Fortschrittsbalken im Tageskopf wird aus demselben Grund in
`--ink-2` gefüllt, nicht in Grün.

Nebeneffekt: ohne Grün bleibt die Palette bei vier Farbfamilien (Tinte, Petrol,
Ocker, Rot), und die Rot/Grün-Falle für Farbfehlsichtige entsteht gar nicht erst.

---

## 2. Typografie

### 2.1 Schriftstapel

Keine externen Schriften. Die Handschrift entsteht aus **optischen Größen** –
Segoe UI Variable liefert drei optisch gezeichnete Schnitte (`Small`, `Text`,
`Display`), und wir benutzen alle drei. Das ist der Kunstgriff: die
Windows-Systemschrift, aber richtig eingesetzt, sieht nicht aus wie
Windows-Standard.

```css
:root {
  /* Fließtext, Zeilen, Bedienelemente (11–17 px) */
  --font-text:    'Segoe UI Variable Text', 'Segoe UI', -apple-system,
                  BlinkMacSystemFont, system-ui, 'Noto Sans', 'Liberation Sans',
                  Arial, sans-serif;

  /* Überschriften ab 18 px – engere Punzen, größere Wirkung */
  --font-display: 'Segoe UI Variable Display', 'Segoe UI Variable Text',
                  'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui,
                  'Noto Sans', 'Liberation Sans', Arial, sans-serif;

  /* Kleinstschrift ≤ 11 px – offenere Punzen, hält bei 100 % DPI zusammen */
  --font-small:   'Segoe UI Variable Small', 'Segoe UI Variable Text',
                  'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui,
                  'Noto Sans', 'Liberation Sans', Arial, sans-serif;

  /* Maschinenschrift: Referenzen, Tastenkappen, Pfade, Vorschauen */
  --font-mono:    'Cascadia Mono', Consolas, ui-monospace, 'SF Mono',
                  'DejaVu Sans Mono', 'Liberation Mono', monospace;
}

body {
  font-family: var(--font-text);
  font-size: 13px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;   /* Kursbuch-Regel, gilt überall */
}
```

Auf macOS greift `-apple-system` (SF Text/Display), auf Linux `system-ui`
(Cantarell/Ubuntu/Noto). Beide bringen ihre eigenen optischen Größen mit; die
Skala unten funktioniert dort unverändert.

**`-webkit-font-smoothing: antialiased` wird entfernt.** Es hat auf Windows keine
Wirkung und macht Text auf macOS dünner und schwächer – ein typischer
Web-Tick, der eine Anwendung sofort nach Website aussehen läßt.

### 2.2 Skala

| Stufe | Größe / Zeilenhöhe | Schnitt | Laufweite | Familie | Wofür |
| --- | --- | --- | --- | --- | --- |
| `t-day` | 20 / 24 px | 600 | −0.01em | display | Tagesüberschrift („Montag, 17. August“) |
| `t-dialog` | 16 / 22 px | 600 | −0.005em | display | Dialogtitel |
| `t-input` | 15 / 20 px | 400 | 0 | text | Erfassungszeile im Hauptfenster |
| `t-quick` | 17 / 22 px | 400 | 0 | text | Eingabe im Schnellerfassungsfenster |
| `t-body` | **13 / 18 px** | 400 | 0 | text | **Grundgröße**: Aufgabentitel, Knöpfe, Felder, Menüs |
| `t-body-em` | 13 / 18 px | 600 | 0 | text | Titel dringender Aufgaben, Wochentagsname |
| `t-meta` | 12 / 16 px | 400 | 0 | text | Metazeile, Filterbeschriftungen, Datumsangaben |
| `t-micro` | 11 / 14 px | 500 | 0 | small | Zähler, Marken, Statuszeile |
| `t-label` | 10.5 / 12 px | 600 | +0.08em, Versalien | small | **genau zwei Orte**: Gruppenüberschriften in der Tagesliste, Gruppenüberschriften im Dialog |
| `t-mono` | 11.5 / 16 px | 400 | 0 | mono | Referenzen (`INC0012345`), Tastenkappen, Pfade, Export-Vorschau |

Mehr Stufen gibt es nicht. Wer eine elfte braucht, hat das Layout falsch gebaut.

### 2.3 Regeln zur Hierarchie

- **Hierarchie entsteht aus Größe, Farbwert und Position – nicht aus Farbe.**
  Ein Aufgabentitel ist `--ink` 13/400, seine Metazeile `--ink-3` 12/400. Der
  Unterschied ist deutlich, ohne daß ein einziger Buntton beteiligt ist.
- **Fett ist Mangelware.** 600 kommt vor bei: Tagesüberschrift, Dialogtitel,
  Wochentagsnamen, Zählern, Versalienlabels und Titeln dringender Aufgaben. Sonst
  nirgends. Insbesondere sind normale Knöpfe 400, nicht 500 oder 600.
- **Kursiv gibt es nicht.** Segoe UI hat keinen echten Kursivschnitt; der
  synthetische ist häßlich. Betonung im Fließtext läuft über `--ink` gegen
  `--ink-2`.
- **Versalien nur an den zwei genannten Stellen.** Durchgängige Versalien-Labels
  („OVERVIEW“, „ACTIONS“) sind ein Template-Tick.
- **Beim letzten Buchstaben eines gesperrten Versalienlabels wird die Laufweite
  zurückgenommen:** `letter-spacing: .08em; margin-right: -.08em;` – sonst
  fluchtet die rechte Kante nicht.
- **Zahlen sind immer tabellarisch.** Zähler, Datumsangaben, Uhrzeiten und die
  KW-Angabe stehen in Kolonnen, die beim Umschalten der Tage nicht springen.
- **Kein `text-transform` auf Benutzertext.** Aufgabentitel bleiben so, wie der
  Benutzer sie getippt hat.

### 2.4 Sprache in der Oberfläche

Nüchternes Bürodeutsch, keine Werbesprache, keine Ausrufezeichen, keine Anrede
in der zweiten Person Plural.

| statt | schreiben wir |
| --- | --- |
| „Super, gespeichert! 🎉“ | „Gespeichert“ |
| „Los geht's – leg deine erste Aufgabe an!“ | „Noch nichts erfaßt. Strg + N für die Erfassungszeile.“ |
| „Oops, da ist etwas schiefgelaufen“ | „Datei konnte nicht geschrieben werden.“ |
| „3 Tasks“ | „3 offen · 12 erledigt“ |

---

## 3. Raster und Dichte

### 3.1 Abstandsskala

Grundeinheit 4 px, mit den Halbschritten 2 und 6, weil eine dichte Liste sie
braucht. **Andere Werte kommen nicht vor.**

```css
--sp-1:  2px;   --sp-2:  4px;   --sp-3:  6px;   --sp-4:  8px;
--sp-5: 12px;   --sp-6: 16px;   --sp-7: 20px;   --sp-8: 24px;   --sp-9: 32px;
```

Innenabstände über 16 px gibt es nur in Dialogen. Eine Liste mit 24 px Padding
ist eine Liste, in die zu wenig paßt.

### 3.2 Höhen der festen Zonen

| Zone | Höhe | Innenabstand | Trennung nach unten |
| --- | --- | --- | --- |
| Kopfzeile | 44 px | `0 16px`, Lücke 8 px | 1 px `--line` |
| Erfassungszeile | 54 px | `10px 16px` | keine |
| Filterzeile | 34 px | `0 16px`, Lücke 8 px | 1 px `--hairline` |
| Ansichtsbereich | Rest (`1fr`) | `12px 16px 24px` | – |
| Statuszeile | 24 px | `0 16px`, Lücke 12 px | 1 px `--line` nach oben |

Feste Zonen zusammen: **156 px**.

### 3.3 Die Aufgabenzeile — das wichtigste Maß der App

**Eine Aufgabe belegt genau 32 px.** Kein Außenabstand, kein Radius, kein
Schatten; getrennt wird durch eine Haarlinie an der Unterkante.

```
0        8              32      40      56                                    x
├─┬──────┬──────────────┬───┬───┬───────┬─────────────────────────┬───────────┤
│ │      │  Status 24²  │   │Q  │       │ Titel …                 │ Marken   ⋮│
└─┴──────┴──────────────┴───┴───┴───────┴─────────────────────────┴───────────┘
 └ Randstrich Priorität (0/2/3 px)      └ Textkante = 64 px
```

| Spalte | x | Breite | Inhalt |
| --- | --- | --- | --- |
| Randstrich | 0 | 0 / 2 / 3 px | Priorität normal / hoch / dringend |
| Bundsteg | 0–8 | 8 px | – |
| Status | 8–32 | 24 px | Statusknopf, Glyph 16 px optisch zentriert |
| Lücke | 32–40 | 8 px | – |
| Quelle | 40–56 | 16 px | Quellen-Icon (`title` = Klarname) |
| Lücke | 56–64 | 8 px | – |
| **Titel** | **64 →** | flexibel | einzeilig, `text-overflow: ellipsis` |
| Marken | rechts | Inhalt | `!!` · `#tag` · `INC0012345` · Uhrzeit |
| Aktionen | rechts | 3 × 24 px | erst bei Hover/Fokus sichtbar, überlagern die Marken |

Weitere Festlegungen:

- Die **Textkante 64 px** gilt in der ganzen App: der aufgeklappte Detailbereich,
  der Editor und die Notizen fluchten mit dem Titel.
- Die **Liegengebliebenes-Liste** benutzt dieselben Spalten; ihre Datumsspalte
  (48 px, tabellarisch) sitzt *links vor* dem Randstrich, nicht dazwischen.
- **Kein `gap` zwischen Zeilen.** Die Haarlinie ist der Abstand. Genau daraus
  entsteht der Tafel-Eindruck.
- **Aktionen erscheinen ohne Bewegung** (`opacity` 0 → 1 in 0 ms, siehe §6). Ein
  Ein- und Ausblenden bei jeder Mausbewegung über eine 40-Zeilen-Liste ist Unruhe.
- Zeilen bekommen `content-visibility: auto` erst ab 200 Einträgen; darunter
  lohnt es nicht.

### 3.4 Dichteziele (verbindlich abzunehmen)

Bei Fensterbreite 1100 px und der Schrift-Grundeinstellung:

| Fensterhöhe | rechnerisch sichtbar | Abnahmekriterium |
| --- | --- | --- |
| 768 px | (768 − 156 − 74) / 32 = 16.8 | **≥ 16 Aufgaben ohne Scrollen** |
| 900 px | 20.9 | **≥ 20 Aufgaben** |
| 1040 px (1080p maximiert) | 25.3 | **≥ 25 Aufgaben** |

(74 px = 12 px Ansichtsrand + 40 px Tageskopf + 22 px Gruppenüberschrift.)

Zum Vergleich: der bisherige Zustand (Karte 40 px + 6 px Lücke = 46 px) zeigt bei
768 px nur 11 Aufgaben. Die Umstellung bringt **rund 45 % mehr Zeilen pro Bild**.
Wer eine Änderung vorschlägt, die diese Zahlen verschlechtert, muß sie gegen
diese Tabelle verteidigen.

### 3.5 Tageskopf

40 px hoch, dreiteilig in einer Zeile:

```
Montag, 17. August              KW 34        │  ▬▬▬▬▬▬▬▬▭▭▭  12 offen · 9 erledigt
t-day / --ink                t-micro/--ink-3 │  Balken 72×3   t-meta / --ink-2
```

- Der Fortschrittsbalken ist **72 × 3 px**, `border-radius: 0`, Spur `--hairline`,
  Füllung `--ink-2`. Ein 6 px hoher, abgerundeter Balken in Grün ist genau das
  Dashboard-Element, das wir nicht wollen.
- Steht man nicht auf heute, tritt hinter das Datum ein Versalienlabel `HEUTE`
  in `--accent` mit Sprungfunktion; das Datum selbst bleibt schwarz.

### 3.6 Gruppenüberschriften in der Tagesliste

22 px hoch, `t-label`, `--ink-3`, linksbündig auf **x = 8 px** (nicht auf 64 px –
sie gehören zur Tafel, nicht zur Titelspalte), rechts daneben die Anzahl in
`t-micro` `--ink-4`, dazwischen eine Haarlinie, die die Restbreite füllt:

```
OFFEN ───────────────────────────────────────────────────────── 12
```

Die durchlaufende Linie ist der klassische Kursbuch-Zwischentitel und ersetzt
jede Form von farbiger Kopfleiste.

### 3.7 Wochenansicht

Eine Tafel, kein Kartenraster.

- Spalten in einem Grid mit **`gap: 0`**; getrennt durch **1 px `--hairline` als
  linke Kante** jeder Spalte außer der ersten. Kein Rahmen um die Spalte, kein
  Radius, kein Schatten.
- Spaltenkopf 32 px: Wochentag `t-body-em` `--ink`, Datum `t-meta` `--ink-3`,
  rechts die Zähler (`t-micro`, offen in `--ink-2`, erledigt in `--ink-4`, durch
  ein schmales Mittelpunkt-Zeichen getrennt). Untere Kante 1 px `--line`.
- **Heute**: der Spaltenkopf bekommt einen 2 px starken Unterstrich in
  `--accent` (statt Rahmen ringsum) und das Datum steht in `--accent`.
- **Wochenende**: Spaltenfläche `--sunken`. Keine andere Kennzeichnung.
- Minizeile: **26 px** bei einzeiligem Titel, max. 2 Zeilen (`-webkit-line-clamp:
  2`), Innenabstand `4px 6px`, Trennung durch Haarlinie, Statusglyph 12 px,
  Randstrich Priorität wie in der Tagesliste. Kein Quellen-Icon (Platz).
- Ablageziel beim Ziehen: Spaltenfläche `--accent-quiet`, dazu eine **2 px starke
  Einfügemarke in `--accent`** an der Zielposition. Keine gestrichelte Kontur.
- Die „+“-Zeile am Spaltenfuß ist 24 px hoch, `--ink-4`, oberhalb 1 px
  `--hairline`; sie fluchtet in allen Spalten (Grid `align-items: stretch`).

Mindestbreiten: bei 760 px Fensterbreite und 7 Spalten bleiben je 105 px – die
Minizeile bricht dann auf 2 Zeilen um, das ist eingeplant und zulässig.

---

## 4. Linien, Radien, Schatten, Fokus

### 4.1 Haarlinien

```css
:root { --hairline-w: 1px; }
@media (min-resolution: 2dppx) { :root { --hairline-w: 0.5px; } }
```

Alle Zeilentrenner, Spaltenkanten und Tabellenlinien benutzen
`var(--hairline-w) solid var(--hairline)`. Auf HiDPI-Geräten (Surface, MacBook,
4K) wird die Linie damit tatsächlich ein Gerätepixel dünn – das ist der
sichtbarste Unterschied zwischen „gezeichnet“ und „zusammengeklickt“. Bei 100 %
DPI bleibt es bei 1 px.

Rahmen bedienbarer Elemente (Eingabefelder, Knöpfe mit Kontur, Kontrollkästchen)
sind **immer volle 1 px in `--line-strong`** – dort gilt WCAG 1.4.11, und
0.5 px in einem schwachen Ton wäre nicht mehr wahrnehmbar.

### 4.2 Radien

```css
--r-0: 0;    /* Aufgabenzeilen, Wochenspalten, Gruppenköpfe, Kopf-/Statuszeile,
                Tabellen, Fortschrittsbalken, Marken                        */
--r-1: 3px;  /* Eingabefelder, Knöpfe, Segmentschalter, Auswahlfond         */
--r-2: 6px;  /* Dialoge, Toasts, Vorschlagsliste                            */
--r-3: 8px;  /* nur das randlose Schnellerfassungsfenster                   */
```

**`border-radius: 999px` kommt in dieser App nicht vor.** Keine Pillen, keine
runden Etiketten, keine Kapselzähler. Der einzige Kreis in der Oberfläche ist der
Statusglyph, und der ist ein Kreis, weil er einen Zustand zeigt, nicht weil er
hübsch ist.

### 4.3 Schatten

**Regel: Ein Schatten bedeutet, daß etwas über der Seite schwebt. Was im Fluß
liegt, hat keinen.** Damit entfallen sämtliche Schatten an Aufgabenzeilen,
Eingabefeldern, Wochenspalten, Knöpfen, Tabs und der Kopfzeile.

```css
:root {
  /* schwebend, klein: Vorschlagsliste, Kontextmenü */
  --shadow-pop:
    0 1px 2px rgba(28, 26, 22, .10),
    0 6px 16px -4px rgba(28, 26, 22, .14);
  /* schwebend, groß: Dialoge, Toasts, Schnellerfassung */
  --shadow-float:
    0 2px 4px rgba(28, 26, 22, .10),
    0 12px 32px -8px rgba(28, 26, 22, .20),
    0 28px 64px -28px rgba(28, 26, 22, .18);
}
[data-theme='dark'] {
  --shadow-pop:
    0 1px 2px rgba(0, 0, 0, .40),
    0 6px 16px -4px rgba(0, 0, 0, .45);
  --shadow-float:
    0 2px 4px rgba(0, 0, 0, .45),
    0 16px 40px -8px rgba(0, 0, 0, .55),
    0 32px 72px -28px rgba(0, 0, 0, .50);
}
```

Drei Ebenen: eine enge Kontaktkante (1–2 px, kaum unschärfer als der Rand), eine
mittlere Streuung mit negativer Ausdehnung, und ein weiter, sehr weicher
Bodenschatten. Alle Schatten sind **achsentreu (kein x-Versatz)** und benutzen
denselben warmen Tintenton wie die Schrift – keine farbigen, keine bunten, keine
„glow“-Schatten.

Im dunklen Theme trägt Schatten allein zu wenig: schwebende Flächen bekommen
zusätzlich `border: 1px solid var(--line)`.

### 4.4 Fokus und Auswahl

- **Nur `:focus-visible`**, nie `:focus`. Ein Mausklick auf einen Knopf hinterläßt
  keinen Ring.
- Knöpfe, Felder, Links: `outline: 2px solid var(--accent); outline-offset: 1px;`
- **Aufgabenzeilen** (Tastatur-Cursor): `outline: 2px solid var(--accent);
  outline-offset: -2px;` – innen gezeichnet, damit die Zeile ihre Höhe behält und
  der Ring nicht in die Nachbarzeile schneidet. Zusätzlich Fond `--hover`.
- **Ausgewählt** (`x`, Mehrfachauswahl): Fond `--accent-quiet` und ein Haken
  (12 px, `--accent`) im Bundsteg, der den Statusglyph nicht ersetzt, sondern
  links davon in den 8-px-Steg rückt (der Steg wächst dafür auf 20 px, die
  restlichen Spalten wandern mit — die Verschiebung ist gewollt und macht die
  Auswahl auch ohne Farbe erkennbar).
- Fokus **und** Auswahl gleichzeitig: Fond `--accent-quiet`, Ring wie oben.
- Fokusfarbe hat 7.34:1 gegen `--paper` und erfüllt 1.4.11 mit großem Abstand.

---

## 5. Komponenten

### 5.1 Kopfzeile

Wortmarke links, danach Ansichtsumschalter, Datumsnavigation, Suchfeld, rechts
die Werkzeugknöpfe.

- **Die Wortmarke ist Text**, nicht ein farbiges Quadrat mit einem Buchstaben
  darin. „Tagwerk“ in `t-body-em`, `--ink`, `letter-spacing: -.005em`. Links davor
  eine 12 × 12 px große Marke aus **drei waagerechten Strichen** (11, 7 und 9 px
  breit, 1.5 px stark, in `--accent`) – ein abstrahierter Fahrplaneintrag. Das
  ist das einzige „Logo“ und es ist eine Zeichnung, kein Kasten.
- Ansichtsumschalter: Segmentschalter, 26 px hoch, `--r-1` außen, Segmente
  `0 12px`, Trennung durch 1 px `--hairline`, aktives Segment: Fond `--paper`,
  Text `--ink`, **1 px `--line` ringsum** – kein Schatten, keine Akzentfüllung.
- Datumsnavigation: zwei 26 × 26 px Knöpfe mit Chevron, dazwischen das Datum in
  `t-meta` `--ink-2`, tabellarisch, feste Breite (kein Springen beim Blättern).
- Suchfeld: 26 px hoch, Fond `--sunken`, 1 px `--line-strong`, Lupensymbol links
  bei x = 8 in `--ink-4`, Textbeginn bei x = 28. Breite 200 px, ab 900 px
  Fensterbreite 140 px.
- Werkzeugknöpfe: 26 × 26 px, nur Icon, `title` + `aria-label` gesetzt.

### 5.2 Erfassungszeile

- Eingabefeld: volle Breite minus Knopf, **34 px hoch**, `t-input`, Fond
  `--paper`, 1 px `--line-strong`, `--r-1`, kein Schatten.
- Fokus: `border-color: var(--accent)` **plus** `outline: 2px solid var(--accent);
  outline-offset: 1px`. Kein weicher 3-px-Halo (`box-shadow: 0 0 0 3px …`) –
  das ist der Bootstrap/Tailwind-Fokus und sofort erkennbar.
- **Die Erkennungsvorschau ist eine Textzeile, keine Chips.** Direkt unter dem
  Feld, 20 px hoch, `t-meta`:

  ```
  Teams · #netzwerk · dringend · Mo 24.08.        ⌐ nicht erkannt: „>1000“
  ```

  Sicher Erkanntes in `--ink-2`, Geratenes/Unsicheres in `--ink-3` mit
  gepunkteter Unterstreichung (`text-decoration: underline dotted`), Trennung
  durch ` · `. Anklickbare Teile bekommen bei Hover `--alert` und eine
  Durchstreichung (= „entfernt beim Klick“). Der bisherige Chip-Streifen
  (abgerundete, farbig gefüllte Kapseln) entfällt vollständig.
- Vorschlagsliste für `@quelle`/`#tag`: über dem Feld schwebend, `--r-2`,
  `--shadow-pop`, Zeilen 24 px, Treffer-Teilstring in `t-body-em`.

### 5.3 Filterzeile

Alles in einer 34-px-Zeile, linksbündig, `t-meta`. Aktive Filter erscheinen als
Text mit einem 12-px-Kreuz dahinter (`--ink-3`, bei Hover `--alert`), nicht als
farbige Kapseln. Rechts der Hinweis „Strg + Umschalt + F setzt alles zurück“ in
`--ink-4`, der ausgeblendet wird, sobald kein Filter aktiv ist.

### 5.4 Aufgabenzeile aufgeklappt

Höhe wächst; der Detailbereich beginnt bei x = 64 px, Innenabstand
`6px 16px 10px 0`, Trennung nach oben: keine (die Zeile bleibt eine Einheit),
nach unten die übliche Haarlinie.

- Notizen: Fond `--sunken`, `--r-1`, `t-body`, `--ink-2` (**nicht** `--ink-3`,
  siehe §1.2), `white-space: pre-wrap`.
- Metazeile: `t-meta`, `--ink-3`, Angaben durch ` · ` getrennt: Quelle im
  Klartext, Erfaßt-Zeit, ggf. Erledigt-Zeit, Referenz in `t-mono`.
- Editor: Felder in einem Raster mit `minmax(140px, 1fr)`, Beschriftungen in
  `t-micro` `--ink-3` über dem Feld, Feldhöhe 26 px.

### 5.5 Dialoge

- Breite `min(560px, calc(100vw - 48px))`, `--r-2`, `--shadow-float`, 1 px
  `--line`.
- Hintergrund: `rgba(21, 20, 18, .40)` (hell) bzw. `rgba(0, 0, 0, .55)` (dunkel).
  **Kein `backdrop-filter: blur()`** – Weichzeichner hinter Dialogen ist teuer,
  auf Windows fleckig und einer der deutlichsten „modern generiert“-Marker.
- Kopf 44 px, Titel `t-dialog`, Schließen-Knopf 24 × 24 px, darunter 1 px `--line`.
- Inhalt: Gruppen durch `t-label`-Überschrift + Haarlinie getrennt (wie §3.6),
  Innenabstand `16px`.
- Fußzeile rechtsbündig, 16 px Innenabstand, Hauptaktion rechts außen.

### 5.6 Knöpfe

| Art | Fläche | Rahmen | Schrift | Höhe / Innenabstand |
| --- | --- | --- | --- | --- |
| Standard | `--paper` | 1 px `--line-strong` | `--ink`, 400 | 26 px / `0 12px` |
| Hauptaktion | `--accent` | 1 px `--accent` | `--accent-on`, 400 | 26 px / `0 14px` |
| Still | transparent | keiner | `--ink-2`, 400 | 26 px / `0 10px` |
| Gefährlich | transparent | keiner | `--alert`, 400 | 26 px / `0 10px` |
| Nur Icon | transparent | keiner | `--ink-2` | 26 × 26 px |

- Hover: Fläche `--hover` (Standard/still) bzw. Helligkeit ±6 % über eine
  zweite, ausformulierte Farbe – **kein `filter: brightness()`**, das verfärbt im
  dunklen Theme.
- Hover verschiebt nichts: **kein `transform: translateY(-1px)`, kein
  Hover-Schatten, keine Skalierung.**
- Knöpfe mit Icon + Text: Innenabstand links 8 px, rechts 12 px (optischer
  Ausgleich, das Icon trägt weniger Seitenweiß als ein Buchstabe).

### 5.7 Statuszeile

24 px, `t-micro`, `--ink-3`, linksbündig die Bestandszahlen, rechts der
Speicherzustand. Zahlen tabellarisch. Keine Icons, keine Farben außer bei einem
echten Fehler (`--alert`).

### 5.8 Toasts

Unten rechts, 16 px Abstand zum Rand, Breite max. 360 px, `--r-2`,
`--shadow-float`, 1 px `--line`, Innenabstand `10px 12px`, `t-body`.
Fehler: linke Kante 3 px `--alert` (Randstrich, wie bei der Priorität), Text
bleibt `--ink`. Aktionsknopf („Rückgängig“) als stiller Knopf in `--accent`.

### 5.9 Leerer Zustand

Ein Satz in `t-body` `--ink-3`, linksbündig auf der Textkante 64 px, 24 px unter
dem Tageskopf, darunter höchstens eine Zeile mit dem passenden Tastenkürzel in
`t-mono`. **Keine Illustration, kein großes Icon, kein zentrierter Block, kein
gerahmter Kasten.**

### 5.10 Schnellerfassungsfenster

Das einzige Element, das bewußt anders aussehen darf – es schwebt frei über
fremden Anwendungen und muß als eigenes Fenster lesbar sein.

- Fläche `--paper`, `--r-3` (8 px), 1 px `--line-strong`, `--shadow-float`,
  Fensterrand 8 px transparent (für den Schatten).
- Eine Zeile: links die 12-px-Marke aus §5.1 in `--accent`, dann das Eingabefeld
  `t-quick` ohne Rahmen und ohne Fond, Innenabstand `14px 16px`.
- Darunter die Hinweiszeile, 26 px, Fond `--sunken`, obere Haarlinie,
  `t-micro` `--ink-3`, einzeilig mit `text-overflow: ellipsis`.
- Rückmeldung: 3 px starke Kante **links** in `--accent` (gespeichert) bzw.
  `--alert` (Fehler) für 900 ms — nicht der ganze Rahmen, nicht die ganze Fläche.

---

## 6. Bewegung

Bewegung dient hier genau zwei Zwecken: sie zeigt, **wo etwas herkommt**
(Toast, Dialog), und sie macht **Zustandswechsel nachvollziehbar** (Status,
Aufklappen). Sie feiert nichts.

```css
:root {
  --ease-out:  cubic-bezier(.2, 0, 0, 1);      /* Eintritt, Zustandswechsel */
  --ease-in:   cubic-bezier(.4, 0, 1, 1);      /* Austritt                  */
  --d-fast:  120ms;
  --d-base:  160ms;
  --d-slow:  200ms;
}
```

| Anlaß | Dauer | Easing | Was sich ändert |
| --- | --- | --- | --- |
| Hover über Zeile, Knopf, Tab | **0 ms** | – | Fond springt sofort um |
| Fokusring erscheint | **0 ms** | – | `outline` |
| Aktionen in der Zeile erscheinen | **0 ms** | – | `opacity` 0 → 1 |
| Status umschalten | 120 ms | `--ease-out` | Glyph `opacity` 0→1 und `scale(.86)`→1; Farbe ohne Übergang |
| Titel wird durchgestrichen | 120 ms | `--ease-out` | `opacity` des Titels 1 → .6, Durchstreichung ohne Übergang |
| Zeile auf-/zuklappen | 160 ms | `--ease-out` | `height` (auf `auto` gemessen) + `opacity` des Inhalts |
| Dialog öffnen | 160 ms | `--ease-out` | `opacity` 0→1, `translateY(6px)`→0; Hintergrund `opacity` 0→1 |
| Dialog schließen | 120 ms | `--ease-in` | `opacity` 1→0 (keine Verschiebung) |
| Toast erscheinen | 160 ms | `--ease-out` | `opacity` 0→1, `translateY(8px)`→0 |
| Toast verschwinden | 120 ms | `--ease-in` | `opacity` 1→0, `translateY(0→4px)` |
| Vorschlagsliste | 120 ms | `--ease-out` | `opacity` 0→1, `translateY(4px)`→0 |
| Ablageziel markieren | 100 ms | `--ease-out` | `background` der Zielspalte/-liste |
| Fortschrittsbalken | 200 ms | `--ease-out` | `width` |
| Schnellerfassung: Rückmeldekante | 120 ms ein / 200 ms aus | `--ease-out` / `--ease-in` | `background-color` der 3-px-Kante |
| Tages- oder Wochenwechsel | **0 ms** | – | Inhalt wird ersetzt, **kein** Wischen, kein Überblenden |
| Ansichtswechsel Tag ↔ Woche | **0 ms** | – | dito |
| Ziehen einer Aufgabe | **0 ms** | – | folgt dem Zeiger; das gezogene Element `opacity: .45` |

Weitere Regeln:

- **Nichts über 200 ms.** Wer eine längere Dauer braucht, hat eine falsche
  Animation gewählt.
- **Keine Federn, kein Überschwingen, kein `bounce`, kein `cubic-bezier` mit
  Werten außerhalb 0…1.** Eine Aufgabenliste hüpft nicht.
- **Kein Einblenden beim ersten Rendern**, kein gestaffeltes Erscheinen von
  Listenzeilen („stagger“). Die Liste ist einfach da.
- Übergänge werden **auf benannten Eigenschaften** definiert (`transition:
  opacity 120ms var(--ease-out)`), nie `transition: all`.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

Der Endzustand bleibt in jedem Fall identisch: nichts wird ausgeblendet, nur
sofort erreicht. Ziehen und Ablegen funktioniert unverändert.

---

## 7. Icons

### 7.1 Warum die Emoji weg müssen

Die elf Quellen-Emoji sind derzeit der auffälligste „nicht selbst gestaltet“-Marker
der App, aus vier nachprüfbaren Gründen:

1. **Sie sind mehrfarbig.** In einer Oberfläche mit einem einzigen Akzent stehen
   elf bunte Bildchen wie Aufkleber auf einem Formular. Sie erben kein
   `currentColor`, ändern sich also weder im dunklen Theme noch beim Erledigen
   einer Aufgabe noch beim Fokus.
2. **Sie sehen auf jedem System anders aus.** Segoe UI Emoji, Apple Color Emoji
   und Noto Color Emoji zeichnen dieselben Zeichen völlig unterschiedlich; ✉️ und
   ⏸ hängen zusätzlich am Variationsselektor und kippen je nach Font zwischen
   Text- und Emoji-Darstellung.
3. **Sie haben eine andere Metrik.** Emoji sitzen auf einer eigenen Grundlinie
   und in eigenen Vorbreiten. In einer 32-px-Zeile mit fester Spaltenordnung
   springt dadurch jede Zeile leicht anders – genau das zerstört den Tafeleindruck.
4. **Sie sind nicht steuerbar.** Größe, Strichstärke, Optik lassen sich per CSS
   nicht angleichen; Vorlesewerkzeuge sprechen sie als Bildbeschreibung mitten im
   Satz vor.

**Ersatz:** einfarbige Inline-SVG, `stroke: currentColor`, die die Textfarbe der
Zeile erben und damit beim Erledigen automatisch mit verblassen.

**Wo Emoji bleiben** – dort sind sie richtig, weil unsere SVG dort nicht
existieren:

- **Markdown-, Text-, CSV-, JSON- und Standup-Export.** Der Zieltext läuft in
  fremden Programmen (Editor, Excel, Teams-Nachricht); ein Emoji ist dort die
  einzige Auszeichnung, die überall ankommt.
- **HTML-Export für Outlook.** Outlook rendert Inline-SVG nicht zuverlässig,
  externe Bilder sind gesperrt und die CSP verbietet Datenanhänge – das Emoji ist
  die einzige Möglichkeit, die Quelle sichtbar zu machen.
- **Anwendungs- und Infobereichssymbol** (`assets/*.png`) – das sind Bilddateien
  des Betriebssystems, kein Oberflächenelement.

Praktisch heißt das: das Feld `icon` in `Model.SOURCES` **bleibt unverändert
bestehen** und wird weiter vom Export benutzt; die Oberfläche greift es nicht
mehr ab, sondern holt sich das SVG über die Quellen-`id`.

### 7.2 Zeichenregeln

| Eigenschaft | Wert |
| --- | --- |
| Raster | `viewBox="0 0 16 16"`, Anzeigegröße 16 px (Wochenansicht 12 px) |
| Zeichenfläche | 14 × 14 px, also 1 px Luft ringsum |
| Strichstärke | `stroke-width="1.5"`, unverändert bei 12 px (wird optisch mitskaliert) |
| Enden / Ecken | `stroke-linecap="round"`, `stroke-linejoin="round"` |
| Füllung | `fill="none"` – **Ausnahme:** die Statusglyphen und der Auswahlhaken |
| Farbe | `stroke="currentColor"` bzw. `fill="currentColor"`; nie ein fester Wert |
| Zugänglichkeit | `aria-hidden="true"` am `<svg>`; die Bedeutung steht am umgebenden Knopf (`aria-label`) oder als `title` |
| Ecken | Rechtecke mit `rx="1.5"`; keine scharfen 90°-Ecken außer bei Diagonalkreuzen |

Ein Icon steht in der Aufgabenzeile **nie allein als einzige Information**: die
Quelle hat zusätzlich ein `title`-Attribut mit dem Klarnamen und erscheint
ausgeschrieben, sobald die Zeile aufgeklappt ist oder nach Quelle gruppiert wird.

### 7.3 Statusglyphen (16 px, teils gefüllt)

Diese vier sind die wichtigsten Zeichnungen der App. Sie werden über **Form**
unterschieden, damit sie ohne Farbe funktionieren.

| Status | Zeichnung |
| --- | --- |
| **offen** | Ring: Kreis um (8, 8), Radius 5.5, Strich 1.5, `--ink-4`. Sonst nichts. |
| **in Arbeit** | Derselbe Ring in `--accent`, dazu eine **gefüllte linke Halbscheibe** (Radius 3.5, senkrechte Kante bei x = 8) in `--accent` – wie eine zur Hälfte gelaufene Uhr. |
| **wartet** | Derselbe Ring in `--wait`, darin **zwei senkrechte Balken** (je 1.5 × 5 px, bei x = 6.25 und x = 9.75, abgerundet) in `--wait` – das Pausenzeichen. |
| **erledigt** | **Gefüllte Scheibe**, Radius 5.5, in `--ink-3`; darin ein Haken in `--paper`: Strich von (5.4, 8.2) über (7.1, 10) nach (10.8, 6.2), Strich 1.5. |

Die Trefferfläche des Knopfes ist 24 × 24 px (die Spalte), der Glyph 16 px
optisch mittig. Bei Hover: Ring `--accent`, Cursor `pointer`, `title` nennt den
*nächsten* Status („Weiter zu: In Arbeit“).

### 7.4 Quellen (11 Icons)

Jedes in einem Satz beschrieben, so daß es direkt zeichenbar ist. Alle auf
16 × 16, Strich 1.5, wenn nicht anders gesagt.

| id | Icon | Zeichnung |
| --- | --- | --- |
| `teams` | Sprechblase | Abgerundetes Rechteck von (2, 2.5) bis (14, 11) mit einer dreieckigen Spitze, die von (5, 11) nach (4, 14) und (8, 11) läuft; darin zwei Punkte (r = 0.75) bei (6.2, 6.7) und (9.8, 6.7). |
| `mail` | Umschlag | Rechteck (2, 3.5)–(14, 12.5); dazu zwei Geraden von (2, 4.5) und (14, 4.5) zur Mitte (8, 8.6) – die Klappe. |
| `ticket` | Ticket | Liegendes Rechteck (1.5, 4)–(14.5, 12) mit je einer halbrunden Einkerbung (r = 1.4) mittig in der linken und rechten Kante; senkrechte gestrichelte Perforation bei x = 6 (`stroke-dasharray="1.2 1.6"`). |
| `jira` | Vorgang | Auf die Spitze gestelltes Quadrat (Raute) mit den Ecken (8, 1.8), (14.2, 8), (8, 14.2), (1.8, 8); darin eine zweite, konzentrische Raute mit halbem Abstand. |
| `muendlich` | Zuruf | Halbkreis-Kopf (r = 2.2) über einem Schulterbogen links bei x = 5; rechts daneben zwei nach rechts geöffnete Bögen (r = 2.2 und 4, jeweils 90°) um (9, 8) – Schallwellen. |
| `telefon` | Hörer | Klassischer Handapparat: ein von (3.5, 4) nach (12.5, 12.5) durchhängender Bogen mit zwei quer stehenden, abgerundeten Enden (je 3.5 px, um 45° zur Bogenrichtung). |
| `meeting` | Kalenderblatt | Rechteck (2, 3)–(14, 14); waagerechte Linie bei y = 6.5; zwei senkrechte Ringe (1.5 px hoch) bei x = 5.3 und x = 10.7, die oben über die Kante ragen. |
| `vorort` | Stecknadel | Tropfen: Kreis (r = 3.4) um (8, 6.3), von dessen unteren Flanken zwei Linien in der Spitze (8, 14) zusammenlaufen; im Kreis ein Loch (r = 1.2). |
| `wiki` | Aufgeschlagenes Buch | Zwei nach außen gewölbte Seiten (Bögen von (1.8, 3.6) bzw. (14.2, 3.6) nach (8, 5.2) und weiter zu (1.8, 12.4) bzw. (14.2, 12.4)), die sich an einem senkrechten Falz bei x = 8 treffen. |
| `selbst` | Notizzettel | Rechteck (3, 2)–(13, 14) mit abgeschnittener unterer rechter Ecke (Schnitt von (13, 11) nach (10, 14), Knickkante als kurze Diagonale angedeutet); zwei kurze Textstriche bei y = 5.5 und y = 8. |
| `sonstiges` | Weiteres | Kreis (r = 6) um (8, 8) mit drei ausgefüllten Punkten (r = 0.85) bei x = 5.2, 8, 10.8 auf y = 8. |

### 7.5 Navigation und Aktionen

| Zweck | Zeichnung |
| --- | --- |
| zurück / vor | Chevron: zwei Linien, die sich rechtwinklig treffen; Spitze bei (5.5, 8) bzw. (10.5, 8), Schenkel je 4 px lang nach (10, 3.5)/(10, 12.5) bzw. (5.5, 3.5)/(5.5, 12.5). |
| aufklappen | Derselbe Chevron um 90° gedreht, Spitze nach unten bei (8, 10). |
| heute | Abgerundetes Quadrat (3, 3)–(13, 13) mit einem ausgefüllten Punkt (r = 1.8) in der Mitte. |
| suchen | Kreis (r = 4.5) um (6.8, 6.8), davon eine Gerade von (10.2, 10.2) nach (13.5, 13.5). |
| Schnellerfassung | Abgerundetes Quadrat (2.5, 2.5)–(13.5, 13.5) mit einem Plus darin: Striche von (8, 5.5) nach (8, 10.5) und (5.5, 8) nach (10.5, 8). |
| exportieren | Nach oben offenes U von (3, 9.5) über (3, 13.5) und (13, 13.5) nach (13, 9.5); darin ein Pfeil, der von (8, 11) nach (8, 2.5) zeigt, mit zwei Schenkeln nach (5.5, 5) und (10.5, 5). |
| Hilfe | Kreis (r = 6.2) um (8, 8); darin ein Fragezeichenbogen (von (6, 6.2) über (8, 4.8) nach (9.8, 6.6) und (8, 8.4) nach (8, 9.5)) sowie ein ausgefüllter Punkt (r = 0.8) bei (8, 11.8). |
| Einstellungen | Zwei waagerechte Reglerlinien bei y = 5.5 und y = 10.5 über die volle Breite (2 → 14), darauf je ein ausgefüllter Kreis (r = 1.8) bei x = 10.5 bzw. x = 5.5. **Kein Zahnrad** – Zähne werden bei 16 px zu Matsch. |
| schließen | Zwei Diagonalen: (4, 4)–(12, 12) und (12, 4)–(4, 12). |
| bearbeiten | Stift: ein um 45° gedrehtes, schmales Rechteck von (10.5, 2.5) bis (13.5, 5.5) am oberen Ende, dessen Körper bis (4, 12) läuft und dort in einer Spitze endet; Querlinie (Zwinge) 2 px unterhalb des Kopfes. |
| löschen | Papierkorb: waagerechter Deckelstrich (2.5, 4)–(13.5, 4), darüber ein 4 px breiter Griffbügel; darunter ein sich verjüngendes Trapez (3.8, 4)–(12.2, 4)–(11.3, 14)–(4.7, 14) mit zwei senkrechten Strichen bei x = 6.6 und x = 9.4. |
| weiterschieben | Pfeil nach rechts von (2.5, 8) nach (11, 8) mit Schenkeln nach (7.5, 4.5) und (7.5, 11.5), dazu eine senkrechte Anschlaglinie (13.5, 3)–(13.5, 13). |
| gruppieren / filtern | Drei waagerechte Linien untereinander bei y = 4, 8, 12, linksbündig ab x = 2.5, mit den Längen 11, 8 und 5 px. |
| Haken (Auswahl) | Gefüllter Strichzug von (3.5, 8.5) über (6.5, 11.5) nach (12.5, 4.5), Strich 1.5. |
| rückgängig | Kreisbogen (r = 5) um (8, 8.5) von 200° nach 20° (also oben offen, gegen den Uhrzeigersinn), mit Pfeilspitze am linken Ende: zwei Schenkel nach (3, 4.5) und (6.5, 4.2). |
| Warnung | Dreieck mit abgerundeten Ecken: (8, 2.5), (14.5, 13.5), (1.5, 13.5); darin ein senkrechter Strich (8, 6.5)–(8, 9.8) und ein ausgefüllter Punkt (r = 0.8) bei (8, 11.6). |
| Ordner öffnen | Rechteck (1.5, 4.5)–(14.5, 13); die obere Kante springt bei x = 6.5 um 2 px nach oben (Lasche) und läuft bis x = 1.5. |
| kopieren | Zwei gleich große abgerundete Rechtecke 9 × 9, das hintere bei (2, 2), das vordere bei (5, 5); vom hinteren sind nur die obere und die linke Kante gezeichnet. |
| Ziehgriff | Zwei waagerechte Striche, je 8 px lang, bei y = 6 und y = 10, ab x = 4. `--ink-4`, erscheint nur bei Hover. |

### 7.6 Optische Ausrichtung

- **Optische Mitte statt Kastenmitte.** Icons neben 13-px-Text werden um 0.5 px
  nach unten gesetzt (`transform: translateY(.5px)`); die x-Höhe der Schrift liegt
  unter der geometrischen Mitte des Icons.
- **Runde Formen werden größer gezeichnet als eckige.** Der Statusring hat
  r = 5.5 (Durchmesser 11), das Kalenderrechteck 12 × 11 – ein Kreis mit 11 px
  wirkt neben einem Quadrat mit 11 px kleiner.
- **Chevrons in quadratischen Knöpfen** werden 0.5 px **entgegen** der Spitze
  versetzt, weil die Spitze mehr optisches Gewicht trägt als die offene Seite.
- **Rechtsbündige Zahlen** brauchen 1 px mehr rechten Innenabstand als
  linksbündiger Text, weil Ziffern in tabellarischer Breite eigenes Seitenweiß
  mitbringen.
- **Der Haken im Erledigt-Glyph sitzt 0.3 px unter der Mitte** – ein optisch
  zentrierter Haken wirkt sonst zu hoch.

---

## 8. Verhalten ab 760 px Fensterbreite

Die Zonenhöhen ändern sich nie; nur Inhalte werden knapper.

| Schwelle | Was passiert |
| --- | --- |
| < 1000 px | Datumsangabe in der Kopfzeile kurz: „Mo 17.08.“ statt „Montag, 17. August 2026“ |
| < 900 px | Suchfeld 140 px statt 200 px; die Textbeschriftungen der Werkzeugknöpfe entfallen (Icon + `title` bleiben) |
| < 860 px | Filterzeile darf umbrechen (`flex-wrap: wrap`), die Zeile wächst dann auf 60 px; der Hinweistext rechts entfällt |
| < 820 px | In der Aufgabenzeile entfallen die Schlagwortmarken (bleiben im aufgeklappten Zustand sichtbar); Referenz und Priorität bleiben |
| ≤ 760 px | Wochenansicht mit 7 Spalten: Minizeilen ohne Statusglyph-Beschriftung, weiterhin max. 2 Textzeilen; Mindestspaltenbreite 96 px |

Getestet wird bei **760 × 640** (Untergrenze), **1100 × 768** und **1920 × 1040**.
Die Kopfzeile darf in keinem Fall umbrechen oder waagerecht scrollen.

---

## 9. Das machen wir NICHT

Jede Zeile ist ein in der Recherche belegtes Merkmal generischer, maschinell
erzeugter Oberflächen. Links das Merkmal, rechts unsere Festlegung.

| Nicht | Warum | Stattdessen |
| --- | --- | --- |
| **Indigo/Violett als Akzent** (`#6366F1`, `#5E6AD2`, Tailwind `indigo-500`) | Der bekannteste Marker überhaupt: Tailwind UI benutzte jahrelang `bg-indigo-500`, entsprechend überrepräsentiert ist es in Trainingsdaten. Adam Wathan hat sich 2025 öffentlich dafür entschuldigt. | Petrol `#0F5B6E` / `#5FB6C8` – dunkel, technisch, in deutschen Behörden- und Versorger-Auftritten zu Hause |
| **Verläufe** – „Blau nach Violett“, aber auch dezente Verläufe auf Knöpfen und Kopfleisten | Verlauf ohne Lichtquelle ist Dekoration; die Kombination Verlauf + große Radien + Inter ist *das* Erkennungsmerkmal generierter Seiten | Flächen sind einfarbig. Tiefe entsteht ausschließlich durch die Flächenleiter `--bg` → `--paper` → `--sunken` und Haarlinien |
| **Inter, Poppins, Space Grotesk, Geist** | Die vier Standardschriften generierter Oberflächen – und ohnehin durch die CSP ausgeschlossen | Segoe UI Variable mit allen drei optischen Größen; auf macOS/Linux die dortigen Systemschriften |
| **Große, überall gleiche Rundungen** (12–16 px an allem) | Gleichförmige Radien lassen jede Hierarchie einebnen; „alles ist eine Karte“ | Vier Radien mit klarer Zuständigkeit: 0 für Listen, 3 für Bedienelemente, 6 für Dialoge, 8 nur fürs Schnellfenster |
| **Pillen** (`border-radius: 999px`) für Etiketten, Zähler, Filter | Kapselform kostet 14 px Breite pro Etikett und macht aus jeder Zeile ein Konfettifeld | Marken sind Text: `#tag`, `INC0012345` in Maschinenschrift, `!!` |
| **Schatten an allem** | Ein Schatten ohne Höhenunterschied ist eine Behauptung; 40 Karten mit Schatten ergeben Matsch | Schatten nur bei tatsächlich schwebenden Ebenen (Dialog, Toast, Vorschlagsliste, Schnellfenster) – dreischichtiges Rezept, achsentreu |
| **Emoji als Symbole** | Mehrfarbig, plattformabhängig, nicht einfärbbar, eigene Metrik, schlecht vorgelesen | Einfarbige Inline-SVG auf 16-px-Raster mit `currentColor`; Emoji bleiben nur im Export |
| **Karten in Dreierreihen, mittige Anordnung von allem** | Der Landingpage-Reflex; für eine Arbeitsliste strukturell falsch | Alles linksbündig an einer von vier festen x-Positionen (0 / 8 / 40 / 64 px) |
| **Großzügiger Weißraum bei wenig Inhalt** (24–32 px Innenabstände in Listen) | Kaschiert fehlenden Inhalt; hier steht Inhalt im Weg | 32-px-Zeilen, `gap: 0`, Innenabstände ≤ 16 px; Abnahme gegen die Dichtetabelle in §3.4 |
| **Farbe als einziger Bedeutungsträger** (grün = fertig, rot = dringend) | WCAG 1.4.1; bei Rot-Grün-Schwäche unlesbar, im Ausdruck weg | Jeder Zustand hat Form **und** Text (§1.3) |
| **Grüne Häkchen und grüne Fortschrittsbalken** | Zieht Aufmerksamkeit auf das, was erledigt ist | Erledigtes in Graphit, durchgestrichen; Balken in `--ink-2` |
| **Glasmorphismus, `backdrop-filter: blur()`, farbige Schein-Effekte** | Teuer, auf Windows fleckig, rein modisch | Deckende Flächen, ein Halbton-Hintergrund hinter Dialogen |
| **Anheben beim Hover** (`translateY(-2px)`, Schattenwechsel) | In einer 40-Zeilen-Liste zappelt die halbe Seite | Hover ändert nur den Fond, ohne Übergangszeit |
| **Weicher Fokus-Halo** (`box-shadow: 0 0 0 3px rgba(accent,.2)`) | Der Standardfokus zweier Frameworks; zudem oft unter 3:1 | 2 px durchgezogene Kontur in `--accent`, nur `:focus-visible` |
| **Reines Weiß, reines Schwarz, neutrale Grautöne** (`#fff`, `#000`, `#808080`, Slate `#1E293B`) | Neutrale Graustufen wirken flach und beliebig; Slate-Blau ist selbst schon ein Framework-Fingerabdruck | Warm getönte Papier- und Tintenwerte, ein Farbton für alle Neutralen |
| **Illustrationen, Maskottchen, große Icons im leeren Zustand** | Dekoration ohne Funktion, und ohne externe Bilder ohnehin nicht baubar | Ein Satz Text plus Tastenkürzel |
| **Animierte Ansichtswechsel, „stagger“, Scroll-Effekte** | Kostet bei jedem Tageswechsel Zeit; im Alltag nach dem dritten Mal lästig | Ansichtswechsel ohne Bewegung; nur Zustandswechsel werden animiert (≤ 200 ms) |
| **Werbesprache und Ausrufezeichen in Meldungen** | „Super! 🎉“ paßt nicht in eine IT-Abteilung mit ServiceNow-Warteschlange | Sachmeldungen: „Gespeichert“, „3 offen“, „Datei konnte nicht geschrieben werden.“ |
| **Farbiges Quadrat mit einem Buchstaben als Logo** | Der generische SaaS-Markenreflex | Wortmarke „Tagwerk“ plus eine gezeichnete Drei-Strich-Marke |
| **`transition: all`, `filter: brightness()`** | Animiert unabsichtlich Layouteigenschaften; `brightness` verfälscht Farben im dunklen Theme | Benannte Eigenschaften, ausformulierte Hover-Farben |

---

## 10. Reihenfolge der Umsetzung

Für die sieben Agents, die danach arbeiten – in dieser Reihenfolge entsteht am
schnellsten ein stimmiges Bild:

1. **Merkmalsblock in `styles.css` ersetzen** (§1.1, §2.1, §3.1, §4.2, §4.3, §6):
   alle Variablen umbenennen und beide Themes setzen. Danach sieht die App sofort
   anders aus, auch ohne Strukturänderung.
2. **Aufgabenzeile auf 32 px und Haarlinien umbauen** (§3.3) – das ist der größte
   sichtbare und der größte funktionale Gewinn. Danach die Dichtetabelle §3.4
   nachmessen.
3. **Icon-Satz anlegen** (§7): eine Funktion, die aus einem Namen ein
   `<svg>`-Element baut; Statusglyphen zuerst, dann Quellen, dann Aktionen.
   `Model.SOURCES[].icon` unangetastet lassen.
4. **Chips und Pillen entfernen** (§5.2, §5.3, §3.3): Erkennungsvorschau,
   Filtermarken, Etiketten und Zähler auf Textform umstellen.
5. **Wochenansicht als Tafel** (§3.7).
6. **Dialoge, Toasts, Schnellerfassung** (§5.5, §5.8, §5.10).
7. **Bewegung und `prefers-reduced-motion`** (§6), zum Schluß die
   Kontrastabnahme gegen die Tabelle in §1.2 und die Breitenschwellen aus §8.

---

## 11. Quellen

Recherche vom 17.08.2026. Zu jeder Quelle steht, was daraus in diesen Leitfaden
eingegangen ist.

| Quelle | Übernommen |
| --- | --- |
| [Why Every AI-Built Website Looks the Same (Blame Tailwind's Indigo-500) – dev.to](https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p) | Der Indigo-Befund samt Ursache (Tailwind UI `bg-indigo-500`, Wathans öffentliche Entschuldigung 2025) → Ausschluß aller Indigo-/Violetttöne, §9 Zeile 1 |
| [Why Do Most AI-Generated Websites Look the Same? – Shuffle](https://shuffle.dev/blog/2026/01/why-do-most-ai-generated-websites-look-the-same/) | „Statistische Mittelung“ als Ursache; Standardbaukasten Hero + drei Karten + Preistabelle → §9 „Karten in Dreierreihen“, „mittige Anordnung“ |
| [AI Slop Design: Why AI-Generated UI Looks Generic – vibecodekit](https://vibecodekit.dev/ai-slop-design) | Merkmalsliste: Purpurverläufe, Inter/Poppins/Space Grotesk/Geist, shadcn-graue Karten, drei Icon-Kacheln, zaghafte Paletten → §9 Zeilen 2, 3, 8, 15 |
| [Design Observation: Why Do AI-Generated Websites Always Favour Blue-Purple Gradients? – Kai Ni](https://medium.com/@kai.ni/design-observation-why-do-ai-generated-websites-always-favour-blue-purple-gradients-ea91bf038d4c) | Verlauf als Reflex ohne Anlaß → Verbot aller Verläufe, einfarbige Flächenleiter |
| [AI Slop Fonts and Gradients: The Tells That Give Away AI Design – 925studios](https://www.925studios.co/blog/ai-slop-design-tells) | Standardschriften und einheitliche große Rundungen als „Tells“ → §2.1, §4.2 |
| [Linear Design System, Tokens and DESIGN.md – DesignMD / awesome-design-md](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) | Der zentrale Handwerksbefund: **keine Schlagschatten, Tiefe über Flächenleiter plus 1-px-Haarlinien**; abgestufte Hairline-Töne (`hairline` / `hairline-strong`); enge Zeilenhöhen und negative Laufweite bei großen Graden → §4.1, §4.3, §2.2 |
| [A calmer interface for a product in motion / Linear design – LogRocket & identityforge](https://blog.logrocket.com/ux-design/linear-design/) | Dichte erhalten, aber Gewicht staffeln: orientierende Elemente treten zurück, aufgabenrelevante bleiben vorn → §2.3 „Fett ist Mangelware“, §1.3 |
| [Typography in Windows – Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography) | Segoe UI Variable mit den optischen Größen `Small` / `Text` / `Display` und der Achse für Punzenöffnung; in HTML muß die Variante explizit gesetzt werden → §2.1, drei getrennte Schriftstapel |
| [How to use Segoe UI Variable in a website – Tiger Oakes](https://tigeroakes.com/posts/segoe-ui-variable/) / [System Font Stack – CSS-Tricks](https://css-tricks.com/snippets/css/system-font-stack/) | Reihenfolge und Fallbacks eines plattformübergreifenden Systemschrift-Stapels → §2.1 |
| [Executing UX Animations: Duration and Motion Characteristics – NN/g](https://www.nngroup.com/articles/animation-duration/) und [Duration & easing – Material](https://m1.material.io/motion/duration-easing.html) | Desktop-Übergänge etwa halb so lang wie mobile: 150–200 ms; Mikrointeraktionen 100–150 ms; unter 80 ms wirkt es kaputt; `ease-out` für Eintritt, `ease-in` für Austritt → komplette Tabelle §6 |
| [How fast should your UI animations be? – Val Head](https://valhead.com/2016/05/05/how-fast-should-your-ui-animations-be/) | Begründung, warum `ease-out` „reaktionsschnell“ wirkt (schneller Anlauf, ruhiges Auslaufen) → `--ease-out: cubic-bezier(.2,0,0,1)` |
| [Do emojis belong in UI design? – Molly Garber](https://medium.com/@garbermm/do-emojis-belong-in-ui-design-evaluating-their-place-in-modern-products-a0e579a3e3db) | Emoji ersetzen keine funktionalen Icons; plattformabhängige Darstellung; Probleme mit Vorlesewerkzeugen und fehlendem Alternativtext → §7.1 Gründe 1–4 |
| [Emojis – FAO Design System](https://design-system.fao.org/styles/emojis) | „Icons gehören in die Darstellungsschicht, nicht in lokalisierte Zeichenketten“ → Trennung: `Model.SOURCES[].icon` bleibt dem Export vorbehalten, die Oberfläche holt SVG über die `id` |
| [Icon Design Guide – Lucide](https://lucide.dev/contribute/icon-design-guide) und [Stroke width – Lucide](https://lucide.dev/guide/lucide/basics/stroke-width) | Festes Raster, gleiche Strichstärke, runde Enden und Ecken, ~1 px Luft im Rahmen; 1.5 px als feinere Alternative zu 2 px → §7.2 |
| [Understanding SC 1.4.1: Use of Color – W3C WAI](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html) | Farbe darf nie alleiniger Bedeutungsträger sein; Statusanzeigen brauchen Symbol, Form oder Text → §1.3, Statusglyphen über Form unterschieden |
| [Understanding SC 1.4.11: Non-text Contrast – W3C WAI](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html) | 3:1 für Bedienelemente und Zustandsanzeigen gegen benachbarte Flächen → `--line-strong` (3.34 / 3.40), Fokusring, Statusringe |
| [11 Shades of Gray: A Color System Story – OneSignal](https://onesignal.com/blog/11-shades-of-gray-a-color-system-story/) | Reine Graustufen wirken monoton; Grauwerte mit leichtem Farbstich wirken absichtsvoll → alle Neutralen mit einheitlichem warmem Stich (~42°) |
| [Neutral Color Palettes: Warm vs Cool – ColorArchive](https://colorarchive.org/guides/neutral-color-palettes/) | Kühle Neutrale wirken kompetent/geordnet, warme nahbar/analog; nur leicht tönen → warme Papierwerte plus kühler Petrol-Akzent als bewußter Gegensatz („Papier und Tinte“) |
| [„Eyeballing“ or Optical Alignment in Design – Sergey Vlastiuk](https://medium.com/ringcentral-ux/eyeballing-or-optical-alignment-in-design-4ef5ab2d326f) und [Mathematical and Optical alignment – Rails Designer](https://railsdesigner.com/mathematical-optical-alignment-design/) | Icons neben Text wirken zu hoch; runde Formen wirken neben eckigen kleiner; erst Raster, dann optisch nachziehen → §7.6 |
| [Things vs OmniFocus vs Todoist – The Sweet Setup](https://thesweetsetup.com/articles/comparison-best-gtd-apps-things-todoist-omnifocus/) | Die visuelle Dichte von Things 3 ist der eigentliche Qualitätsunterschied – weder luftig noch gedrängt; Typografie trägt die Hierarchie → 32-px-Zeile mit 13/18-px-Grundschrift als kalibrierter Mittelweg, Dichteziele §3.4 |
