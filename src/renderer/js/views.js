/*
 * Die beiden Hauptansichten: ein Tag im Detail, eine Woche im Ueberblick.
 */
window.Views = (function () {
  const { h } = Util;

  // ------------------------------------------------------------ Tagesansicht

  function renderDay(root) {
    const state = State.get();
    const day = state.cursorDay;
    const items = State.itemsForDay(day);
    const all = State.allForDay(day);
    const stats = State.counts(all);

    const section = h('section', { class: 'day' });

    // Kopfzeile mit Datum und Zaehlern
    section.appendChild(
      h('div', { class: 'day__header' },
        h('div', { class: 'day__heading' },
          h('h2', { class: 'day__title' }, Dates.formatLong(day)),
          day === Dates.todayKey() ? h('span', { class: 'pill pill--today' }, 'Heute') : null,
          h('span', { class: 'day__kw' }, Dates.isoWeekLabel(day))
        ),
        h('div', { class: 'day__stats' },
          statChip('offen', stats.offen + stats.aktiv + stats.wartet),
          statChip('erledigt', stats.erledigt),
          stats.gesamt ? h('span', { class: 'day__progress', title: 'Anteil erledigt' },
            progressBar(stats.erledigt, stats.gesamt)) : null
        )
      )
    );

    // Offene Aufgaben aus der Vergangenheit
    const overdue = State.overdue(day);
    if (overdue.length) section.appendChild(renderOverdue(overdue, day));

    // Tagesliste (zugleich Ablageziel fuer Drag & Drop)
    const list = h('div', { class: 'day__list' });
    ItemCard.makeDropTarget(list, day);

    if (!items.length) {
      list.appendChild(emptyState(all.length ? 'Nichts passt zum Filter.' : 'Noch nichts erfasst für diesen Tag.',
        all.length ? 'Filter zurücksetzen' : null,
        all.length ? () => State.set({ search: '', filterStatus: 'alle', filterSource: null, filterTag: null }) : null));
    } else {
      for (const item of items) list.appendChild(ItemCard.render(item));
    }
    section.appendChild(list);

    // Fusszeile der Tagesansicht
    section.appendChild(
      h('div', { class: 'day__footer' },
        h('button', {
          class: 'linkbtn',
          onclick: () => Dialogs.copyDay(day),
        }, 'Tag kopieren'),
        h('button', {
          class: 'linkbtn',
          onclick: () => State.move(all.filter((i) => i.status !== 'erledigt').map((i) => i.id), Dates.addDays(day, 1)),
          disabled: !all.some((i) => i.status !== 'erledigt'),
        }, 'Alles Offene auf morgen'),
        h('button', {
          class: 'linkbtn linkbtn--danger',
          onclick: () => State.clearDone(day),
          disabled: !stats.erledigt,
        }, 'Erledigte aufräumen')
      )
    );

    root.appendChild(section);
  }

  function renderOverdue(items, targetDay) {
    const open = State.get().showOverdue;

    const box = h('div', { class: 'overdue' + (open ? ' is-open' : '') },
      h('div', { class: 'overdue__head' },
        h('button', {
          class: 'overdue__toggle',
          onclick: () => State.set({ showOverdue: !open }),
        }, `${open ? '▾' : '▸'} Noch offen aus früheren Tagen (${items.length})`),
        h('button', {
          class: 'linkbtn',
          title: 'Alle diese Aufgaben auf den angezeigten Tag legen',
          onclick: () => State.move(items.map((i) => i.id), targetDay),
        }, 'Alle herholen')
      )
    );

    if (open) {
      const list = h('div', { class: 'overdue__list' });
      for (const item of items) {
        list.appendChild(
          h('div', { class: 'overdue__row' },
            h('span', { class: 'overdue__date' }, Dates.formatShort(item.day)),
            ItemCard.render(item, { hideDay: true })
          )
        );
      }
      box.appendChild(list);
    }

    return box;
  }

  // ----------------------------------------------------------- Wochenansicht

  function renderWeek(root) {
    const state = State.get();
    const days = State.weekDays();
    const today = Dates.todayKey();

    const section = h('section', { class: 'week' });

    const inWeek = state.items.filter((i) => days.includes(i.day));
    const stats = State.counts(inWeek);

    section.appendChild(
      h('div', { class: 'day__header' },
        h('div', { class: 'day__heading' },
          h('h2', { class: 'day__title' },
            `${Dates.isoWeekLabel(days[0])} · ${Dates.formatShort(days[0])} – ${Dates.formatShort(days[days.length - 1])}`),
          days.includes(today) ? h('span', { class: 'pill pill--today' }, 'Diese Woche') : null
        ),
        h('div', { class: 'day__stats' },
          statChip('offen', stats.offen + stats.aktiv + stats.wartet),
          statChip('erledigt', stats.erledigt),
          stats.gesamt ? h('span', { class: 'day__progress' }, progressBar(stats.erledigt, stats.gesamt)) : null
        )
      )
    );

    const grid = h('div', { class: 'week__grid', dataset: { cols: String(days.length) } });

    for (const day of days) {
      const dayItems = State.itemsForDay(day);
      const dayAll = State.allForDay(day);
      const dayStats = State.counts(dayAll);
      const openCount = dayStats.offen + dayStats.aktiv + dayStats.wartet;

      const col = h('div', {
        class: 'week__col' + (day === today ? ' is-today' : '') + (Dates.isWeekend(day) ? ' is-weekend' : ''),
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
            openCount ? h('span', { class: 'count count--open', title: 'offen' }, String(openCount)) : null,
            dayStats.erledigt ? h('span', { class: 'count count--done', title: 'erledigt' }, String(dayStats.erledigt)) : null
          )
        )
      );

      const list = h('div', { class: 'week__list' });
      ItemCard.makeDropTarget(list, day);
      for (const item of dayItems) list.appendChild(ItemCard.renderCompact(item));
      if (!dayItems.length) list.appendChild(h('div', { class: 'week__empty' }, '–'));
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
          `${Util.plural(stats.gesamt, 'Aufgabe', 'Aufgaben')} in dieser Woche`)
      )
    );

    root.appendChild(section);
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

  function emptyState(text, actionLabel, onAction) {
    return h('div', { class: 'empty' },
      h('p', null, text),
      actionLabel ? h('button', { class: 'btn', onclick: onAction }, actionLabel) : null
    );
  }

  return { renderDay, renderWeek };
})();
