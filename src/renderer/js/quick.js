/*
 * Schnellerfassung: ein Feld, eine Zeile, weg.
 *
 * Bewusst ohne State/Views - dieses Fenster soll in Millisekunden da sein.
 */
(function () {
  const api = window.tagwerk;
  const input = document.getElementById('quickInput');
  const form = document.getElementById('quickForm');
  const hint = document.getElementById('quickHint');
  const card = document.getElementById('quickCard');

  const defaultHint = hint.innerHTML;

  function showParsed() {
    const text = input.value;
    if (!text.trim()) {
      hint.innerHTML = defaultHint;
      return;
    }

    const parsed = Parse.parseCapture(text, Dates.todayKey());
    const source = Model.sourceById(parsed.source);
    const bits = [`${source.icon} ${source.label}`];

    if (parsed.priority > 0) bits.push('Prio: ' + Model.priorityById(parsed.priority).label);
    for (const tag of parsed.tags) bits.push('#' + tag);
    if (parsed.ref) bits.push(parsed.ref);
    bits.push('→ ' + Dates.relativeLabel(parsed.day));

    hint.textContent = bits.join('  ·  ');
  }

  function flash(message, tone) {
    hint.textContent = message;
    card.classList.add(tone === 'error' ? 'is-error' : 'is-ok');
    setTimeout(() => card.classList.remove('is-ok', 'is-error'), 600);
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) {
      api.quickClose();
      return;
    }

    const res = await api.quickSubmit(text);
    if (!res.ok) {
      flash(res.error || 'Konnte nicht gespeichert werden', 'error');
      return;
    }

    input.value = '';
    flash('Gespeichert');
    // Das Fenster wird vom Main-Prozess ausgeblendet; Feld ist fuer's naechste Mal leer.
    setTimeout(() => {
      hint.innerHTML = defaultHint;
    }, 600);
  });

  input.addEventListener('input', showParsed);

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      input.value = '';
      hint.innerHTML = defaultHint;
      api.quickClose();
    }
  });

  // Wenn das Fenster per Tastenkuerzel erscheint: sofort tippbereit
  api.onQuickFocus(() => {
    input.value = '';
    hint.innerHTML = defaultHint;
    input.focus();
    input.select();
  });

  window.addEventListener('focus', () => input.focus());
  input.focus();
})();
