/* Kleine DOM- und UI-Helfer. Global als `Util`. */
window.Util = (function () {
  /**
   * Minimaler Element-Builder.
   *   h('div', { class: 'card', onclick: fn }, 'Text', h('span', null, '!'))
   *
   * Text wird immer ueber textContent gesetzt - damit koennen Aufgabentitel
   * niemals als HTML interpretiert werden.
   */
  function h(tag, props, ...children) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'value') node.value = value;
      else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'draggable') node[key] = !!value;
      else node.setAttribute(key, value);
    }

    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const el = (sel, root) => (root || document).querySelector(sel);
  const els = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  /**
   * Kurze Einblendung unten rechts.
   * toast('Gelöscht', { actionLabel: 'Rückgängig', onAction: fn })
   */
  function toast(message, options = {}) {
    const host = el('#toasts');
    if (!host) return;

    const box = h('div', { class: 'toast' + (options.tone ? ' toast--' + options.tone : '') },
      h('span', { class: 'toast__text' }, message)
    );

    let timer = null;
    const close = () => {
      if (timer) clearTimeout(timer);
      box.classList.add('toast--out');
      setTimeout(() => box.remove(), 180);
    };

    if (options.actionLabel && options.onAction) {
      box.appendChild(
        h('button', {
          class: 'toast__action',
          onclick: () => {
            options.onAction();
            close();
          },
        }, options.actionLabel)
      );
    }

    box.appendChild(h('button', { class: 'toast__close', title: 'Schließen', onclick: close }, '×'));

    host.appendChild(box);
    timer = setTimeout(close, options.duration || 5000);
    return close;
  }

  /** Liegt der Fokus in einem Feld, in das gerade getippt wird? */
  function isTextInput(node) {
    if (!node || !node.tagName) return false;
    const tag = node.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
  }

  // ------------------------------------------------------------ Fokus retten
  //
  // Die Ansicht wird bei jeder Aenderung komplett neu aufgebaut - auch dann,
  // wenn die Aenderung aus einem anderen Fenster kommt. Wer gerade tippt, darf
  // dabei weder Fokus noch Cursorposition verlieren. Deshalb merken wir uns das
  // zuletzt fokussierte Element; nach dem Neuaufbau wird anhand von
  // `data-fkey` das Gegenstueck gesucht und der Fokus dorthin zurueckgelegt.

  let lastFocused = null;
  document.addEventListener(
    'focusin',
    (ev) => {
      if (ev.target && ev.target !== document.body) lastFocused = ev.target;
    },
    true
  );

  function escapeSelector(value) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /**
   * Fokus nach einem Neuaufbau wiederherstellen.
   * Greift nur, wenn der Fokus tatsaechlich verloren ging (das alte Element
   * haengt nicht mehr im Dokument und niemand sonst hat den Fokus uebernommen).
   * `fallbackKey` springt ein, wenn das Original verschwunden ist - etwa nach
   * dem Loeschen, wenn der Nachbar den Fokus bekommen soll.
   */
  function restoreFocus(root, fallbackKey) {
    if (!root) return false;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return false;

    const previous = lastFocused;
    const keys = [];
    if (previous && !previous.isConnected && previous.dataset && previous.dataset.fkey) {
      keys.push(previous.dataset.fkey);
    }
    if (fallbackKey) keys.push(fallbackKey);

    for (const key of keys) {
      const next = root.querySelector(`[data-fkey="${escapeSelector(key)}"]`);
      if (!next) continue;
      next.focus();
      // Cursorposition uebernehmen - abgehaengte Felder behalten ihren Stand
      if (
        previous &&
        previous.dataset.fkey === key &&
        typeof previous.selectionStart === 'number' &&
        typeof next.selectionStart === 'number'
      ) {
        try {
          next.setSelectionRange(previous.selectionStart, previous.selectionEnd);
        } catch (err) {
          /* Feldtypen ohne Auswahlbereich (z. B. type=date) ignorieren das */
        }
      }
      lastFocused = next;
      return true;
    }
    return false;
  }

  /** Text fuer die Suche normalisieren (Umlaute, Gross/Klein). */
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss');
  }

  /** '3 Aufgaben' / '1 Aufgabe' */
  function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
  }

  return { h, el, els, clear, debounce, toast, normalize, plural, isTextInput, restoreFocus };
})();
