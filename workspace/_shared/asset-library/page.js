// Asset library page behaviour (inlined by build.mjs): filters, search, the
// comparison of two views and the requests to Mr. Mak. The page touches only its
// own document. "Send to chat" and "Ask for a variation" post the item's id to
// the desktop app, which reads the item from the card's assets.json, shows the
// exact message and the chat, and sends nothing unless the owner confirms it.
(() => {
  'use strict';
  const root = document.querySelector('[data-al]');
  if (!root) return;
  const all = (selector, base = root) => [...base.querySelectorAll(selector)];
  const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const make = (tag, attributes = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  };

  // ---------- filters ----------
  const items = all('.al-item');
  const groups = all('.al-category, .al-family');
  const filters = all('[data-al-filter]');
  const search = root.querySelector('[data-al-search]');
  const total = root.querySelector('[data-al-total]');
  const empty = root.querySelector('[data-al-empty]');
  const state = { category: '', status: '', query: '' };
  const matches = (item, { category, status, query }) => (!category || item.dataset.category === category)
    && (!status || item.dataset.status === status)
    && (!query || query.split(/\s+/).every(part => item.dataset.search.includes(part)));

  function apply() {
    state.query = fold(search ? search.value : '');
    let shown = 0;
    for (const item of items) { item.hidden = !matches(item, state); if (!item.hidden) shown++; }
    for (const group of groups) {
      const inside = all('.al-item', group), visible = inside.filter(item => !item.hidden).length;
      group.hidden = visible === 0;
      const label = group.querySelector(':scope > summary [data-al-count]');
      if (label) label.textContent = visible === inside.length ? plural(inside.length, 'item', 'items') : `${visible} of ${plural(inside.length, 'item', 'items')}`;
      if (state.query && visible && group.classList.contains('al-family')) group.open = true;
    }
    // Each filter shows how many items would remain if it were chosen.
    for (const button of filters) {
      const kind = button.dataset.alFilter, value = button.dataset.value;
      button.setAttribute('aria-pressed', String(state[kind] === value));
      const count = button.querySelector('[data-al-n]');
      if (count) count.textContent = String(items.filter(item => matches(item, { ...state, [kind]: value })).length);
    }
    const filtered = Boolean(state.category || state.status || state.query);
    if (total) total.textContent = filtered ? `${shown} of ${plural(items.length, 'item', 'items')}` : plural(items.length, 'item', 'items');
    if (empty) empty.hidden = shown !== 0;
  }

  // ---------- compare two views ----------
  function compare(button) {
    const item = button.closest('.al-item');
    const open = item.querySelector('.al-compare');
    if (open) { open.remove(); item.classList.remove('al-wide'); button.setAttribute('aria-expanded', 'false'); return; }
    const views = all('img[data-al-view]', item);
    if (views.length < 2) return;
    const name = item.querySelector('h3').textContent;
    const choice = (label, selected) => {
      const select = make('select', { 'aria-label': label }, views.map((view, index) => new Option(view.dataset.label || view.alt, String(index))));
      select.value = String(selected);
      return select;
    };
    const left = choice('Left image', 0), right = choice('Right image', 1);
    const under = make('img', { alt: '' }), over = make('img', { alt: '' });
    const cover = make('div', { className: 'al-over' }, [over]);
    const line = make('span', { className: 'al-line', 'aria-hidden': 'true' });
    const stage = make('div', { className: 'al-stage' }, [under, cover, line]);
    const slider = make('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': 'Divider position' });
    const close = make('button', { type: 'button', text: 'Close' });
    const panel = make('div', { className: 'al-compare', role: 'group', 'aria-label': `Compare views of ${name}` }, [
      make('div', { className: 'al-compare-bar' }, [make('strong', { text: `Compare: ${name}` }), make('label', {}, ['Left ', left]), make('label', {}, ['Right ', right]), close]),
      stage, slider,
    ]);
    const place = value => {
      const at = Math.max(0, Math.min(100, Number(value)));
      cover.style.clipPath = `inset(0 ${100 - at}% 0 0)`;
      line.style.left = `${at}%`;
      slider.value = String(at);
    };
    const fill = () => {
      // The left image is drawn over the right one and clipped at the divider.
      const a = views[Number(left.value)], b = views[Number(right.value)];
      over.src = a.currentSrc || a.src; over.alt = `${name}, ${a.dataset.label || a.alt}`;
      under.src = b.currentSrc || b.src; under.alt = `${name}, ${b.dataset.label || b.alt}`;
    };
    under.addEventListener('load', () => { if (under.naturalWidth && under.naturalHeight) stage.style.aspectRatio = `${under.naturalWidth} / ${under.naturalHeight}`; });
    for (const [select, other] of [[left, right], [right, left]]) select.addEventListener('change', () => {
      if (select.value === other.value) other.value = String((Number(select.value) + 1) % views.length);
      fill();
    });
    slider.addEventListener('input', () => place(slider.value));
    let dragging = false;
    const move = event => { const box = stage.getBoundingClientRect(); place(((event.clientX - box.left) / box.width) * 100); };
    stage.addEventListener('pointerdown', event => { dragging = true; stage.setPointerCapture?.(event.pointerId); move(event); });
    stage.addEventListener('pointermove', event => { if (dragging) move(event); });
    for (const type of ['pointerup', 'pointercancel']) stage.addEventListener(type, () => { dragging = false; });
    close.addEventListener('click', () => { panel.remove(); item.classList.remove('al-wide'); button.setAttribute('aria-expanded', 'false'); button.focus(); });
    item.classList.add('al-wide');
    button.setAttribute('aria-expanded', 'true');
    item.querySelector('.al-actions').after(panel);
    fill(); place(50);
  }

  // ---------- send to a chat through Mr. Mak ----------
  // Only the item's id and the action leave the page. Mr. Mak answers at once
  // that it is waiting for the owner; without that answer (a browser or the
  // phone preview), nothing can be sent from here.
  const OUTSIDE = 'Open this card in the Mr. Mak desktop app to send it to a chat.';
  const pending = new Map();
  function finish(id, text) {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer); pending.delete(id);
    entry.button.disabled = false; entry.show(text);
  }
  function ask(button) {
    const item = button.closest('.al-item'), notice = item.querySelector('[data-al-notice]');
    const show = text => { notice.hidden = false; notice.textContent = text; };
    if (window.parent === window) { show(OUTSIDE); return; }
    const id = `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    pending.set(id, { button, show, timer: setTimeout(() => finish(id, OUTSIDE), 4000) });
    button.disabled = true;
    show('Asking Mr. Mak…');
    window.parent.postMessage({ type: 'mrmak:asset-request', id, action: button.dataset.alSend, item: item.dataset.id }, '*');
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.type !== 'mrmak:asset-response' || !pending.has(data.id)) return;
    if (data.waiting) {
      const entry = pending.get(data.id);
      clearTimeout(entry.timer);
      entry.show('Confirm or cancel in Mr. Mak.');
      return;
    }
    finish(data.id, data.ok ? String(data.text || 'Sent.') : `Not sent: ${String(data.error || 'unknown error')}`);
  });

  root.addEventListener('click', event => {
    const filter = event.target.closest('[data-al-filter]');
    if (filter) { state[filter.dataset.alFilter] = filter.dataset.value; apply(); return; }
    const toggle = event.target.closest('[data-al-compare]');
    if (toggle) { compare(toggle); return; }
    const send = event.target.closest('[data-al-send]');
    if (send) ask(send);
  });
  if (search) search.addEventListener('input', apply);
  apply();
})();
