/*
 * Die beiden Hauptansichten als Kursbuch-Tafel: ein Tag im Detail, eine Woche
 * im Ueberblick.
 *
 * Aufbau einer Tafel (Tages- wie Wochenansicht, Leitfaden §3.5 bis §3.7):
 *
 *   section.tafel
 *     div.tageskopf         40 px: Datum, KW, Balken, Bilanz
 *     div.auswahlleiste     nur bei Mehrfachauswahl
 *     div.tafel__rumpf      alle Zeilen ohne Zwischenraum, zugleich Ablageziel
 *       div.gruppenkopf     22 px Zwischentitel mit durchlaufender Haarlinie
 *       article.item        32 px Aufgabenzeile (kommt aus item.js)
 *     div.ablagezonen       erscheint nur waehrend eines Ziehvorgangs
 *     div.tafel__fuss       Aktionen und Tastaturhinweis
 *
 * Es gibt keine Kaesten mehr: Liegengebliebenes, Gruppen und Tagesliste stehen
 * in derselben Tafel und werden allein durch Zwischentitel getrennt.
 *
 * Hier sitzt auch die Tastaturbedienung der Listen: die Ereignisse haengen an
 * den Zeilen-Containern, nicht an jeder einzelnen Zeile.
 */
window.Views = (function () {
  const { h } = Util;

  /** Wie viele liegengebliebene Aufgaben ungefragt angezeigt werden. */
  const LIEGEN_VORSCHAU = 8;

  const GRUPPIERUNGEN = [
    { id: 'keine', label: 'Ohne Gruppierung' },
    { id: 'status', label: 'Nach Status' },
    { id: 'quelle', label: 'Nach Quelle' },
  ];

  /*
   * Eine Aufgabenzeile wird ueber ihren Fokus-Schluessel erkannt, nicht ueber
   * eine Klasse: welche Klassen item.js vergibt, geht die Ansicht nichts an.
   */
  const ZEILE = '[data-fkey^="item:"]';

  /** Spalte der Wochentafel - Bezugsrahmen fuer die Pfeiltasten. */
  const SPALTE = '.wochentafel__spalte';

  /** Ab so vielen Zeilen lohnt sich content-visibility (Leitfaden §3.3). */
  const VIELE_ZEILEN = 200;

  // ------------------------------------------------------------ Tagesansicht

  function renderDay(root) {
    const state = State.get();
    const day = state.cursorDay;
    const items = State.itemsForDay(day);
    const all = State.allForDay(day);
    const stats = State.counts(all);
    const liegen = State.overdue(day);

    // Reihenfolge auf dem Schirm - Grundlage fuer die Umschalt-Auswahl
    State.setOrder([...liegen.map((i) => i.id), ...items.map((i) => i.id)]);

    const tafel = h('section', { class: 'tafel tafel--tag' });
    tafel.appendChild(tageskopf(day, stats, items.length, all.length));
    if (state.selected.size) tafel.appendChild(auswahlleiste(day));

    // Ein einziger Rumpf fuer alles - er ist zugleich das Ablageziel des Tages.
    const rumpf = h('div', { class: 'tafel__rumpf' });
    ItemCard.makeDropTarget(rumpf, day);
    bindZeilen(rumpf);

    if (liegen.length) fuegeLiegengebliebenesEin(rumpf, liegen, day);

    if (!items.length) {
      rumpf.appendChild(leererTag(all.length));
    } else if (state.groupBy === 'keine') {
      for (const item of items) rumpf.appendChild(ItemCard.render(item));
    } else {
      for (const gruppe of gruppiere(items, state.groupBy)) fuegeGruppeEin(rumpf, gruppe);
    }

    merkeZeilenzahl(rumpf, liegen.length + items.length);
    tafel.appendChild(rumpf);

    // Ablagezonen - erscheinen erst, waehrend eine Zeile gezogen wird
    tafel.appendChild(ablagezonen(day));
    tafel.appendChild(tagesfuss(day, all, stats));

    root.appendChild(tafel);
    finishRender(root);
  }

  /**
   * Tageskopf nach §3.5: eine 40-px-Zeile, links das Datum, rechts Balken und
   * Bilanz. Steht der Zeiger nicht auf heute, tritt hinter das Datum das
   * Sprunglabel „Heute“.
   */
  function tageskopf(day, stats, sichtbar, gesamt) {
    const offen = stats.offen + stats.aktiv + stats.wartet;

    return h('div', { class: 'tageskopf' },
      h('h2', { class: 'tageskopf__datum' }, Dates.formatLong(day)),
      day === Dates.todayKey() ? null : sprungHeute('Zum heutigen Tag springen'),
      h('span', { class: 'tageskopf__kw' }, Dates.isoWeekLabel(day)),
      sichtbar !== gesamt
        ? h('span', { class: 'tageskopf__filter' }, `${sichtbar} von ${gesamt} sichtbar`)
        : null,
      h('span', { class: 'tageskopf__steg' }),
      stats.gesamt ? fortschritt(stats.erledigt, stats.gesamt) : null,
      bilanz(offen, stats.erledigt, 0),
      gruppierungswahl()
    );
  }

  /** Sprunglabel im Tageskopf - Versalien setzt die Gestaltung, nicht der Text. */
  function sprungHeute(titel) {
    return h('button', {
      class: 'tageskopf__heute',
      title: titel,
      onclick: () => State.goToday(),
    }, 'Heute');
  }

  /** „12 offen · 9 erledigt“ - Zahlen tabellarisch, ohne Kapseln. */
  function bilanz(offen, erledigt, liegen) {
    return h('span', { class: 'tageskopf__bilanz' },
      h('span', { class: 'bilanz__offen' }, `${offen} offen`),
      ' · ',
      h('span', { class: 'bilanz__erledigt' }, `${erledigt} erledigt`),
      liegen ? ' · ' : null,
      liegen
        ? h('span', {
            class: 'bilanz__liegen',
            title: 'offen aus vergangenen Tagen dieser Woche',
          }, `${liegen} liegengeblieben`)
        : null
    );
  }

  /** Auswahlfeld fuer die Gruppierung der Tagesliste. */
  function gruppierungswahl() {
    const state = State.get();
    const select = h('select', {
      class: 'tageskopf__gruppierung field field--slim',
      title: 'Tagesliste gruppieren',
      'aria-label': 'Gruppierung',
    },
      ...GRUPPIERUNGEN.map((g) => h('option', { value: g.id, selected: g.id === state.groupBy }, g.label))
    );
    select.addEventListener('change', () => State.set({ groupBy: select.value }));
    return select;
  }

  /** Aufgaben nach Status oder Quelle buendeln - leere Gruppen fallen weg. */
  function gruppiere(items, mode) {
    const defs = mode === 'quelle' ? Model.SOURCES : Model.STATUSES;
    const buckets = new Map(defs.map((d) => [d.id, []]));

    for (const item of items) {
      const key = mode === 'quelle' ? Model.sourceById(item.source).id : Model.statusById(item.status).id;
      buckets.get(key).push(item);
    }

    // Kein Emoji im Zwischentitel: bei Gruppierung nach Quelle steht der
    // Klarname da, das ist ohnehin die verstaendlichere Angabe (§7.2).
    return defs
      .filter((d) => buckets.get(d.id).length)
      .map((d) => ({ id: d.id, label: d.label, items: buckets.get(d.id) }));
  }

  /**
   * Zwischentitel nach §3.6: Versalienlabel links auf der Tafelkante, dann eine
   * Haarlinie ueber die Restbreite, rechts die Anzahl.
   */
  function gruppenkopf(props, ...extras) {
    const kopf = h('div', { class: 'gruppenkopf' + (props.klasse ? ' ' + props.klasse : '') });
    if (props.dataset) Object.assign(kopf.dataset, props.dataset);

    kopf.appendChild(
      props.schalter || h('span', { class: 'gruppenkopf__name' }, props.label)
    );
    if (props.notiz) kopf.appendChild(h('span', { class: 'gruppenkopf__notiz' }, props.notiz));
    kopf.appendChild(h('span', { class: 'gruppenkopf__linie', 'aria-hidden': 'true' }));
    kopf.appendChild(h('span', { class: 'gruppenkopf__zahl' }, String(props.anzahl)));
    for (const extra of extras) if (extra) kopf.appendChild(extra);
    return kopf;
  }

  /** Eine Gruppe: Zwischentitel und danach die Zeilen - ohne Kasten dazwischen. */
  function fuegeGruppeEin(rumpf, gruppe) {
    rumpf.appendChild(
      gruppenkopf({ label: gruppe.label, anzahl: gruppe.items.length, dataset: { gruppe: gruppe.id } })
    );
    for (const item of gruppe.items) rumpf.appendChild(ItemCard.render(item));
  }

  function leererTag(gesamt) {
    if (gesamt) {
      return leerzeile(
        'Nichts passt zum Filter.',
        'Filter zurücksetzen',
        () => State.set({ search: '', filterStatus: 'alle', filterSource: null, filterTag: null })
      );
    }
    return leerzeile('Noch nichts erfasst für diesen Tag.', null, null,
      'Strg + N für die Erfassungszeile.');
  }

  /** Leerer Zustand nach §5.9: ein Satz auf der Textkante, kein Kasten. */
  function leerzeile(text, aktion, onAktion, hinweis) {
    return h('div', { class: 'leerzeile' },
      h('p', { class: 'leerzeile__text' }, text),
      hinweis ? h('p', { class: 'leerzeile__taste' }, hinweis) : null,
      aktion ? h('button', { class: 'linkbtn', onclick: onAktion }, aktion) : null
    );
  }

  // ----------------------------------------------------------- Liegengeblieben
  //
  // Frueher ein eigener Kasten ueber der Liste, jetzt der erste Abschnitt
  // derselben Tafel. Die Datumsspalte sitzt links vor dem Randstrich (§3.3);
  // wiederholte Daten bleiben leer, wie in einer gedruckten Fahrplantafel.

  function fuegeLiegengebliebenesEin(rumpf, items, zielTag) {
    const state = State.get();
    const offen = state.showOverdue;
    const tage = tageweise(items);
    const sichtbar = offen && !state.showAllOverdue ? items.slice(0, LIEGEN_VORSCHAU) : items;

    const schalter = h('button', {
      class: 'gruppenkopf__schalter',
      'aria-expanded': String(offen),
      title: offen ? 'Liegengebliebenes ausblenden' : 'Liegengebliebenes einblenden',
      onclick: () => State.set({ showOverdue: !offen }),
    }, 'Liegengeblieben');

    rumpf.appendChild(
      gruppenkopf({
        klasse: 'gruppenkopf--liegen' + (offen ? ' is-offen' : ''),
        schalter,
        notiz: `${Util.plural(tage.length, 'Tag', 'Tage')} · ältestes ${altersangabe(items[0].day)}`,
        anzahl: items.length,
      },
        h('button', {
          class: 'gruppenkopf__aktion',
          title: 'Alle diese Aufgaben auf den angezeigten Tag legen',
          onclick: () => State.move(items.map((i) => i.id), zielTag),
        }, 'Alle herholen')
      )
    );

    if (!offen) return;

    let letzterTag = null;
    for (const item of sichtbar) {
      const tagesgruppe = item.day === letzterTag ? null : tage.find((g) => g.day === item.day);
      letzterTag = item.day;
      rumpf.appendChild(liegenzeile(item, tagesgruppe, zielTag));
    }

    if (sichtbar.length < items.length) {
      rumpf.appendChild(
        mehrzeile(`Alle ${items.length} anzeigen (${items.length - sichtbar.length} weitere)`,
          () => State.set({ showAllOverdue: true }))
      );
    } else if (state.showAllOverdue && items.length > LIEGEN_VORSCHAU) {
      rumpf.appendChild(mehrzeile('Weniger anzeigen', () => State.set({ showAllOverdue: false })));
    }
  }

  /**
   * Eine liegengebliebene Aufgabe: Datumsspalte plus die gewohnte Zeile.
   * Das Datum steht nur in der ersten Zeile eines Tages und holt beim Klick
   * den ganzen Tag her - das ersetzt die frueheren „herholen“-Kopfzeilen.
   */
  function liegenzeile(item, tagesgruppe, zielTag) {
    const zeile = h('div', { class: 'liegenzeile' });

    if (tagesgruppe) {
      const anzahl = tagesgruppe.items.length;
      zeile.appendChild(
        h('button', {
          class: 'liegenzeile__datum',
          title:
            `${Dates.shortWeekday(item.day)}, ${Dates.formatNumeric(item.day)} · ${altersangabe(item.day)}` +
            ` – ${Util.plural(anzahl, 'Aufgabe', 'Aufgaben')} dieses Tages herholen`,
          onclick: () => State.move(tagesgruppe.items.map((i) => i.id), zielTag),
        }, Dates.formatShort(item.day))
      );
    } else {
      zeile.appendChild(h('span', { class: 'liegenzeile__datum liegenzeile__datum--leer', 'aria-hidden': 'true' }));
    }

    zeile.appendChild(ItemCard.render(item, { hideDay: true }));
    return zeile;
  }

  /** Zeile in Tafelhoehe, die die Liste verlaengert oder wieder kuerzt. */
  function mehrzeile(label, onClick) {
    return h('div', { class: 'tafel__mehr' },
      h('button', { class: 'linkbtn', onclick: onClick }, label)
    );
  }

  /** Nach Tag buendeln - die Liste kommt bereits sortiert an. */
  function tageweise(items) {
    const out = [];
    let current = null;
    for (const item of items) {
      if (!current || current.day !== item.day) out.push((current = { day: item.day, items: [] }));
      current.items.push(item);
    }
    return out;
  }

  function altersangabe(day) {
    const days = Dates.diffDays(day, Dates.todayKey());
    if (days <= 0) return Dates.formatShort(day);
    if (days === 1) return 'seit gestern';
    if (days < 7) return `seit ${days} Tagen`;
    if (days < 14) return 'seit über einer Woche';
    return `seit ${Math.floor(days / 7)} Wochen`;
  }

  // ----------------------------------------------------------- Wochenansicht

  function renderWeek(root) {
    const days = State.weekDays();
    const today = Dates.todayKey();
    const first = days[0];
    const last = days[days.length - 1];

    const proTag = days.map((day) => {
      const shown = State.itemsForDay(day);
      const all = State.allForDay(day);
      const stats = State.counts(all);
      return { day, shown, all, stats, offen: stats.offen + stats.aktiv + stats.wartet };
    });

    const woche = proTag.reduce(
      (acc, d) => {
        acc.gesamt += d.stats.gesamt;
        acc.erledigt += d.stats.erledigt;
        acc.offen += d.offen;
        if (d.day < today) acc.liegen += d.offen;
        return acc;
      },
      { gesamt: 0, erledigt: 0, offen: 0, liegen: 0 }
    );

    const tafel = h('section', { class: 'tafel tafel--woche' });
    tafel.appendChild(
      h('div', { class: 'tageskopf tageskopf--woche' },
        h('h2', { class: 'tageskopf__datum' }, Dates.isoWeekLabel(first)),
        h('span', { class: 'tageskopf__spanne' }, Dates.rangeLabel(first, last)),
        days.includes(today) ? null : sprungHeute('Zur laufenden Woche springen'),
        h('span', { class: 'tageskopf__steg' }),
        woche.gesamt ? fortschritt(woche.erledigt, woche.gesamt) : null,
        bilanz(woche.offen, woche.erledigt, woche.liegen)
      )
    );

    // Reihenfolge auf dem Schirm - Grundlage fuer die Umschalt-Auswahl
    State.setOrder(proTag.flatMap((d) => d.shown.map((i) => i.id)));

    /*
     * Eine Tafel, kein Kartenraster (§3.7): Spalten ohne Zwischenraum, getrennt
     * durch die linke Haarlinie jeder Spalte ausser der ersten. Die Spaltenzahl
     * steht als Attribut *und* als Merkmal bereit - so bleibt das Raster auch
     * dann richtig, wenn einmal eine andere Zahl Tage angezeigt wird.
     */
    const gitter = h('div', { class: 'wochentafel', dataset: { spalten: String(days.length) } });
    gitter.style.setProperty('--spalten', String(days.length));

    for (const eintrag of proTag) gitter.appendChild(wochenspalte(eintrag, today));
    tafel.appendChild(gitter);

    tafel.appendChild(
      h('div', { class: 'tafel__fuss' },
        h('button', { class: 'linkbtn', onclick: () => Dialogs.copyWeek(days) }, 'Woche kopieren'),
        h('button', { class: 'linkbtn', onclick: () => Dialogs.openExport() }, 'Woche exportieren …'),
        h('span', { class: 'tafel__hinweis' },
          `${Util.plural(woche.gesamt, 'Aufgabe', 'Aufgaben')} in dieser Woche · ${woche.offen} offen`)
      )
    );

    root.appendChild(tafel);
    finishRender(root);
  }

  function wochenspalte(eintrag, today) {
    const { day, shown, stats, offen } = eintrag;
    const vergangen = day < today;

    const spalte = h('div', {
      class:
        'wochentafel__spalte' +
        (day === today ? ' is-heute' : '') +
        (Dates.isWeekend(day) ? ' is-wochenende' : '') +
        (vergangen && offen ? ' is-liegen' : ''),
      dataset: { day },
    });

    // Die ganze Spalte ist Ablageziel, nicht nur ihre Zeilenliste - so trifft
    // man auch unterhalb der letzten Zeile noch den richtigen Tag.
    ItemCard.makeDropTarget(spalte, day);
    bindZeilen(spalte);

    spalte.appendChild(
      h('div', { class: 'spaltenkopf' },
        h('button', {
          class: 'spaltenkopf__tag',
          title: 'Diesen Tag im Detail zeigen',
          onclick: () => State.set({ view: 'tag', cursorDay: day }),
        },
          h('span', { class: 'spaltenkopf__wochentag' }, Dates.shortWeekday(day)),
          h('span', { class: 'spaltenkopf__datum' }, Dates.formatShort(day))
        ),
        h('span', { class: 'spaltenkopf__zahlen' },
          offen
            ? h('span', {
                class: 'zaehler zaehler--offen' + (vergangen ? ' zaehler--liegen' : ''),
                title: vergangen ? 'offen und liegengeblieben' : 'offen',
              }, String(offen))
            : null,
          offen && stats.erledigt ? h('span', { class: 'zaehler__punkt', 'aria-hidden': 'true' }, '·') : null,
          stats.erledigt ? h('span', { class: 'zaehler zaehler--erledigt', title: 'erledigt' }, String(stats.erledigt)) : null
        )
      )
    );

    const zeilen = h('div', { class: 'wochentafel__zeilen' });
    for (const item of shown) zeilen.appendChild(ItemCard.renderCompact(item));
    if (!shown.length) zeilen.appendChild(h('div', { class: 'wochentafel__leer' }, '–'));
    merkeZeilenzahl(zeilen, shown.length);
    spalte.appendChild(zeilen);

    spalte.appendChild(
      h('button', {
        class: 'wochentafel__neu',
        title: `Aufgabe für ${Dates.shortWeekday(day)}, ${Dates.formatNumeric(day)} erfassen`,
        'aria-label': `Aufgabe für ${Dates.formatNumeric(day)} erfassen`,
        onclick: () => App.captureInto(day),
      }, '+')
    );

    return spalte;
  }

  // ------------------------------------------------------------ Massenaktionen

  function auswahlleiste(day) {
    const ids = [...State.get().selected];
    return h('div', { class: 'auswahlleiste', role: 'group', 'aria-label': 'Auswahl' },
      h('span', { class: 'auswahlleiste__zahl' }, `${Util.plural(ids.length, 'Aufgabe', 'Aufgaben')} ausgewählt`),
      h('button', { class: 'btn', onclick: () => State.setStatusFor(ids, 'erledigt') }, 'Erledigt'),
      h('button', { class: 'btn', onclick: () => State.setStatusFor(ids, 'offen') }, 'Offen'),
      h('button', { class: 'btn', onclick: () => State.moveSelection(Dates.addDays(day, 1)) }, 'Auf morgen'),
      h('button', {
        class: 'btn',
        onclick: () => State.moveSelection(Dates.startOfWeek(Dates.addDays(day, 7))),
      }, 'Nächste Woche'),
      h('span', { class: 'auswahlleiste__steg' }),
      h('button', { class: 'linkbtn', onclick: () => State.clearSelection() }, 'Auswahl aufheben')
    );
  }

  // ------------------------------------------------------- Ablagezonen (Drag)

  let zonenLeiste = null;

  function ablagezonen(day) {
    const ziele = [];
    if (day !== Dates.todayKey()) ziele.push({ label: 'Heute', day: Dates.todayKey() });
    ziele.push({ label: 'Morgen', day: Dates.addDays(day, 1) });
    ziele.push({ label: 'Nächste Woche', day: Dates.startOfWeek(Dates.addDays(day, 7)) });

    const leiste = h('div', { class: 'ablagezonen', 'aria-hidden': 'true' });
    for (const ziel of ziele) {
      const zone = h('div', { class: 'ablagezone', dataset: { day: ziel.day } },
        h('span', { class: 'ablagezone__ziel' }, ziel.label),
        h('span', { class: 'ablagezone__datum' }, Dates.formatShort(ziel.day))
      );
      ItemCard.makeDropTarget(zone, ziel.day);
      leiste.appendChild(zone);
    }
    leiste.hidden = true;
    zonenLeiste = leiste;
    return leiste;
  }

  function zeigeZonen(on) {
    if (zonenLeiste && zonenLeiste.isConnected) zonenLeiste.hidden = !on;
  }

  // Einmalig registriert: die Zonen erscheinen, sobald eine Zeile gezogen wird.
  document.addEventListener('dragstart', (ev) => {
    const node = ev.target;
    if (node && node.closest && node.closest(ZEILE)) zeigeZonen(true);
  }, true);
  document.addEventListener('dragend', () => zeigeZonen(false), true);
  document.addEventListener('drop', () => zeigeZonen(false), true);

  // --------------------------------------------------------------- Tastatur
  //
  // Die Listener haengen am Zeilen-Container, nicht an den Zeilen: eine Liste
  // mit tausend Aufgaben braucht so trotzdem nur eine Handvoll Ereignisse.

  function bindZeilen(container) {
    container.addEventListener('keydown', onListKey);
    container.addEventListener('focusin', (ev) => {
      const zeile = zeileVon(ev.target);
      if (zeile) markiereFokus(zeile);
    });
  }

  function zeileVon(node) {
    return node && node.closest ? node.closest(ZEILE) : null;
  }

  function zeilenIn(scope) {
    return Util.els(ZEILE, scope);
  }

  /**
   * Zeile als aktuelle Zeile markieren (Klasse + Tab-Reihenfolge).
   * Gesucht wird nur nach der bisher markierten Zeile, nicht nach allen -
   * bei tausend Aufgaben ist das der Unterschied pro Pfeiltaste.
   */
  function markiereFokus(zeile) {
    const scope = zeile.closest('.tafel') || zeile.closest('.viewroot') || document;
    for (const other of Util.els('.is-focused, [tabindex="0"]', scope)) {
      if (other === zeile || !(other.dataset.fkey || '').startsWith('item:')) continue;
      other.classList.remove('is-focused');
      other.tabIndex = -1;
    }
    zeile.classList.add('is-focused');
    zeile.tabIndex = 0;
    State.setFocus(zeile.dataset.id);
  }

  function fokussiere(zeile) {
    if (!zeile) return;
    markiereFokus(zeile);
    zeile.focus();
  }

  /** Bezugsrahmen fuer Auf/Ab und Entfernen: die Spalte, sonst die ganze Tafel. */
  function umgebung(zeile) {
    return zeile.closest(SPALTE) || zeile.closest('.tafel') || document;
  }

  function onListKey(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // gehoert der Kopfzeile
    if (Util.isTextInput(ev.target)) return; // jemand tippt gerade

    const zeile = zeileVon(ev.target);
    if (!zeile) return;
    const item = State.itemById(zeile.dataset.id);
    if (!item) return;

    // In der Wochentafel steht die kompakte Minizeile - dort fuehrt Enter in
    // die Tagesansicht, statt die Zeile aufzuklappen.
    const kompakt = !!zeile.closest(SPALTE);
    const key = ev.key;

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      ev.preventDefault();
      const zeilen = zeilenIn(umgebung(zeile));
      const next = zeilen[zeilen.indexOf(zeile) + (key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      if (ev.shiftKey) State.selectRange(next.dataset.id);
      fokussiere(next);
      return;
    }

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const spalte = zeile.closest(SPALTE);
      if (!spalte) return;
      ev.preventDefault();
      const spalten = Util.els(SPALTE, spalte.parentNode);
      const ziel = spalten[spalten.indexOf(spalte) + (key === 'ArrowRight' ? 1 : -1)];
      if (!ziel) return;
      const reihe = zeilenIn(spalte).indexOf(zeile);
      const kandidaten = zeilenIn(ziel);
      fokussiere(kandidaten[Math.min(reihe, kandidaten.length - 1)]);
      return;
    }

    if (key === ' ' || key === 'Spacebar') {
      ev.preventDefault();
      const ids = State.selectionOr(item.id);
      if (ids.length > 1) State.setStatusFor(ids, item.status === 'erledigt' ? 'offen' : 'erledigt');
      else State.toggleDone(item);
      return;
    }

    if (key === 'Enter') {
      ev.preventDefault();
      if (kompakt) {
        State.get().expanded.add(item.id);
        State.set({ view: 'tag', cursorDay: item.day, focusId: item.id });
      } else {
        State.toggleExpanded(item.id);
      }
      return;
    }

    if (key === 'e' || key === 'E') {
      ev.preventDefault();
      State.get().expanded.add(item.id);
      if (kompakt) State.set({ view: 'tag', cursorDay: item.day, editingId: item.id, focusId: item.id });
      else State.set({ editingId: item.id });
      return;
    }

    if (key === 'Delete') {
      ev.preventDefault();
      // Nach dem Loeschen soll der Nachbar den Fokus bekommen
      const zeilen = zeilenIn(umgebung(zeile));
      const index = zeilen.indexOf(zeile);
      const nachbar = zeilen[index + 1] || zeilen[index - 1];
      if (nachbar) State.setFocus(nachbar.dataset.id);
      State.remove(item.id);
      return;
    }

    if (key === 'x' || key === 'X') {
      ev.preventDefault();
      State.toggleSelect(item.id);
      return;
    }

    if (key === 'm' || key === 'M') {
      ev.preventDefault();
      const ziel = item.day < Dates.todayKey() ? Dates.todayKey() : Dates.addDays(item.day, 1);
      State.move(State.selectionOr(item.id), ziel);
      return;
    }

    if (key === 'Escape' && State.get().selected.size) {
      ev.stopPropagation();
      State.clearSelection();
    }
  }

  function tastenhinweis() {
    return '↑↓ blättern · Leertaste erledigt · e bearbeiten · Entf löscht · x wählt aus';
  }

  /**
   * Nach jedem Neuaufbau: Fokus zurueckholen und dafuer sorgen, dass genau eine
   * Zeile im Tab-Lauf liegt.
   */
  function finishRender(root) {
    const state = State.get();
    Util.restoreFocus(root, state.focusId ? 'item:' + state.focusId : null);

    const zeilen = zeilenIn(root);
    if (zeilen.length && !zeilen.some((zeile) => zeile.tabIndex === 0)) zeilen[0].tabIndex = 0;
  }

  // ---------------------------------------------------------------- Bausteine

  function tagesfuss(day, all, stats) {
    const offene = all.filter((i) => i.status !== 'erledigt');

    return h('div', { class: 'tafel__fuss' },
      h('button', { class: 'linkbtn', onclick: () => Dialogs.copyDay(day) }, 'Tag kopieren'),
      h('button', {
        class: 'linkbtn',
        onclick: () => State.move(offene.map((i) => i.id), Dates.addDays(day, 1)),
        disabled: !offene.length,
      }, 'Alles Offene auf morgen'),
      h('button', {
        class: 'linkbtn linkbtn--danger',
        onclick: () => State.clearDone(day),
        disabled: !stats.erledigt,
      }, 'Erledigte aufräumen'),
      h('span', { class: 'tafel__hinweis' }, tastenhinweis())
    );
  }

  /** Fortschrittsbalken nach §3.5: 72 x 3 px, ohne Radius, ohne Grün. */
  function fortschritt(erledigt, gesamt) {
    const pct = gesamt ? Math.round((erledigt / gesamt) * 100) : 0;
    return h('span', {
      class: 'fortschritt',
      title: `${erledigt} von ${gesamt} erledigt (${pct} %)`,
      role: 'img',
      'aria-label': `${pct} Prozent erledigt`,
    },
      h('span', { class: 'fortschritt__fuellung', style: { width: pct + '%' } })
    );
  }

  /**
   * Zeilenzahl vermerken. Erst ab einer wirklich langen Liste lohnt sich
   * content-visibility; die Gestaltung haengt sich an `is-viele` (§3.3).
   */
  function merkeZeilenzahl(node, anzahl) {
    node.dataset.zeilen = String(anzahl);
    if (anzahl > VIELE_ZEILEN) node.classList.add('is-viele');
  }

  return { renderDay, renderWeek };
})();
