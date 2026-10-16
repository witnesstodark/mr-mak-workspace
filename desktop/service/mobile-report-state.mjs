// The opaque mobile report can report its own route/scroll only. It cannot call app APIs.
export function mobileReportStatePrelude(parentOrigin) {
  const origin = JSON.stringify(parentOrigin).replace(/</g, '\\u003c');
  return Buffer.from(`<script data-mrmak-mobile-state>
(() => {
  const target = ${origin}, tracked = new Set(); let restoring = true, restored = false, timer = 0, restoreVersion = 0;
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
    // One restore per document: a late duplicate must not undo a newer position.
    if (restored) return; restored = true;
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
  window.addEventListener('load', () => send('mrmak:report-ready'));
})();
</script>`);
}
