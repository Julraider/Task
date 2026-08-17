/*
 * Darstellung einer einzelnen Aufgabe - einmal ausfuehrlich (Tagesansicht)
 * und einmal kompakt (Wochenansicht).
 */
window.ItemCard = (function () {
  const { h } = Util;

  const DRAG_TYPE = 'application/x-tagwerk-item';

  /** Kleine Kennzeichnungen rechts vom Titel. */
  function badges(item) {
    const out = [];
    if (item.priority > 0) {
      const p = Model.priorityById(item.priority);
      out.push(h('span', { class: 'badge badge--prio' + item.priority, title: 'Priorität: ' + p.label }, p.icon));
    }
    if (item.ref) out.push(h('span', { class: 'badge badge--ref', title: 'Referenz' }, item.ref));
    for (const tag of item.tags || []) {
      out.push(
        h('button', {
          class: 'badge badge--tag',
          title: 'Nach #' + tag + ' filtern',
          onclick: (ev) => {
            ev.stopPropagation();
            const current = State.get().filterTag;
            State.set({ filterTag: current === tag ? null : tag });
          },
        }, '#' + tag)
      );
    }
    return out;
  }

  function metaLine(item, options) {
    const source = Model.sourceById(item.source);
    const parts = [
      h('span', { class: 'meta__source', title: 'Quelle' }, `${source.icon} ${source.label}`),
      h('span', { class: 'meta__time' }, Dates.formatTime(item.createdAt) + ' Uhr'),
    ];
    // Steht die Aufgabe an einem anderen Tag, gehoert das Datum dazu - ausser
    // die Liste zeigt es ohnehin schon in einer eigenen Spalte.
    if (item.day !== State.get().cursorDay && !(options && options.hideDay)) {
      parts.push(h('span', { class: 'meta__day' }, Dates.formatShort(item.day)));
    }
    if (item.status === 'erledigt' && item.doneAt) {
      parts.push(h('span', { class: 'meta__done' }, '✓ ' + Dates.formatTime(item.doneAt)));
    }
    return h('div', { class: 'item__meta' }, parts);
  }

  function statusButton(item) {
    const status = Model.statusById(item.status);
    return h('button', {
      class: 'item__status',
      title: `${status.label} - klicken für nächsten Status`,
      'aria-label': 'Status: ' + status.label,
      onclick: (ev) => {
        ev.stopPropagation();
        State.cycleStatus(item);
      },
    }, status.icon);
  }

  function makeDraggable(node, item) {
    node.draggable = true;
    node.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData(DRAG_TYPE, item.id);
      ev.dataTransfer.setData('text/plain', item.title);
      ev.dataTransfer.effectAllowed = 'move';
      node.classList.add('is-dragging');
    });
    node.addEventListener('dragend', () => node.classList.remove('is-dragging'));
  }

  // ------------------------------------------------------------- Ausfuehrlich

  function render(item, options) {
    const state = State.get();
    const expanded = state.expanded.has(item.id);
    const editing = state.editingId === item.id;

    const card = h('article', {
      class: 'item' + (expanded ? ' is-expanded' : '') + (editing ? ' is-editing' : ''),
      dataset: { id: item.id, status: item.status, prio: String(item.priority || 0) },
    });

    const head = h('div', {
      class: 'item__head',
      onclick: () => State.toggleExpanded(item.id),
      ondblclick: () => {
        State.get().expanded.add(item.id);
        State.set({ editingId: item.id });
      },
    },
      statusButton(item),
      h('div', { class: 'item__body' },
        h('div', { class: 'item__titleRow' },
          h('span', { class: 'item__title' }, item.title),
          h('span', { class: 'item__badges' }, badges(item))
        ),
        metaLine(item, options)
      ),
      h('div', { class: 'item__actions' },
        h('button', {
          class: 'iconbtn',
          title: 'Auf morgen schieben',
          onclick: (ev) => {
            ev.stopPropagation();
            State.move(item.id, Dates.addDays(item.day, 1));
          },
        }, '→'),
        h('button', {
          class: 'iconbtn',
          title: 'Bearbeiten',
          onclick: (ev) => {
            ev.stopPropagation();
            State.get().expanded.add(item.id);
            State.set({ editingId: item.id });
          },
        }, '✎'),
        h('button', {
          class: 'iconbtn iconbtn--danger',
          title: 'Löschen',
          onclick: (ev) => {
            ev.stopPropagation();
            State.remove(item.id);
          },
        }, '🗑')
      )
    );

    card.appendChild(head);
    makeDraggable(card, item);

    if (expanded && !editing) {
      const details = h('div', { class: 'item__details' });
      if (item.notes && item.notes.trim()) {
        details.appendChild(h('p', { class: 'item__notes' }, item.notes));
      } else {
        details.appendChild(
          h('button', {
            class: 'linkbtn',
            onclick: () => State.set({ editingId: item.id }),
          }, '+ Notiz hinzufügen')
        );
      }
      card.appendChild(details);
    }

    if (editing) card.appendChild(editor(item));

    return card;
  }

  // ------------------------------------------------------------------ Editor

  function editor(item) {
    const form = h('form', {
      class: 'editor',
      onsubmit: (ev) => {
        ev.preventDefault();
        save();
      },
    });

    const titleInput = h('input', { class: 'editor__title', type: 'text', value: item.title, required: 'required' });
    const notesInput = h('textarea', { class: 'editor__notes', rows: '3', placeholder: 'Notizen, Links, Ansprechpartner …' });
    notesInput.value = item.notes || '';

    const sourceSelect = h('select', { class: 'editor__field' },
      ...Model.SOURCES.map((s) => h('option', { value: s.id, selected: s.id === item.source }, `${s.icon} ${s.label}`))
    );
    const statusSelect = h('select', { class: 'editor__field' },
      ...Model.STATUSES.map((s) => h('option', { value: s.id, selected: s.id === item.status }, s.label))
    );
    const prioSelect = h('select', { class: 'editor__field' },
      ...Model.PRIORITIES.map((p) => h('option', { value: String(p.id), selected: p.id === (item.priority || 0) }, p.label))
    );
    const dayInput = h('input', { class: 'editor__field', type: 'date', value: item.day });
    const refInput = h('input', { class: 'editor__field', type: 'text', value: item.ref || '', placeholder: 'INC0012345' });
    const tagsInput = h('input', {
      class: 'editor__field',
      type: 'text',
      value: (item.tags || []).join(', '),
      placeholder: 'netzwerk, hardware',
    });

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

    // Fokus ans Ende des Titels
    setTimeout(() => {
      titleInput.focus();
      titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
    }, 0);

    return form;
  }

  // ---------------------------------------------------------------- Kompakt

  function renderCompact(item) {
    const source = Model.sourceById(item.source);
    const status = Model.statusById(item.status);

    const card = h('article', {
      class: 'mini',
      dataset: { id: item.id, status: item.status, prio: String(item.priority || 0) },
      title: `${item.title}\n${source.label} · ${status.label}`,
    },
      h('button', {
        class: 'mini__status',
        onclick: (ev) => {
          ev.stopPropagation();
          State.cycleStatus(item);
        },
      }, status.icon),
      h('span', { class: 'mini__title' }, item.title),
      item.priority > 0 ? h('span', { class: 'mini__prio' }, Model.priorityById(item.priority).icon) : null
    );

    card.addEventListener('click', () => {
      State.get().expanded.add(item.id);
      State.set({ view: 'tag', cursorDay: item.day });
    });

    makeDraggable(card, item);
    return card;
  }

  /** Macht ein Element zum Ablageziel fuer einen Tag. */
  function makeDropTarget(node, dayKey) {
    node.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer.types.includes(DRAG_TYPE)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      node.classList.add('is-dropTarget');
    });
    node.addEventListener('dragleave', () => node.classList.remove('is-dropTarget'));
    node.addEventListener('drop', (ev) => {
      node.classList.remove('is-dropTarget');
      const id = ev.dataTransfer.getData(DRAG_TYPE);
      if (!id) return;
      ev.preventDefault();
      State.move(id, dayKey);
    });
    return node;
  }

  return { render, renderCompact, makeDropTarget, DRAG_TYPE };
})();
