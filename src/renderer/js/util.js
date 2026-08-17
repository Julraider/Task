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

  return { h, el, els, clear, debounce, toast, normalize, plural };
})();
