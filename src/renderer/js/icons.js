/*
 * Iconsatz fuer Tagwerk - einfarbige Inline-SVG auf 16-px-Raster.
 *
 * Regeln (Gestaltungsleitfaden 7.2), fuer alle Zeichnungen gleich:
 *   - viewBox 0 0 16 16, Zeichenflaeche 14 x 14 (1 px Luft ringsum)
 *   - stroke-width 1.5, linecap/linejoin "round", fill "none"
 *   - Farbe immer currentColor - nie ein fester Wert. Einzige Ausnahme:
 *     der Haken im Erledigt-Glyph, der in der Papierfarbe aus der Scheibe
 *     ausgespart wird (var(--paper)).
 *   - Koordinaten liegen auf halben Pixeln, damit die 1.5-px-Linien bei
 *     100 % DPI nicht ueber zwei Geraetepixel verwaschen.
 *
 * Die Kennungen kommen aus `Model.SOURCES[].iconId` bzw.
 * `Model.STATUSES[].iconId` - sie beschreiben das Motiv, nicht die Quelle.
 * Bei zwei Kennungen weicht der Name vom Leitfaden-Motiv ab, die Zeichnung
 * folgt trotzdem Abschnitt 7.4:
 *   puzzle       = Vorgang (Jira), gezeichnet als Raute in Raute
 *   sprechblase  = Zuruf (muendlich), gezeichnet als Kopf mit Schallwellen
 *
 * Benutzung:
 *   Icons.svg('mail')                        -> <svg> 16 px, aria-hidden
 *   Icons.svg('mail', { size: 12 })          -> 12 px (Wochenansicht)
 *   Icons.svg('mail', { title: 'Outlook' })  -> mit <title>, role="img"
 *   Icons.svg('gibtsnicht')                  -> Rueckfall auf 'punkte'
 *
 * Klassische Script-Datei, global als `Icons` (file:// vertraegt keine Module).
 */
window.Icons = (function () {
  const NS = 'http://www.w3.org/2000/svg';

  /** Rastermass aller Zeichnungen. */
  const GRID = 16;
  /** Strichstaerke aller Zeichnungen. */
  const STROKE = 1.5;
  /** Wer keine Kennung findet, bekommt diese hier. */
  const FALLBACK = 'punkte';

  // --------------------------------------------------------- Kurzschreibweise
  //
  // Eine Zeichnung ist eine Liste von Formen. Jede Form wird spaeter mit
  // createElementNS gebaut - nie ueber innerHTML.

  /** Strichform. */
  const p = (d) => ({ t: 'path', d });
  /** Flaechenform (fill statt stroke). */
  const pf = (d) => ({ t: 'path', d, filled: true });
  /** Kreis als Strich. */
  const c = (cx, cy, r) => ({ t: 'circle', cx, cy, r });
  /** Kreis als Flaeche - Punkte, Knoepfe, Statusscheibe. */
  const cf = (cx, cy, r) => ({ t: 'circle', cx, cy, r, filled: true });
  /** Rechteck; ohne Angabe mit dem Standardradius 1.5. */
  const r = (x, y, w, h, rx) => ({ t: 'rect', x, y, w, h, rx: rx == null ? 1.5 : rx });

  // ------------------------------------------------------------- Zeichnungen

  const DRAWINGS = {
    // --- Statusglyphen (Leitfaden 7.3) -----------------------------------
    // Sie unterscheiden sich in der Form, nicht in der Farbe; die Farbe
    // setzt das Stylesheet ueber [data-status] als currentColor.

    /** offen: nur der leere Ring. */
    kreis: [c(8, 8, 5.5)],

    /** in Arbeit: Ring plus gefuellte linke Halbscheibe - eine halb gelaufene Uhr. */
    halbkreis: [c(8, 8, 5.5), pf('M8 4.5A3.5 3.5 0 0 0 8 11.5Z')],

    /** wartet: Ring plus Pausenzeichen (zwei Balken 1.5 x 5). */
    pause: [c(8, 8, 5.5), p('M6.25 5.5V10.5'), p('M9.75 5.5V10.5')],

    /**
     * erledigt: gefuellte Scheibe, der Haken wird in Papierfarbe
     * ausgespart. Er sitzt 0.3 px unter der Mitte (Leitfaden 7.6).
     */
    haken: [
      cf(8, 8, 5.5),
      { t: 'path', d: 'M5.4 8.2L7.1 10L10.8 6.2', stroke: 'var(--paper, #FBFAF7)' },
    ],

    // --- Quellen (Leitfaden 7.4) -----------------------------------------

    /** chat (Teams): Sprechblase mit Spitze und zwei Punkten. */
    chat: [
      p('M3.5 2.5H12.5A1.5 1.5 0 0 1 14 4V9.5A1.5 1.5 0 0 1 12.5 11H8L4 14L5 11H3.5A1.5 1.5 0 0 1 2 9.5V4A1.5 1.5 0 0 1 3.5 2.5Z'),
      cf(6.2, 6.7, 0.75),
      cf(9.8, 6.7, 0.75),
    ],

    /** mail (Outlook): Umschlag mit Klappe. */
    mail: [r(2, 3.5, 12, 9), p('M2 4.5L8 8.6L14 4.5')],

    /** ticket (ServiceNow): Ticket mit Einkerbungen und Perforation. */
    ticket: [
      p('M3 4H13A1.5 1.5 0 0 1 14.5 5.5V6.6A1.4 1.4 0 0 0 14.5 9.4V10.5A1.5 1.5 0 0 1 13 12H3A1.5 1.5 0 0 1 1.5 10.5V9.4A1.4 1.4 0 0 0 1.5 6.6V5.5A1.5 1.5 0 0 1 3 4Z'),
      { t: 'path', d: 'M6 5.5V10.5', dash: '1.2 1.6' },
    ],

    /** puzzle (Jira): Vorgang - Raute in Raute. */
    puzzle: [p('M8 1.8L14.2 8L8 14.2L1.8 8Z'), p('M8 4.9L11.1 8L8 11.1L4.9 8Z')],

    /** sprechblase (muendlich): Zuruf - Kopf mit Schulterbogen und zwei Schallwellen. */
    sprechblase: [
      p('M2.8 7.1A2.2 2.2 0 0 1 7.2 7.1'),
      p('M1.7 12.6A3.3 3.3 0 0 1 8.3 12.6'),
      p('M10.55 6.45A2.2 2.2 0 0 1 10.55 9.55'),
      p('M11.85 5.15A4 4 0 0 1 11.85 10.85'),
    ],

    /** telefon: Handapparat - durchhaengender Bogen mit zwei Muscheln. */
    telefon: [p('M3.5 4Q5 11.25 12.4 12.3'), p('M1.8 4.4L5.2 3.6'), p('M12.7 10.6L12.1 13.9')],

    /** kalender (Meeting): Kalenderblatt mit zwei Ringen. */
    kalender: [r(2, 3, 12, 11), p('M2 6.5H14'), p('M5.3 2V3.5'), p('M10.7 2V3.5')],

    /** standort (vor Ort): Stecknadel mit Loch. */
    standort: [p('M4.95 7.8A3.4 3.4 0 1 1 11.05 7.8L8 14Z'), c(8, 6.3, 1.2)],

    /** buch (Wiki): aufgeschlagenes Buch, Seiten nach aussen gewoelbt. */
    buch: [
      p('M8 5.2C6.1 4.2 4 3.6 1.8 3.6V12.4C4 12.4 6.1 13 8 13.6'),
      p('M8 5.2C9.9 4.2 12 3.6 14.2 3.6V12.4C12 12.4 9.9 13 8 13.6'),
      p('M8 5.2V13.6'),
    ],

    /** notiz (eigene Notiz): Zettel mit abgeschnittener Ecke. */
    notiz: [
      p('M4.5 2H11.5A1.5 1.5 0 0 1 13 3.5V11L10 14H4.5A1.5 1.5 0 0 1 3 12.5V3.5A1.5 1.5 0 0 1 4.5 2Z'),
      p('M5.5 5.5H10.5'),
      p('M5.5 8H9.5'),
    ],

    /** punkte (Sonstiges): Kreis mit drei Punkten - zugleich der Rueckfall. */
    punkte: [c(8, 8, 6), cf(5.2, 8, 0.85), cf(8, 8, 0.85), cf(10.8, 8, 0.85)],

    // --- Navigation und Aktionen (Leitfaden 7.5) --------------------------

    /** zurueck: Chevron nach links, Spitze 0.5 px entgegen der Spitze versetzt. */
    zurueck: [p('M10 3.5L5.5 8L10 12.5')],

    /** vor: Chevron nach rechts. */
    vor: [p('M5.5 3.5L10.5 8L5.5 12.5')],

    /** aufklappen: derselbe Chevron, Spitze nach unten. */
    aufklappen: [p('M3.5 5.5L8 10L12.5 5.5')],

    /** zuklappen: Chevron nach oben - Gegenstueck zum Aufklappen. */
    zuklappen: [p('M3.5 10.5L8 6L12.5 10.5')],

    /** heute: Quadrat mit gesetztem Punkt. */
    heute: [r(3, 3, 10, 10), cf(8, 8, 1.8)],

    /** suchen: Lupe. */
    suchen: [c(6.8, 6.8, 4.5), p('M10.2 10.2L13.5 13.5')],

    /** Schnellerfassung: Quadrat mit Plus. */
    schnellerfassung: [r(2.5, 2.5, 11, 11), p('M8 5.5V10.5'), p('M5.5 8H10.5')],

    /** exportieren: Ablage mit Pfeil nach oben. */
    exportieren: [p('M3 9.5V13.5H13V9.5'), p('M8 11V2.5'), p('M5.5 5L8 2.5L10.5 5')],

    /** Hilfe: Kreis mit Fragezeichen. */
    hilfe: [
      c(8, 8, 6.2),
      p('M6 6.2C6 5.4 6.8 4.8 8 4.8C9.3 4.8 9.8 5.6 9.8 6.6C9.8 7.7 8 7.9 8 8.4V9.5'),
      cf(8, 11.8, 0.8),
    ],

    /** Einstellungen: zwei Regler - kein Zahnrad, das wird bei 16 px zu Matsch. */
    einstellungen: [p('M2 5.5H14'), p('M2 10.5H14'), cf(10.5, 5.5, 1.8), cf(5.5, 10.5, 1.8)],

    /** schliessen: Diagonalkreuz. */
    schliessen: [p('M4 4L12 12'), p('M12 4L4 12')],

    /** bearbeiten: Stift mit Zwinge. */
    bearbeiten: [p('M12 2.5L13.5 4L6.5 11L4 12L5 9.5Z'), p('M10.5 4L12 5.5')],

    /** loeschen: Papierkorb mit Griffbuegel und zwei Rippen. */
    loeschen: [
      p('M2.5 4H13.5'),
      p('M6 4V2.8H10V4'),
      p('M3.8 4L4.7 14H11.3L12.2 4'),
      p('M6.6 6.5V11.8'),
      p('M9.4 6.5V11.8'),
    ],

    /** weiterschieben: Pfeil nach rechts gegen eine Anschlaglinie. */
    weiterschieben: [p('M2.5 8H11'), p('M7.5 4.5L11 8L7.5 11.5'), p('M13.5 3V13')],

    /** gruppieren / filtern: drei Linien abnehmender Laenge. */
    gruppieren: [p('M2.5 4H13.5'), p('M2.5 8H10.5'), p('M2.5 12H7.5')],

    /** auswahl: freistehender Haken (Bundsteg der Mehrfachauswahl). */
    auswahl: [p('M3.5 8.5L6.5 11.5L12.5 4.5')],

    /** rueckgaengig: oben offener Bogen mit Pfeilspitze am linken Ende. */
    rueckgaengig: [p('M3.3 6.8A5 5 0 0 0 12.7 10.2'), p('M3 4.5L3.3 6.8L6.5 4.2')],

    /** Warnung: Dreieck mit Ausrufezeichen. */
    warnung: [p('M8 2.5L14.5 13.5H1.5Z'), p('M8 6.5V9.8'), cf(8, 11.6, 0.8)],

    /** Ordner oeffnen. */
    ordner: [
      p('M1.5 4A1.5 1.5 0 0 1 3 2.5H5.5L6.8 4.5H13A1.5 1.5 0 0 1 14.5 6V11.5A1.5 1.5 0 0 1 13 13H3A1.5 1.5 0 0 1 1.5 11.5Z'),
    ],

    /** kopieren: zwei Blaetter, vom hinteren nur obere und linke Kante. */
    kopieren: [p('M11 2H3.5A1.5 1.5 0 0 0 2 3.5V11'), r(5, 5, 9, 9)],

    /** Ziehgriff: zwei kurze Striche, erscheint nur bei Hover. */
    griff: [p('M4 6H12'), p('M4 10H12')],

    /** Wortmarke: drei Striche 11 / 7 / 9 px - ein abstrahierter Fahrplaneintrag. */
    marke: [p('M2.5 4.5H13.5'), p('M2.5 8H9.5'), p('M2.5 11.5H11.5')],
  };

  /**
   * Zweitnamen. Sie kosten nichts und fangen die naheliegenden Schreibweisen
   * ab - besser ein richtiges Icon als der Rueckfall auf 'punkte'.
   */
  const ALIASES = {
    'zurück': 'zurueck',
    'chevron-links': 'zurueck',
    'chevron-rechts': 'vor',
    'chevron-runter': 'aufklappen',
    'chevron-hoch': 'zuklappen',
    'einklappen': 'zuklappen',
    lupe: 'suchen',
    blitz: 'schnellerfassung',
    schnell: 'schnellerfassung',
    export: 'exportieren',
    frage: 'hilfe',
    regler: 'einstellungen',
    zahnrad: 'einstellungen',
    'schließen': 'schliessen',
    kreuz: 'schliessen',
    stift: 'bearbeiten',
    papierkorb: 'loeschen',
    'löschen': 'loeschen',
    muell: 'loeschen',
    verschieben: 'weiterschieben',
    morgen: 'weiterschieben',
    filtern: 'gruppieren',
    check: 'auswahl',
    'haken-frei': 'auswahl',
    'rückgängig': 'rueckgaengig',
    undo: 'rueckgaengig',
    achtung: 'warnung',
    'überfällig': 'warnung',
    ziehgriff: 'griff',
    // Quellen: die Quellen-id selbst darf ebenfalls gefragt werden
    teams: 'chat',
    jira: 'puzzle',
    muendlich: 'sprechblase',
    'mündlich': 'sprechblase',
    meeting: 'kalender',
    vorort: 'standort',
    wiki: 'buch',
    selbst: 'notiz',
    sonstiges: 'punkte',
    // Status
    offen: 'kreis',
    aktiv: 'halbkreis',
    wartet: 'pause',
    erledigt: 'haken',
  };

  // ------------------------------------------------------------------- Bau

  /** Fertige Zeichnungen; jede wird einmal gebaut und danach geklont. */
  const cache = new Map();

  function shape(form) {
    const node = document.createElementNS(NS, form.t);
    if (form.t === 'path') node.setAttribute('d', form.d);
    if (form.t === 'circle') {
      node.setAttribute('cx', form.cx);
      node.setAttribute('cy', form.cy);
      node.setAttribute('r', form.r);
    }
    if (form.t === 'rect') {
      node.setAttribute('x', form.x);
      node.setAttribute('y', form.y);
      node.setAttribute('width', form.w);
      node.setAttribute('height', form.h);
      node.setAttribute('rx', form.rx);
    }
    if (form.filled) {
      node.setAttribute('fill', 'currentColor');
      node.setAttribute('stroke', 'none');
    }
    if (form.stroke) node.setAttribute('stroke', form.stroke);
    if (form.dash) node.setAttribute('stroke-dasharray', form.dash);
    return node;
  }

  /** Baut die Zeichnung einmal auf; alles Veraenderliche kommt erst beim Klonen dazu. */
  function build(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${GRID} ${GRID}`);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(STROKE));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('focusable', 'false');
    for (const form of DRAWINGS[name]) svg.appendChild(shape(form));
    return svg;
  }

  /** Kennung aufloesen: erst direkt, dann ueber die Zweitnamen, sonst Rueckfall. */
  function resolve(name) {
    const key = String(name == null ? '' : name).trim().toLowerCase();
    if (DRAWINGS[key]) return key;
    const alias = ALIASES[key];
    if (alias && DRAWINGS[alias]) return alias;
    return FALLBACK;
  }

  /**
   * Liefert ein frisches <svg>-Element.
   *
   * @param {string} name  Kennung, z. B. 'mail' (unbekannt -> 'punkte')
   * @param {object} [options]
   *        size   Kantenlaenge in px (Vorgabe 16, Wochenansicht 12)
   *        title  Klarname; setzt <title> und role="img" statt aria-hidden
   *        class  zusaetzliche Klassen
   */
  function svg(name, options) {
    const opts = options || {};
    const key = resolve(name);

    if (!cache.has(key)) cache.set(key, build(key));
    const node = cache.get(key).cloneNode(true);

    const size = opts.size == null ? GRID : opts.size;
    node.setAttribute('width', String(size));
    node.setAttribute('height', String(size));
    node.setAttribute('class', ('icon icon--' + key + ' ' + (opts.class || '')).trim());

    if (opts.title) {
      // Mit Klarnamen ist das Icon selbst die Information: es bekommt eine
      // zugaengliche Bezeichnung und faellt nicht aus dem Vorlesefluss.
      const title = document.createElementNS(NS, 'title');
      title.textContent = String(opts.title); // Nutzertext nie als Markup
      node.insertBefore(title, node.firstChild);
      node.setAttribute('role', 'img');
    } else {
      // Ohne Klarnamen traegt der umgebende Knopf die Bedeutung.
      node.setAttribute('aria-hidden', 'true');
    }

    return node;
  }

  /** Gibt es eine eigene Zeichnung fuer diese Kennung? (Zweitnamen zaehlen mit.) */
  function has(name) {
    const key = String(name == null ? '' : name).trim().toLowerCase();
    return Boolean(DRAWINGS[key] || (ALIASES[key] && DRAWINGS[ALIASES[key]]));
  }

  /** Alle Kennungen, in der Reihenfolge der Definition. */
  function names() {
    return Object.keys(DRAWINGS);
  }

  /** Bequemlichkeit: Icon zu einer Quelle bzw. zu einem Status aus dem Modell. */
  function forSource(sourceId, options) {
    const source = Model.sourceById(sourceId);
    return svg(source.iconId, Object.assign({ title: source.label }, options || {}));
  }

  function forStatus(statusId, options) {
    return svg(Model.statusById(statusId).iconId, options);
  }

  return { svg, has, names, resolve, forSource, forStatus, GRID, STROKE, FALLBACK };
})();
