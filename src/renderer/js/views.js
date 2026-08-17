/*
 * Die beiden Hauptansichten: ein Tag im Detail, eine Woche im Ueberblick.
 *
 * Hier sitzt auch die Tastaturbedienung der Listen: die Ereignisse haengen an
 * den Listen-Containern, nicht an jeder einzelnen Karte.
 */
window.Views = (function () {
  const { h } = Util;

  /** Wie viele ueberfaellige Aufgaben ungefragt angezeigt werden. */
  const OVERDUE_PREVIEW = 8;

  const GROUPINGS = [
    { id: 'keine', label: 'Ohne Gruppierung' },
    { id: 'status', label: 'Nach Status' },
    { id: 'quelle', label: 'Nach Quelle' },
  ];

  const CARD_SELECTOR = '[data-fkey^="item:"]';

  // ------------------------------------------------------------ Tagesansicht

  function renderDay(root) {
    const state = State.get();
    const day = state.cursorDay;
    const items = State.itemsForDay(day);
    const all = State.allForDay(day);
    const stats = State.counts(all);
    const overdueItems = State.overdue(day);

    // Reihenfolge auf dem Schirm - Grundlage fuer die Umschalt-Auswahl
    State.setOrder([...overdueItems.map((i) => i.id), ...items.map((i) => i.id)]);

    const section = h('section', { class: 'day' });
    section.appendChild(dayHeader(day, stats, items.length, all.length));

    if (overdueItems.length) section.appendChild(renderOverdue(overdueItems, day));
    if (state.selected.size) section.appendChild(bulkBar(day));

    // Tagesliste (zugleich Ablageziel fuer Drag & Drop)
    const list = h('div', { class: 'day__list' });
    ItemCard.makeDropTarget(list, day);
    bindList(list);

    if (!items.length) {
      list.appendChild(emptyDay(all.length));
    } else if (state.groupBy === 'keine') {
      for (const item of items) list.appendChild(ItemCard.render(item));
    } else {
      for (const group of groupItems(items, state.groupBy)) list.appendChild(renderGroup(group));
    }
    section.appendChild(list);

    // Ablagezonen - erscheinen erst, waehrend eine Karte gezogen wird
    section.appendChild(dropZones(day));

    // Fusszeile der Tagesansicht
    const openItems = all.filter((i) => i.status !== 'erledigt');
    section.appendChild(
      h('div', { class: 'day__footer' },
        h('button', {
          class: 'linkbtn',
          onclick: () => Dialogs.copyDay(day),
        }, 'Tag kopieren'),
        h('button', {
          class: 'linkbtn',
          onclick: () => State.move(openItems.map((i) => i.id), Dates.addDays(day, 1)),
          disabled: !openItems.length,
        }, 'Alles Offene auf morgen'),
        h('button', {
          class: 'linkbtn linkbtn--danger',
          onclick: () => State.clearDone(day),
          disabled: !stats.erledigt,
        }, 'Erledigte aufräumen'),
        h('span', { class: 'day__footerInfo' }, keyboardHint())
      )
    );

    root.appendChild(section);
    finishRender(root);
  }

  function dayHeader(day, stats, shown, total) {
    const offen = stats.offen + stats.aktiv + stats.wartet;

    return h('div', { class: 'day__header' },
      h('div', { class: 'day__heading' },
        h('h2', { class: 'day__title' }, Dates.formatLong(day)),
        day === Dates.todayKey() ? h('span', { class: 'pill pill--today' }, 'Heute') : null,
        h('span', { class: 'day__kw' }, Dates.isoWeekLabel(day)),
        shown !== total ? h('span', { class: 'day__filtered' }, `${shown} von ${total} sichtbar`) : null
      ),
      h('div', { class: 'day__stats' },
        statChip('offen', offen),
        statChip('erledigt', stats.erledigt),
        stats.gesamt
          ? h('span', { class: 'day__progress', title: 'Anteil erledigt' },
              progressBar(stats.erledigt, stats.gesamt),
              h('span', { class: 'day__progressText' }, `${stats.erledigt}/${stats.gesamt}`))
          : null,
        groupSelect()
      )
    );
  }

  /** Auswahlfeld fuer die Gruppierung der Tagesliste. */
  function groupSelect() {
    const state = State.get();
    const select = h('select', {
      class: 'day__group field field--slim',
      title: 'Tagesliste gruppieren',
      'aria-label': 'Gruppierung',
    },
      ...GROUPINGS.map((g) => h('option', { value: g.id, selected: g.id === state.groupBy }, g.label))
    );
    select.addEventListener('change', () => State.set({ groupBy: select.value }));
    return select;
  }

  /** Aufgaben nach Status oder Quelle buendeln - leere Gruppen fallen weg. */
  function groupItems(items, mode) {
    const defs = mode === 'quelle' ? Model.SOURCES : Model.STATUSES;
    const buckets = new Map(defs.map((d) => [d.id, []]));

    for (const item of items) {
      const key = mode === 'quelle' ? Model.sourceById(item.source).id : Model.statusById(item.status).id;
      buckets.get(key).push(item);
    }

    return defs
      .filter((d) => buckets.get(d.id).length)
      .map((d) => ({
        id: d.id,
        label: mode === 'quelle' ? `${d.icon} ${d.label}` : d.label,
        items: buckets.get(d.id),
      }));
  }

  function renderGroup(group) {
    const box = h('div', { class: 'group', dataset: { group: group.id } },
      h('div', { class: 'group__head' },
        h('span', { class: 'group__label' }, group.label),
        ' · ',
        h('span', { class: 'group__count' }, String(group.items.length))
      )
    );
    const inner = h('div', { class: 'group__list' });
    for (const item of group.items) inner.appendChild(ItemCard.render(item));
    box.appendChild(inner);
    return box;
  }

  function emptyDay(totalCount) {
    if (totalCount) {
      return emptyState(
        'Nichts passt zum Filter.',
        'Filter zurücksetzen',
        () => State.set({ search: '', filterStatus: 'alle', filterSource: null, filterTag: null })
      );
    }
    return emptyState('Noch nichts erfasst für diesen Tag.', null, null,
      'Oben eintippen und Enter drücken – oder Strg + N.');
  }

  // -------------------------------------------------------------- Ueberfaellig

  function renderOverdue(items, targetDay) {
    const state = State.get();
    const open = state.showOverdue;
    const groups = groupByDay(items);
    const shown = open && !state.showAllOverdue ? items.slice(0, OVERDUE_PREVIEW) : items;

    const head = h('div', { class: 'overdue__head' },
      h('button', {
        class: 'overdue__toggle',
        'aria-expanded': String(open),
        onclick: () => State.set({ showOverdue: !open }),
      }, `${open ? '▾' : '▸'} Noch offen aus früheren Tagen (${items.length})`),
      h('span', { class: 'overdue__span' },
        `${Util.plural(groups.length, 'Tag', 'Tage')} · ältestes ${ageLabel(items[0].day)}`),
      h('button', {
        class: 'linkbtn',
        title: 'Alle diese Aufgaben auf den angezeigten Tag legen',
        onclick: () => State.move(items.map((i) => i.id), targetDay),
      }, 'Alle herholen')
    );

    const box = h('div', { class: 'overdue' + (open ? ' is-open' : '') }, head);

    if (open) {
      const list = h('div', { class: 'overdue__list' });
      bindList(list);

      for (const group of groupByDay(shown)) list.appendChild(overdueGroup(group, targetDay));

      if (shown.length < items.length) {
        list.appendChild(
          h('button', {
            class: 'linkbtn overdue__more',
            onclick: () => State.set({ showAllOverdue: true }),
          }, `Alle ${items.length} anzeigen (${items.length - shown.length} weitere)`)
        );
      } else if (state.showAllOverdue && items.length > OVERDUE_PREVIEW) {
        list.appendChild(
          h('button', {
            class: 'linkbtn overdue__more',
            onclick: () => State.set({ showAllOverdue: false }),
          }, 'Weniger anzeigen')
        );
      }

      box.appendChild(list);
    }

    return box;
  }

  function overdueGroup(group, targetDay) {
    const box = h('div', { class: 'overdue__group' },
      h('div', { class: 'overdue__groupHead' },
        h('span', { class: 'overdue__date' }, `${Dates.shortWeekday(group.day)}, ${Dates.formatShort(group.day)}`),
        // Trennzeichen als eigene Textknoten: in einer Flex-Zeile verschwindet
        // reiner Leerraum, ohne eigene Gestaltung bleibt die Zeile lesbar.
        ' · ',
        h('span', { class: 'overdue__age' }, ageLabel(group.day)),
        ' ',
        h('button', {
          class: 'linkbtn',
          title: 'Nur die Aufgaben dieses Tages herholen',
          onclick: () => State.move(group.items.map((i) => i.id), targetDay),
        }, 'herholen')
      )
    );

    const list = h('div', { class: 'overdue__groupList' });
    for (const item of group.items) list.appendChild(ItemCard.render(item, { hideDay: true }));
    box.appendChild(list);
    return box;
  }

  /** Nach Tag buendeln - die Liste kommt bereits sortiert an. */
  function groupByDay(items) {
    const out = [];
    let current = null;
    for (const item of items) {
      if (!current || current.day !== item.day) out.push((current = { day: item.day, items: [] }));
      current.items.push(item);
    }
    return out;
  }

  function ageLabel(day) {
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

    const section = h('section', { class: 'week' });

    const perDay = days.map((day) => {
      const shown = State.itemsForDay(day);
      const all = State.allForDay(day);
      const stats = State.counts(all);
      return { day, shown, all, stats, offen: stats.offen + stats.aktiv + stats.wartet };
    });

    const weekStats = perDay.reduce(
      (acc, d) => {
        acc.gesamt += d.stats.gesamt;
        acc.erledigt += d.stats.erledigt;
        acc.offen += d.offen;
        if (d.day < today) acc.ueberfaellig += d.offen;
        return acc;
      },
      { gesamt: 0, erledigt: 0, offen: 0, ueberfaellig: 0 }
    );

    section.appendChild(
      h('div', { class: 'day__header' },
        h('div', { class: 'day__heading' },
          h('h2', { class: 'day__title' },
            `${Dates.isoWeekLabel(first)} · ${Dates.formatShort(first)} – ${Dates.formatShort(last)}`),
          days.includes(today) ? h('span', { class: 'pill pill--today' }, 'Diese Woche') : null,
          weekStats.ueberfaellig
            ? h('span', { class: 'pill pill--overdue', title: 'offen aus vergangenen Tagen dieser Woche' },
                `${weekStats.ueberfaellig} überfällig`)
            : null
        ),
        h('div', { class: 'day__stats' },
          statChip('offen', weekStats.offen),
          statChip('erledigt', weekStats.erledigt),
          weekStats.gesamt
            ? h('span', { class: 'day__progress' },
                progressBar(weekStats.erledigt, weekStats.gesamt),
                h('span', { class: 'day__progressText' }, `${weekStats.erledigt}/${weekStats.gesamt}`))
            : null
        )
      )
    );

    // Reihenfolge auf dem Schirm - Grundlage fuer die Umschalt-Auswahl
    State.setOrder(perDay.flatMap((d) => d.shown.map((i) => i.id)));

    const grid = h('div', { class: 'week__grid', dataset: { cols: String(days.length) } });

    for (const entry of perDay) {
      const { day, shown, stats, offen } = entry;
      const isPast = day < today;

      const col = h('div', {
        class:
          'week__col' +
          (day === today ? ' is-today' : '') +
          (Dates.isWeekend(day) ? ' is-weekend' : '') +
          (isPast && offen ? ' is-overdue' : ''),
        dataset: { day },
      });

      col.appendChild(
        h('div', { class: 'week__colHead' },
          h('button', {
            class: 'week__dayBtn',
            title: 'Diesen Tag im Detail zeigen',
            onclick: () => State.set({ view: 'tag', cursorDay: day }),
          },
            h('span', { class: 'week__weekday' }, Dates.shortWeekday(day)),
            h('span', { class: 'week__date' }, Dates.formatShort(day))
          ),
          h('span', { class: 'week__counts' },
            offen
              ? h('span', {
                  class: 'count count--open' + (isPast ? ' count--overdue' : ''),
                  title: isPast ? 'offen und überfällig' : 'offen',
                }, String(offen))
              : null,
            stats.erledigt ? h('span', { class: 'count count--done', title: 'erledigt' }, String(stats.erledigt)) : null
          )
        )
      );

      // Tagessumme auf einen Blick
      col.appendChild(
        stats.gesamt
          ? h('div', { class: 'week__sum', title: `${stats.erledigt} von ${stats.gesamt} erledigt` },
              progressBar(stats.erledigt, stats.gesamt))
          : h('div', { class: 'week__sum week__sum--empty' })
      );

      const list = h('div', { class: 'week__list' });
      ItemCard.makeDropTarget(list, day);
      bindList(list);
      for (const item of shown) list.appendChild(ItemCard.renderCompact(item));
      if (!shown.length) list.appendChild(h('div', { class: 'week__empty' }, '–'));
      col.appendChild(list);

      col.appendChild(
        h('button', {
          class: 'week__add',
          title: 'Aufgabe für diesen Tag erfassen',
          onclick: () => App.captureInto(day),
        }, '+')
      );

      grid.appendChild(col);
    }

    section.appendChild(grid);

    section.appendChild(
      h('div', { class: 'day__footer' },
        h('button', { class: 'linkbtn', onclick: () => Dialogs.copyWeek(days) }, 'Woche kopieren'),
        h('button', { class: 'linkbtn', onclick: () => Dialogs.openExport() }, 'Woche exportieren …'),
        h('span', { class: 'day__footerInfo' },
          `${Util.plural(weekStats.gesamt, 'Aufgabe', 'Aufgaben')} in dieser Woche · ` +
          `${weekStats.offen} offen`)
      )
    );

    root.appendChild(section);
    finishRender(root);
  }

  // ------------------------------------------------------------ Massenaktionen

  function bulkBar(day) {
    const ids = [...State.get().selected];
    return h('div', { class: 'bulkbar', role: 'group', 'aria-label': 'Auswahl' },
      h('span', { class: 'bulkbar__count' }, `${Util.plural(ids.length, 'Aufgabe', 'Aufgaben')} ausgewählt`),
      h('button', { class: 'btn btn--slim', onclick: () => State.setStatusFor(ids, 'erledigt') }, '✓ Erledigt'),
      h('button', { class: 'btn btn--slim', onclick: () => State.setStatusFor(ids, 'offen') }, '○ Offen'),
      h('button', { class: 'btn btn--slim', onclick: () => State.moveSelection(Dates.addDays(day, 1)) }, '→ Morgen'),
      h('button', {
        class: 'btn btn--slim',
        onclick: () => State.moveSelection(Dates.startOfWeek(Dates.addDays(day, 7))),
      }, '→ Nächste Woche'),
      h('span', { class: 'bulkbar__spacer' }),
      h('button', { class: 'linkbtn', onclick: () => State.clearSelection() }, 'Auswahl aufheben')
    );
  }

  // ------------------------------------------------------- Ablagezonen (Drag)

  let zoneBar = null;

  function dropZones(day) {
    const targets = [];
    if (day !== Dates.todayKey()) targets.push({ label: 'Heute', day: Dates.todayKey() });
    targets.push({ label: 'Morgen', day: Dates.addDays(day, 1) });
    targets.push({ label: 'Nächste Woche', day: Dates.startOfWeek(Dates.addDays(day, 7)) });

    const bar = h('div', { class: 'dropzones', 'aria-hidden': 'true' });
    for (const target of targets) {
      const zone = h('div', { class: 'dropzone', dataset: { day: target.day } },
        h('span', { class: 'dropzone__label' }, '→ ' + target.label),
        h('span', { class: 'dropzone__date' }, Dates.formatShort(target.day))
      );
      ItemCard.makeDropTarget(zone, target.day);
      bar.appendChild(zone);
    }
    bar.hidden = true;
    zoneBar = bar;
    return bar;
  }

  function showZones(on) {
    if (zoneBar && zoneBar.isConnected) zoneBar.hidden = !on;
  }

  // Einmalig registriert: die Zonen erscheinen, sobald eine Karte gezogen wird.
  document.addEventListener('dragstart', (ev) => {
    const node = ev.target;
    if (node && node.classList && node.classList.contains('item')) showZones(true);
  }, true);
  document.addEventListener('dragend', () => showZones(false), true);
  document.addEventListener('drop', () => showZones(false), true);

  // --------------------------------------------------------------- Tastatur
  //
  // Die Listener haengen am Listen-Container, nicht an den Karten: eine Liste
  // mit tausend Aufgaben braucht so trotzdem nur eine Handvoll Ereignisse.

  function bindList(list) {
    list.addEventListener('keydown', onListKey);
    list.addEventListener('focusin', (ev) => {
      const card = cardOf(ev.target);
      if (card) markFocused(card);
    });
  }

  function cardOf(node) {
    return node && node.closest ? node.closest(CARD_SELECTOR) : null;
  }

  function cardsIn(scope) {
    return Util.els(CARD_SELECTOR, scope);
  }

  /**
   * Karte als aktuelle Karte markieren (Klasse + Tab-Reihenfolge).
   * Gesucht wird nur nach der bisher markierten Karte, nicht nach allen -
   * bei tausend Aufgaben ist das der Unterschied pro Pfeiltaste.
   */
  function markFocused(card) {
    const scope = card.closest('.viewroot') || document;
    for (const other of Util.els('.is-focused, [tabindex="0"]', scope)) {
      if (other === card || !(other.dataset.fkey || '').startsWith('item:')) continue;
      other.classList.remove('is-focused');
      other.tabIndex = -1;
    }
    card.classList.add('is-focused');
    card.tabIndex = 0;
    State.setFocus(card.dataset.id);
  }

  function focusCard(card) {
    if (!card) return;
    markFocused(card);
    card.focus();
  }

  function onListKey(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // gehoert der Kopfzeile
    if (Util.isTextInput(ev.target)) return; // jemand tippt gerade

    const card = cardOf(ev.target);
    if (!card) return;
    const item = State.itemById(card.dataset.id);
    if (!item) return;

    const compact = card.classList.contains('mini');
    const key = ev.key;

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      ev.preventDefault();
      const scope = card.closest('.week__col') || card.closest('section') || document;
      const cards = cardsIn(scope);
      const next = cards[cards.indexOf(card) + (key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      if (ev.shiftKey) State.selectRange(next.dataset.id);
      focusCard(next);
      return;
    }

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const col = card.closest('.week__col');
      if (!col) return;
      ev.preventDefault();
      const cols = Util.els('.week__col', col.parentNode);
      const target = cols[cols.indexOf(col) + (key === 'ArrowRight' ? 1 : -1)];
      if (!target) return;
      const row = cardsIn(col).indexOf(card);
      const candidates = cardsIn(target);
      focusCard(candidates[Math.min(row, candidates.length - 1)]);
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
      if (compact) {
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
      if (compact) State.set({ view: 'tag', cursorDay: item.day, editingId: item.id, focusId: item.id });
      else State.set({ editingId: item.id });
      return;
    }

    if (key === 'Delete') {
      ev.preventDefault();
      // Nach dem Loeschen soll der Nachbar den Fokus bekommen
      const cards = cardsIn(card.closest('.week__col') || card.closest('section') || document);
      const index = cards.indexOf(card);
      const neighbour = cards[index + 1] || cards[index - 1];
      if (neighbour) State.setFocus(neighbour.dataset.id);
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
      const target = item.day < Dates.todayKey() ? Dates.todayKey() : Dates.addDays(item.day, 1);
      State.move(State.selectionOr(item.id), target);
      return;
    }

    if (key === 'Escape' && State.get().selected.size) {
      ev.stopPropagation();
      State.clearSelection();
    }
  }

  function keyboardHint() {
    return '↑↓ blättern · Leertaste erledigt · e bearbeiten · Entf löscht · x wählt aus';
  }

  /**
   * Nach jedem Neuaufbau: Fokus zurueckholen und dafuer sorgen, dass genau eine
   * Karte im Tab-Lauf liegt.
   */
  function finishRender(root) {
    const state = State.get();
    Util.restoreFocus(root, state.focusId ? 'item:' + state.focusId : null);

    const cards = cardsIn(root);
    if (cards.length && !cards.some((card) => card.tabIndex === 0)) cards[0].tabIndex = 0;
  }

  // ---------------------------------------------------------------- Bausteine

  function statChip(kind, count) {
    return h('span', { class: 'stat stat--' + kind },
      h('strong', null, String(count)),
      ' ' + (kind === 'offen' ? 'offen' : 'erledigt')
    );
  }

  function progressBar(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return h('span', { class: 'bar', title: `${pct} % erledigt` },
      h('span', { class: 'bar__fill', style: { width: pct + '%' } })
    );
  }

  function emptyState(text, actionLabel, onAction, hint) {
    return h('div', { class: 'empty' },
      h('p', null, text),
      hint ? h('p', { class: 'empty__hint' }, hint) : null,
      actionLabel ? h('button', { class: 'btn', onclick: onAction }, actionLabel) : null
    );
  }

  return { renderDay, renderWeek };
})();
