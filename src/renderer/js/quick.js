/*
 * Schnellerfassung: ein Feld, eine Zeile, weg.
 *
 * Bewusst ohne State/Views - dieses Fenster soll in Millisekunden da sein.
 * Es bleibt zwischen zwei Aufrufen im Speicher (der Main-Prozess versteckt es
 * nur), deshalb ueberleben Verlauf und Schlagwortliste den Tag ueber.
 */
(function () {
  const api = window.tagwerk;
  const input = document.getElementById('quickInput');
  const form = document.getElementById('quickForm');
  const hint = document.getElementById('quickHint');
  const card = document.getElementById('quickCard');

  /** Zuletzt erfasste Zeilen, aelteste zuerst. */
  const history = [];
  let histIndex = 0; // == history.length: aktuelle Eingabe
  let draft = '';

  /** Bekannte Schlagworte, nach Haeufigkeit - Grundlage der Vervollstaendigung. */
  let knownTags = [];

  /** Angefangenes '@…'/'#…' mit markierter Ergaenzung. */
  let ghost = null; // { sign, typed, start, candidates, index, applied }

  /** Wartet das Fenster darauf, gleich wieder aufzutauchen? (Umschalt + Enter) */
  let keepOpenPending = false;
  let hintTimer = null;

  // ------------------------------------------------------------- Hinweiszeile

  function clearHint() {
    while (hint.firstChild) hint.removeChild(hint.firstChild);
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
  }

  function span(text, className) {
    const node = document.createElement(className === 'kbd' ? 'kbd' : 'span');
    if (className && className !== 'kbd') node.className = className;
    node.textContent = text;
    return node;
  }

  /** Standardzeile: was man hier alles druecken kann. */
  function showKeys() {
    clearHint();
    const keys = [
      ['Enter', 'speichern'],
      ['Umschalt + Enter', 'weiter erfassen'],
      ['↑', 'Verlauf'],
      ['Esc', 'schließen'],
    ];
    keys.forEach(([key, text], i) => {
      if (i) hint.appendChild(span(' · ', 'quick__sep'));
      hint.appendChild(span(key, 'kbd'));
      hint.appendChild(span(' ' + text, 'quick__keyText'));
    });
  }

  function showText(text, tone) {
    clearHint();
    hint.appendChild(span(text, tone ? 'quick__msg quick__msg--' + tone : 'quick__msg'));
  }

  /** Vorschlaege fuer das gerade getippte @…/#… */
  function showSuggestions() {
    clearHint();
    hint.appendChild(span('⇥', 'kbd'));
    ghost.candidates.slice(0, 6).forEach((word, i) => {
      hint.appendChild(span(ghost.sign + word, 'quick__sug' + (i === ghost.index ? ' is-active' : '')));
    });
  }

  /** Was wuerde aus der Zeile werden? */
  function showParsed() {
    const text = input.value;
    if (!text.trim()) {
      showKeys();
      return;
    }
    if (ghost) {
      showSuggestions();
      return;
    }

    const parsed = Parse.parseCapture(text, Dates.todayKey());
    const source = Model.sourceById(parsed.source);
    const bits = [`${source.icon} ${source.label}`];

    if (parsed.priority > 0) bits.push('Prio: ' + Model.priorityById(parsed.priority).label);
    for (const tag of parsed.tags) bits.push('#' + tag);
    if (parsed.ref) bits.push(parsed.ref);
    bits.push('→ ' + Dates.relativeLabel(parsed.day));

    showText(bits.join('  ·  '));
  }

  function flash(message, tone) {
    showText(message, tone);
    card.classList.remove('is-ok', 'is-error');
    card.classList.add(tone === 'error' ? 'is-error' : 'is-ok');
    hintTimer = setTimeout(() => {
      card.classList.remove('is-ok', 'is-error');
      if (!input.value.trim()) showKeys();
    }, tone === 'error' ? 4000 : 1600);
  }

  // -------------------------------------------------- Vervollstaendigung @ #

  function tokenAtCaret() {
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos);
    const m = before.match(/(^|\s)([@#])([\p{L}\p{N}_-]*)$/u);
    if (!m) return null;
    return { sign: m[2], typed: m[3], start: pos - m[3].length - 1 };
  }

  function candidatesFor(sign, typed) {
    const t = typed.toLowerCase();
    if (sign === '@') {
      const byId = Model.SOURCES.filter((s) => s.id.startsWith(t));
      const byAlias = Model.SOURCES.filter((s) => !byId.includes(s) && s.aliases.some((a) => a.startsWith(t)));
      return [...byId, ...byAlias].map((s) => s.id);
    }
    return knownTags.filter((tag) => tag.startsWith(t)).slice(0, 6);
  }

  /**
   * Der erste Treffer wird direkt ins Feld geschrieben und markiert:
   * weitertippen ueberschreibt ihn, Tab blaettert weiter, Esc nimmt ihn zurueck.
   */
  function refreshCompletion(complete) {
    const token = tokenAtCaret();
    ghost = null;
    if (!token) return;

    const candidates = candidatesFor(token.sign, token.typed);
    if (!candidates.length) return;

    ghost = { ...token, candidates, index: 0, applied: false };
    if (complete && token.typed && candidates[0] !== token.typed) applyGhost(0);
  }

  function applyGhost(index) {
    if (!ghost) return;
    ghost.applied = true;
    const count = ghost.candidates.length;
    ghost.index = ((index % count) + count) % count;

    const word = ghost.candidates[ghost.index];
    const caret = ghost.start + 1 + ghost.typed.length;
    const value = input.value;
    const tail = value.slice(Math.max(caret, input.selectionEnd));

    input.value = value.slice(0, ghost.start) + ghost.sign + word + tail;
    input.setSelectionRange(caret, ghost.start + 1 + word.length, 'backward');
  }

  function revertGhost() {
    const caret = ghost.start + 1 + ghost.typed.length;
    const value = input.value;
    input.value = value.slice(0, caret) + value.slice(input.selectionEnd);
    input.setSelectionRange(caret, caret);
    ghost = null;
  }

  // ------------------------------------------------------------------ Verlauf

  function remember(text) {
    const i = history.indexOf(text);
    if (i >= 0) history.splice(i, 1);
    history.push(text);
    if (history.length > 25) history.shift();
    histIndex = history.length;
    draft = '';
  }

  function stepHistory(direction) {
    if (!history.length) return;
    if (histIndex === history.length) draft = input.value;

    const next = Math.min(history.length, Math.max(0, histIndex + direction));
    if (next === histIndex) return;

    histIndex = next;
    input.value = histIndex === history.length ? draft : history[histIndex];
    input.setSelectionRange(input.value.length, input.value.length);
    ghost = null;
    showParsed();
  }

  // ------------------------------------------------------------------ Abläufe

  async function submit(keepOpen) {
    ghost = null;
    const text = input.value.trim();
    if (!text) {
      if (!keepOpen) api.quickClose();
      return;
    }

    const res = await api.quickSubmit(text);
    if (!res || !res.ok) {
      flash((res && res.error) || 'Konnte nicht gespeichert werden', 'error');
      input.focus();
      return;
    }

    remember(text);
    input.value = '';

    if (keepOpen) {
      // Der Main-Prozess versteckt das Fenster beim Speichern - fuer die
      // naechste Aufgabe holen wir es sofort zurueck.
      keepOpenPending = true;
      await api.quickOpen();
      input.focus();
    }

    const item = res.item || {};
    const target = item.day ? ' → ' + Dates.relativeLabel(item.day) : '';
    flash('✓ Gespeichert: ' + shorten(item.title || text) + target, 'ok');
  }

  function shorten(text) {
    return text.length > 48 ? text.slice(0, 47) + '…' : text;
  }

  function resetForNewEntry() {
    input.value = '';
    ghost = null;
    histIndex = history.length;
    draft = '';
    card.classList.remove('is-ok', 'is-error');
    showKeys();
  }

  // ------------------------------------------------------------------ Ereignisse

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    submit(false);
  });

  input.addEventListener('input', (ev) => {
    const typing = !ev.inputType || ev.inputType.startsWith('insert');
    refreshCompletion(typing);
    histIndex = history.length;
    draft = input.value;
    card.classList.remove('is-ok', 'is-error');
    showParsed();
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ghost = null;
      submit(ev.shiftKey);
      return;
    }
    if (ev.key === 'Tab' && ghost && ghost.candidates.length > 1) {
      ev.preventDefault();
      applyGhost(ghost.index + (ev.shiftKey ? -1 : 1));
      showSuggestions();
      return;
    }
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      stepHistory(ev.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (ghost && ghost.applied) {
        revertGhost();
        showParsed();
        return;
      }
      resetForNewEntry();
      api.quickClose();
    }
  });

  // Wenn das Fenster per Tastenkuerzel erscheint: sofort tippbereit
  api.onQuickFocus(() => {
    if (keepOpenPending) {
      // Kam nur zurueck, weil gerade "speichern und weiter" gedrueckt wurde.
      keepOpenPending = false;
      input.focus();
      return;
    }
    resetForNewEntry();
    input.focus();
    input.select();
    loadTags();
  });

  window.addEventListener('focus', () => input.focus());

  // ------------------------------------------------------------------ Start

  /** Schlagworte kommen aus den vorhandenen Aufgaben. */
  function setTags(items) {
    const counts = new Map();
    for (const item of items || []) {
      for (const tag of item.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    knownTags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
  }

  async function loadTags() {
    const res = await api.getData();
    if (res && res.ok) setTags(res.data.items);
  }

  api.onDataChanged((snapshot) => setTags(snapshot.items));
  loadTags();

  // Randloses Fenster: die Karte selbst ist der Griff zum Verschieben,
  // das Eingabefeld bleibt bedienbar. Inline-Styles verbietet die CSP,
  // deshalb ueber das CSSOM.
  card.style.setProperty('-webkit-app-region', 'drag');
  input.style.setProperty('-webkit-app-region', 'no-drag');

  showKeys();
  input.focus();
})();
