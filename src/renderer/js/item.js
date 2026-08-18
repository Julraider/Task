/*
 * Darstellung einer einzelnen Aufgabe.
 *
 * Eine Aufgabe ist keine Karte, sondern eine Kursbuchzeile (Leitfaden 3.3):
 * 32 px hoch, ohne Radius, ohne Schatten, unten eine Haarlinie, und die
 * Spalten sitzen in jeder Ansicht an derselben x-Position:
 *
 *   Randstrich | Bundsteg | Status 24 | Luecke | Quelle 16 | Luecke | Titel … | Marken / Aktionen
 *   0            0-8        8-32        32-40    40-56       56-64    64 ->     rechts
 *
 * Der aufgeklappte Bereich, der Editor und die Notizen fluchten mit dem
 * Titel (Textkante 64 px). Emoji kommen hier nicht mehr vor - die
 * Oberflaeche zeichnet ihre Icons ueber `Icons.svg()` (Leitfaden 7).
 *
 * Fuer die Wochenansicht gibt es dieselbe Zeile in kompakt (`renderCompact`).
 */
window.ItemCard = (function () {
  const { h } = Util;

  const DRAG_TYPE = 'application/x-tagwerk-item';

  /** Trennzeichen der Metazeile - eigener Textknoten, damit Flex nichts schluckt. */
  const SEP = ' · ';

  // -------------------------------------------------------------- Bausteine

  /**
   * Marken rechts vom Titel: `!!` · `#tag` · `INC0012345` · Uhrzeit.
   * Alles Text, keine Kapseln (Leitfaden 9).
   */
  function marks(item, options) {
    const out = [];

    if (item.priority > 0) {
      const prio = Model.priorityById(item.priority);
      out.push(
        h('span', {
          class: 'mark mark--prio mark--prio' + item.priority,
          title: 'Priorität: ' + prio.label,
        }, prio.icon)
      );
    }

    for (const tag of item.tags || []) {
      out.push(
        h('button', {
          class: 'mark mark--tag',
          type: 'button',
          title: 'Nach #' + tag + ' filtern',
          onclick: (ev) => {
            ev.stopPropagation();
            const current = State.get().filterTag;
            State.set({ filterTag: current === tag ? null : tag });
          },
        }, '#' + tag)
      );
    }

    if (item.ref) out.push(h('span', { class: 'mark mark--ref', title: 'Referenz' }, item.ref));

    // Steht die Aufgabe an einem anderen Tag, gehoert das Datum dazu - ausser
    // die Liste zeigt es ohnehin schon in einer eigenen Spalte.
    if (item.day !== State.get().cursorDay && !(options && options.hideDay)) {
      out.push(h('span', { class: 'mark mark--day' }, Dates.formatShort(item.day)));
    }

    // Erledigtes zeigt die Uhrzeit des Abhakens, alles andere die Erfassung.
    const done = item.status === 'erledigt' && item.doneAt;
    out.push(
      h('span', {
        class: 'mark mark--time',
        title: (done ? 'Erledigt ' : 'Erfaßt ') + Dates.formatTime(done ? item.doneAt : item.createdAt) + ' Uhr',
      }, Dates.formatTime(done ? item.doneAt : item.createdAt))
    );

    return out;
  }

  /** Metazeile im aufgeklappten Bereich: Quelle im Klartext, Zeiten, Referenz. */
  function metaLine(item, options) {
    const source = Model.sourceById(item.source);
    const parts = [h('span', { class: 'meta__source' }, source.label)];

    parts.push(h('span', { class: 'meta__time' }, 'erfaßt ' + Dates.formatTime(item.createdAt) + ' Uhr'));

    if (item.day !== State.get().cursorDay && !(options && options.hideDay)) {
      parts.push(h('span', { class: 'meta__day' }, Dates.formatShort(item.day)));
    }
    if (item.status === 'erledigt' && item.doneAt) {
      parts.push(h('span', { class: 'meta__done' }, 'erledigt ' + Dates.formatTime(item.doneAt) + ' Uhr'));
    }
    if (item.ref) parts.push(h('span', { class: 'meta__ref' }, item.ref));

    // Trennzeichen zwischen die Angaben legen, nicht an ihre Enden.
    const line = h('div', { class: 'item__meta' });
    parts.forEach((part, i) => {
      if (i) line.appendChild(document.createTextNode(SEP));
      line.appendChild(part);
    });
    return line;
  }

  /**
   * Statusspalte: 24 px Trefferflaeche, Glyph 16 px.
   * Die Form traegt die Bedeutung, die Farbe verstaerkt sie nur (Leitfaden 1.3).
   */
  function statusButton(item) {
    const status = Model.statusById(item.status);
    const next = Model.statusById(Model.nextStatus(item.status));
    return h('button', {
      class: 'item__status',
      type: 'button',
      title: 'Weiter zu: ' + next.label,
      'aria-label': status.label,
      onclick: (ev) => {
        ev.stopPropagation();
        State.cycleStatus(item);
      },
    }, Icons.svg(status.iconId));
  }

  /** Quellenspalte: 16 px Icon, Klarname als `title` (Leitfaden 7.2). */
  function sourceCell(item) {
    const source = Model.sourceById(item.source);
    return h('span', {
      class: 'item__source',
      title: source.label,
      role: 'img',
      'aria-label': 'Quelle: ' + source.label,
    }, Icons.svg(source.iconId));
  }

  /** Ein Aktionsknopf der Zeile - 24 x 24, nur Icon. */
  function action(iconId, label, onclick, extra) {
    return h('button', {
      class: 'item__act' + (extra ? ' ' + extra : ''),
      type: 'button',
      title: label,
      'aria-label': label,
      onclick: (ev) => {
        ev.stopPropagation();
        onclick();
      },
    }, Icons.svg(iconId));
  }

  /**
   * Zeile zum Ziehen freigeben.
   * Gehoert sie zu einer Mehrfachauswahl, wandert die ganze Auswahl mit.
   */
  function makeDraggable(node, item) {
    node.draggable = true;
    node.addEventListener('dragstart', (ev) => {
      const ids = State.selectionOr(item.id);
      ev.dataTransfer.setData(DRAG_TYPE, ids.join(' '));
      ev.dataTransfer.setData('text/plain', ids.length > 1 ? `${ids.length} Aufgaben` : item.title);
      ev.dataTransfer.effectAllowed = 'move';
      node.classList.add('is-dragging');
      // Merker fuer die Ansicht: solange gezogen wird, zeigt sie Ablagezonen
      document.body.classList.add('is-draggingItem');
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('is-dragging');
      document.body.classList.remove('is-draggingItem');
    });
  }

  // ------------------------------------------------------------ Volle Zeile

  function render(item, options) {
    const state = State.get();
    const expanded = state.expanded.has(item.id);
    const editing = state.editingId === item.id;
    const selected = state.selected.has(item.id);
    const focused = state.focusId === item.id;
    const isOverdue = item.status !== 'erledigt' && item.day < Dates.todayKey();

    const card = h('article', {
      class:
        'item' +
        (expanded ? ' is-expanded' : '') +
        (editing ? ' is-editing' : '') +
        (selected ? ' is-selected' : '') +
        (focused ? ' is-focused' : '') +
        (isOverdue ? ' is-overdue' : ''),
      dataset: { id: item.id, status: item.status, prio: String(item.priority || 0), fkey: 'item:' + item.id },
      // Tastaturnavigation: nur die aktuelle Zeile liegt im Tab-Lauf,
      // zwischen den Zeilen geht es mit den Pfeiltasten weiter.
      tabindex: focused ? '0' : '-1',
      'aria-selected': selected ? 'true' : 'false',
    });

    // Der Bundsteg steht immer im Raster; ausgewaehlt bekommt er den Haken.
    const pick = h('span', { class: 'item__pick', 'aria-hidden': 'true' });
    if (selected) pick.appendChild(Icons.svg('auswahl', { size: 12 }));

    const row = h('div', {
      class: 'item__row',
      // Umschalt-Klick wuerde sonst Text markieren
      onmousedown: (ev) => {
        if (ev.shiftKey) ev.preventDefault();
      },
      onclick: (ev) => {
        if (ev.ctrlKey || ev.metaKey) {
          State.toggleSelect(item.id);
          return;
        }
        if (ev.shiftKey) {
          State.selectRange(item.id);
          return;
        }
        State.toggleExpanded(item.id);
      },
      ondblclick: () => {
        State.get().expanded.add(item.id);
        State.set({ editingId: item.id });
      },
    },
      pick,
      statusButton(item),
      sourceCell(item),
      h('span', { class: 'item__title' }, item.title),
      h('span', { class: 'item__marks' }, marks(item, options)),
      h('span', { class: 'item__actions' },
        action(
          'weiterschieben',
          // Was schon in der Vergangenheit liegt, gehoert nach vorn geholt -
          // "einen Tag weiter" waere dort immer noch Vergangenheit.
          isOverdue ? 'Auf heute holen' : 'Auf morgen schieben',
          () => {
            const target = isOverdue ? Dates.todayKey() : Dates.addDays(item.day, 1);
            State.move(State.selectionOr(item.id), target);
          }
        ),
        action('bearbeiten', 'Bearbeiten', () => {
          State.get().expanded.add(item.id);
          State.set({ editingId: item.id });
        }),
        action('loeschen', 'Löschen', () => State.remove(item.id), 'item__act--danger')
      )
    );

    card.appendChild(row);
    makeDraggable(card, item);

    // Aufgeklappt: alles fluchtet mit dem Titel (Textkante 64 px).
    if (expanded && !editing) {
      const details = h('div', { class: 'item__detail' });
      if (item.notes && item.notes.trim()) {
        details.appendChild(h('p', { class: 'item__notes' }, item.notes));
      } else {
        details.appendChild(
          h('button', {
            class: 'linkbtn',
            type: 'button',
            onclick: () => State.set({ editingId: item.id }),
          }, 'Notiz hinzufügen')
        );
      }
      details.appendChild(metaLine(item, options));
      card.appendChild(details);
    }

    if (editing) card.appendChild(editor(item));

    return card;
  }

  // ------------------------------------------------------------------ Editor

  function editor(item) {
    // Der getippte Zwischenstand liegt im State, nicht im DOM: baut ein
    // Ereignis aus einem anderen Fenster die Liste neu auf, ist er noch da.
    const running = State.draftFor(item.id);
    const values =
      running ||
      State.startDraft(item.id, {
        title: item.title,
        notes: item.notes || '',
        source: item.source,
        status: item.status,
        priority: String(item.priority || 0),
        day: item.day,
        ref: item.ref || '',
        tags: (item.tags || []).join(', '),
      });

    const form = h('form', {
      class: 'editor',
      onsubmit: (ev) => {
        ev.preventDefault();
        save();
      },
    });

    /** Feld an den Zwischenstand haengen und mit einem Fokus-Schluessel versehen. */
    function bind(node, key) {
      node.dataset.fkey = `editor:${item.id}:${key}`;
      node.addEventListener('input', () => {
        values[key] = node.value;
      });
      node.addEventListener('change', () => {
        values[key] = node.value;
      });
      return node;
    }

    const titleInput = bind(
      h('input', { class: 'editor__title', type: 'text', value: values.title, required: 'required' }),
      'title'
    );
    const notesInput = bind(
      h('textarea', { class: 'editor__notes', rows: '3', placeholder: 'Notizen, Links, Ansprechpartner …' }),
      'notes'
    );
    notesInput.value = values.notes;

    // In einem <option> gibt es kein SVG - hier steht der Klarname allein.
    const sourceSelect = bind(
      h('select', { class: 'editor__field' },
        ...Model.SOURCES.map((s) => h('option', { value: s.id, selected: s.id === values.source }, s.label))
      ),
      'source'
    );
    const statusSelect = bind(
      h('select', { class: 'editor__field' },
        ...Model.STATUSES.map((s) => h('option', { value: s.id, selected: s.id === values.status }, s.label))
      ),
      'status'
    );
    const prioSelect = bind(
      h('select', { class: 'editor__field' },
        ...Model.PRIORITIES.map((p) => h('option', { value: String(p.id), selected: String(p.id) === values.priority }, p.label))
      ),
      'priority'
    );
    const dayInput = bind(h('input', { class: 'editor__field', type: 'date', value: values.day }), 'day');
    const refInput = bind(
      h('input', { class: 'editor__field', type: 'text', value: values.ref, placeholder: 'INC0012345' }),
      'ref'
    );
    const tagsInput = bind(
      h('input', {
        class: 'editor__field',
        type: 'text',
        value: values.tags,
        placeholder: 'netzwerk, hardware',
      }),
      'tags'
    );

    function save() {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        return;
      }
      State.update(item.id, {
        title,
        notes: notesInput.value,
        source: sourceSelect.value,
        status: statusSelect.value,
        priority: Number(prioSelect.value),
        day: Dates.isValidKey(dayInput.value) ? dayInput.value : item.day,
        ref: refInput.value.trim() || null,
        tags: tagsInput.value
          .split(/[,\s]+/)
          .map((t) => t.trim().replace(/^#/, '').toLowerCase())
          .filter(Boolean),
      });
      State.set({ editingId: null });
    }

    function cancel() {
      State.set({ editingId: null });
    }

    form.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        cancel();
      }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        save();
      }
    });

    const field = (label, control) => h('label', { class: 'editor__label' }, h('span', null, label), control);

    form.append(
      titleInput,
      notesInput,
      h('div', { class: 'editor__grid' },
        field('Quelle', sourceSelect),
        field('Status', statusSelect),
        field('Priorität', prioSelect),
        field('Tag', dayInput),
        field('Referenz', refInput),
        field('Tags', tagsInput)
      ),
      h('div', { class: 'editor__buttons' },
        h('button', { class: 'btn btn--primary', type: 'submit' }, 'Speichern'),
        h('button', { class: 'btn', type: 'button', onclick: cancel }, 'Abbrechen'),
        h('span', { class: 'editor__hint' }, 'Strg+Enter speichert, Esc bricht ab'),
        h('button', {
          class: 'btn btn--danger',
          type: 'button',
          onclick: () => {
            State.set({ editingId: null });
            State.remove(item.id);
          },
        }, 'Löschen')
      )
    );

    // Fokus ans Ende des Titels - aber nur beim Oeffnen. Bei einem
    // Neuaufbau mittendrin bleibt der Fokus, wo der Nutzer gerade tippt.
    if (!running) {
      setTimeout(() => {
        titleInput.focus();
        titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
      }, 0);
    }

    return form;
  }

  // ---------------------------------------------------------------- Kompakt

  /**
   * Minizeile der Wochenansicht (Leitfaden 3.7): 26 px, Statusglyph 12 px,
   * Titel bis zu zwei Zeilen, kein Quellen-Icon - dafuer ist die Spalte zu
   * schmal. Die Quelle steht im `title`.
   */
  function renderCompact(item) {
    const source = Model.sourceById(item.source);
    const status = Model.statusById(item.status);
    const state = State.get();
    const focused = state.focusId === item.id;
    const isOverdue = item.status !== 'erledigt' && item.day < Dates.todayKey();

    const card = h('article', {
      class: 'mini' + (focused ? ' is-focused' : '') + (isOverdue ? ' is-overdue' : ''),
      dataset: { id: item.id, status: item.status, prio: String(item.priority || 0), fkey: 'item:' + item.id },
      tabindex: focused ? '0' : '-1',
      title:
        `${item.title}\n${source.label} · ${status.label}` +
        (isOverdue ? ' · überfällig' : ''),
    },
      h('button', {
        class: 'mini__status',
        type: 'button',
        title: 'Weiter zu: ' + Model.statusById(Model.nextStatus(item.status)).label,
        'aria-label': status.label,
        onclick: (ev) => {
          ev.stopPropagation();
          State.cycleStatus(item);
        },
      }, Icons.svg(status.iconId, { size: 12 })),
      h('span', { class: 'mini__title' }, item.title),
      item.priority > 0
        ? h('span', {
            class: 'mini__prio mark mark--prio' + item.priority,
            title: 'Priorität: ' + Model.priorityById(item.priority).label,
          }, Model.priorityById(item.priority).icon)
        : null
    );

    card.addEventListener('click', () => {
      State.get().expanded.add(item.id);
      State.set({ view: 'tag', cursorDay: item.day });
    });

    makeDraggable(card, item);
    return card;
  }

  /**
   * Macht ein Element zum Ablageziel fuer einen Tag.
   *
   * `dragleave` feuert auch beim Wechsel auf ein Kindelement. Ohne den Blick
   * auf `relatedTarget` flackert die Hervorhebung deshalb, sobald man ueber
   * eine Zeile innerhalb der Liste zieht.
   */
  function makeDropTarget(node, dayKey) {
    node.addEventListener('dragenter', (ev) => {
      if (!ev.dataTransfer.types.includes(DRAG_TYPE)) return;
      ev.preventDefault();
      node.classList.add('is-dropTarget');
    });
    node.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer.types.includes(DRAG_TYPE)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      node.classList.add('is-dropTarget');
    });
    node.addEventListener('dragleave', (ev) => {
      if (ev.relatedTarget && node.contains(ev.relatedTarget)) return; // nur zu einem Kind gewechselt
      node.classList.remove('is-dropTarget');
    });
    node.addEventListener('drop', (ev) => {
      node.classList.remove('is-dropTarget');
      const ids = String(ev.dataTransfer.getData(DRAG_TYPE) || '').split(' ').filter(Boolean);
      if (!ids.length) return;
      ev.preventDefault();
      State.move(ids, dayKey);
      if (ids.length > 1) State.clearSelection();
    });
    return node;
  }

  return { render, renderCompact, makeDropTarget, DRAG_TYPE };
})();
