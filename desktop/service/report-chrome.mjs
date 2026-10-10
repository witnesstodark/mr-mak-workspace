import {createReadStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {reportThemeCSS} from './report-theme.mjs';

// Shared browser chrome and external-link routing. The selected reader theme
// applies to standard reports; custom designs and artwork keep their colours.
function preludeFor({theme = 'dark', parentOrigin = ''} = {}) {
  theme = theme === 'light' ? 'light' : 'dark';
  const trustedOrigin = JSON.stringify(parentOrigin).replace(/</g, '\\u003c');
  return Buffer.from(`<meta name="color-scheme" content="${theme}"><style data-mrmak-chrome>
html{color-scheme:dark;background-color:#101115;color:#d3d0d9}
html,body,body *{scrollbar-color:#514c59 #111217!important;scrollbar-width:thin}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:#111217!important}
::-webkit-scrollbar-thumb{background:#514c59!important;border:2px solid #111217;border-radius:6px}
${reportThemeCSS}
</style><script data-mrmak-links>
(() => {
  const setTheme = theme => { if (theme === 'dark' || theme === 'light') document.documentElement.dataset.mrmakTheme = theme; };
  setTheme('${theme}');
  const scrollKey = () => 'mrmak:scroll:' + location.pathname + location.hash;
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== ${trustedOrigin}) return;
    if (event.data?.type === 'mrmak:theme') setTheme(event.data.theme);
    if (event.data?.type === 'mrmak:reload') {
      try { sessionStorage.setItem(scrollKey(), String(window.scrollY)); } catch { /* Storage can be disabled. */ }
      location.reload();
    }
  });
  // Load runs after the report's route and its resources. Two frames allow the
  // route's layout to settle before restoring the window's scroll position.
  window.addEventListener('load', () => requestAnimationFrame(() => requestAnimationFrame(() => {
    const key = scrollKey();
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        const y = Number(saved);
        if (Number.isFinite(y)) window.scrollTo({ top: y, left: 0, behavior: 'instant' });
        sessionStorage.removeItem(key);
      }
    } catch { /* Storage can be disabled. */ }
  })));
  const route = event => {
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || event.defaultPrevented) return;
    const url = new URL(link.href, location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin) return;
    link.target = '_blank';
    link.relList.add('noopener', 'noreferrer');
  };
  document.addEventListener('click', route, true);
  document.addEventListener('auxclick', route, true);
})();
</script>`);
}

export function reportChromeStream(options) {
  const prelude = preludeFor(options);
  let pending = Buffer.alloc(0), inserted = false;
  const emit = function () {
    const text = pending.toString('utf8');
    // Preserve doctype, charset declarations and original bytes, including BOM.
    const head = /<head(?:\s[^>]*)?>/i.exec(text);
    const fallback = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(text);
    const position = head ? head.index + head[0].length : fallback ? fallback[0].length : text.startsWith('\uFEFF') ? 1 : 0;
    const offset = Buffer.byteLength(text.slice(0, position));
    this.push(pending.subarray(0, offset)); this.push(prelude); this.push(pending.subarray(offset));
    pending = null; inserted = true;
  };
  return new Transform({
    transform(chunk, encoding, callback) {
      if (inserted) this.push(chunk);
      else {
        pending = Buffer.concat([pending, chunk]);
        if (/<head(?:\s[^>]*)?>/i.test(pending.toString('utf8')) || pending.length >= 65536) emit.call(this);
      }
      callback();
    },
    flush(callback) { if (!inserted) emit.call(this); callback(); },
  });
}

export async function serveReport(request, response, file, info, headers) {
  const options = {theme: new URL(request.url, 'http://localhost').searchParams.get('mrmak-theme'), parentOrigin: headers['Access-Control-Allow-Origin'] || ''};
  const prelude = preludeFor(options);
  response.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Content-Length':info.size + prelude.length, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', ...headers});
  if (request.method === 'HEAD') { response.end(); return; }
  await pipeline(createReadStream(file), reportChromeStream(options), response).catch(error => {
    if (!request.destroyed && !response.destroyed) throw error;
  });
}
