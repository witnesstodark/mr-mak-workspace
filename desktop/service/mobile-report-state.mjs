// The opaque mobile report can report its own route/scroll only. It cannot call app APIs.
export function mobileReportStatePrelude(parentOrigin) {
  const origin = JSON.stringify(parentOrigin).replace(/</g, '\\u003c');
  return Buffer.from(`<script data-mrmak-mobile-state>
(() => {
  const target = ${origin}, tracked = new Set(); let restoring = true, timer = 0, restoreVersion = 0;
  const send = (type, state) => parent.postMessage({ type, ...(state ? { state } : {}) }, target);
  const selector = node => {
    const parts = [];
    while (node && node !== document.body && parts.length < 8) {
      let index = 1, sibling = node.previousElementSibling;
      while (sibling) { if (sibling.tagName === node.tagName) index++; sibling = sibling.previousElementSibling; }
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + index + ')'); node = node.parentElement;
    }
    return node === document.body ? 'body > ' + parts.join(' > ') : '';
  };
  const capture = () => {
    if (restoring) return;
    const scrollers = [...tracked].filter(node => node.isConnected && (node.scrollTop || node.scrollLeft)).slice(0,12).map(node => ({ selector: selector(node), top: Math.max(0,node.scrollTop), left: Math.max(0,node.scrollLeft) })).filter(item => item.selector);
    send('mrmak:report-state', { path: location.pathname.slice(1), hash: location.hash, top: Math.max(0,window.scrollY), left: Math.max(0,window.scrollX), scrollers });
  };
  const changed = () => { clearTimeout(timer); timer = setTimeout(capture, 80); };
  document.addEventListener('scroll', event => { const node = event.target; if (node instanceof Element && node !== document.scrollingElement) { tracked.add(node); if (tracked.size > 12) tracked.delete(tracked.values().next().value); } changed(); }, true); window.addEventListener('hashchange', changed);
  window.addEventListener('pagehide', capture);
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== target) return;
    if (event.data?.type === 'mrmak:report-active') { if (event.data.active === false) document.querySelectorAll('video,audio').forEach(media => media.pause()); return; }
    if (event.data?.type === 'mrmak:report-capture') { capture(); return; }
    if (event.data?.type !== 'mrmak:report-restore') return;
    const state = event.data.state;
    if (!state || ![state.top,state.left].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e7)) return;
    const version = ++restoreVersion; restoring = true;
    let attempts = 0;
    const restore = () => {
      if (version !== restoreVersion) return;
      window.scrollTo({ top: state.top, left: state.left, behavior: 'instant' });
      let waiting = Math.abs(window.scrollY - state.top) > 2 || Math.abs(window.scrollX - state.left) > 2;
      for (const item of Array.isArray(state.scrollers) ? state.scrollers.slice(0,12) : []) {
        if (typeof item.selector !== 'string' || item.selector.length > 500 || ![item.top,item.left].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e7)) continue;
        try { const node = document.querySelector(item.selector); if (node) { tracked.add(node); node.scrollTop = item.top; node.scrollLeft = item.left; waiting ||= Math.abs(node.scrollTop - item.top) > 2 || Math.abs(node.scrollLeft - item.left) > 2; } else waiting = true; } catch {}
      }
      if (waiting && ++attempts < 20) { setTimeout(restore, 100); return; }
      restoring = false; capture();
    };
    requestAnimationFrame(() => requestAnimationFrame(restore));
  });
  const userMoved = () => { if (restoring) { restoreVersion++; restoring = false; capture(); } };
  for (const type of ['pointerdown','wheel','keydown']) document.addEventListener(type, userMoved, { passive: true, capture: true });
  // Pull to refresh: a single touch dragged down while the page and every scroller under it are at the top.
  // The phone app refreshes the report; the browser's own pull would reload the whole app.
  document.documentElement.style.overscrollBehaviorY = 'contain';
  let pull = null;
  const atTop = node => { for (; node instanceof Element; node = node.parentElement) if (node.scrollTop > 0) return false; return window.scrollY <= 0; };
  const pulled = (distance, done) => { if (pull && (pull.distance || done)) send('mrmak:report-pull', { distance, done }); };
  document.addEventListener('touchstart', event => { const touch = event.touches[0]; pull = event.touches.length === 1 && atTop(event.target) ? { x: touch.clientX, y: touch.clientY, distance: 0 } : null; }, { passive: true, capture: true });
  document.addEventListener('touchmove', event => {
    if (!pull) return;
    const touch = event.touches[0], dx = touch.clientX - pull.x, dy = touch.clientY - pull.y;
    if (event.touches.length > 1 || dy < 0 || (!pull.distance && Math.abs(dx) > dy)) { pulled(0, true); pull = null; return; }
    pull.distance = Math.min(dy, 1000); pulled(pull.distance, false);
  }, { passive: true, capture: true });
  const released = () => { if (pull) pulled(pull.distance, true); pull = null; };
  document.addEventListener('touchend', released, { passive: true, capture: true }); document.addEventListener('touchcancel', () => { pulled(0, true); pull = null; }, { passive: true, capture: true });
  // A back request (the phone's back gesture, Esc) can reach this frame when it has focus: the app steps back.
  const watchBack = () => { if (!window.CloseWatcher) return; const watcher = new CloseWatcher(); watcher.onclose = () => { send('mrmak:report-back'); watchBack(); }; };
  watchBack();
  window.addEventListener('load', () => send('mrmak:report-ready'));
})();
</script>`);
}
