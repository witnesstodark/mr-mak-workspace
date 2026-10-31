/**
 * Game UI Studio - connection to Mr. Mak agent sessions
 *
 * Inside Mr. Mak the studio runs in the isolated report origin, which cannot call
 * the desktop API. The Workspace window then relays a few studio requests
 * (src/desktop/studioBridge.ts): list project folders, read and save the
 * studio's project list, draft and preferences (Mr. Mak keeps them), start or reuse a studio
 * chat, send a prompt, read its conversation transcript and open terminal menu,
 * answer that menu, open the chat.
 * Served from the API origin with a token (tests), the same actions call the API
 * directly. Otherwise the studio is offline and the Copilot only explains that.
 */

const TIMEOUTS = { hello: 1500, list: 15000, start: 60000, send: 15000, messages: 15000, answer: 30000, open: 10000 };

export function createAgentLink({ token = '' } = {}) {
  let mode = 'offline';
  let agents = null;
  let seq = 0;
  const pending = new Map();
  const embedded = window.parent && window.parent !== window;
  let parentOrigin = '*';
  try { parentOrigin = window.location.ancestorOrigins?.[0] || '*'; } catch { /* Not available in every engine. */ }

  window.addEventListener('message', event => {
    if (!embedded || event.source !== window.parent) return;
    if (parentOrigin !== '*' && event.origin !== parentOrigin) return;
    const data = event.data;
    if (!data || data.type !== 'mrmak:studio-response' || !pending.has(data.id)) return;
    const { resolve, reject, timer } = pending.get(data.id);
    pending.delete(data.id);
    clearTimeout(timer);
    if (data.ok) resolve(data.value);
    else reject(new Error(data.error || 'The request failed.'));
  });

  function viaParent(action, payload = {}) {
    const id = `studio-${Date.now().toString(36)}-${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(action === 'hello' ? 'No Mr. Mak bridge.' : 'Mr. Mak did not answer in time.'));
      }, TIMEOUTS[action] || 15000);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ type: 'mrmak:studio-request', id, action, payload }, parentOrigin);
    });
  }

  async function http(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
    return value;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // A new CLI needs a moment before it accepts a pasted prompt: wait until it
  // runs and its terminal has been quiet briefly.
  async function waitReady(id) {
    const started = Date.now();
    while (Date.now() - started < 25000) {
      const s = await http('GET', `/api/sessions/${encodeURIComponent(id)}/screen`).catch(() => null);
      if (s?.status === 'exited' || s?.status === 'stopped') throw new Error('The agent chat stopped while starting.');
      const quiet = s?.lastOutputAt ? Date.now() - Date.parse(s.lastOutputAt) : Infinity;
      if (s?.status === 'running' && Date.now() - started > 2500 && quiet > 1500) return;
      await sleep(500);
    }
  }

  async function direct(action, p = {}) {
    const sid = encodeURIComponent(p.id || '');
    switch (action) {
      case 'list': {
        const value = await http('GET', `/api/files?path=${encodeURIComponent(p.path || '')}`);
        return { entries: (value.entries || []).filter(e => e.directory).map(e => ({ name: e.name, path: e.path })) };
      }
      case 'state':
        return http('GET', '/api/ui-studio/state');
      case 'save-state':
        return http('POST', '/api/ui-studio/state', { projects: p.projects, draft: p.draft, prefs: p.prefs });
      case 'start': {
        const session = await http('POST', '/api/sessions', { agent: p.agent, cwd: p.cwd || undefined, effort: p.effort, name: p.name, bypass: false, background: true });
        await waitReady(session.id);
        return { id: session.id, agent: session.agent, reused: false };
      }
      case 'send':
        // A studio chat runs at the effort picked in the Copilot, so effort advice never holds it.
        return http('POST', `/api/sessions/${sid}/send`, { text: p.text, effort: { action: 'keep' } });
      case 'messages': {
        const [m, s] = await Promise.all([http('GET', `/api/sessions/${sid}/messages`), http('GET', `/api/sessions/${sid}/screen`)]);
        return {
          supported: !!m.supported,
          messages: (m.messages || []).slice(-40),
          prompt: m.prompt || null,
          activity: s.activity || null,
          status: s.status || null,
          screen: m.supported ? undefined : s.screen
        };
      }
      case 'answer':
        return http('POST', `/api/sessions/${sid}/prompt`, { id: p.prompt, choice: p.choice });
      case 'open':
        return http('POST', `/api/sessions/${sid}/focus`, {});
      default:
        throw new Error(`Unknown action ${action}`);
    }
  }

  const ready = (async () => {
    if (embedded) {
      try {
        const hello = await viaParent('hello');
        agents = Array.isArray(hello?.agents) ? hello.agents : null;
        mode = 'bridge';
        return mode;
      } catch { /* Not inside Mr. Mak, or an older Workspace without the bridge. */ }
    }
    if (token) {
      try {
        const res = await fetch('/health');
        if (res.ok) { mode = 'direct'; return mode; }
      } catch { /* No service on this origin. */ }
    }
    mode = 'offline';
    return mode;
  })();

  return {
    ready,
    get mode() { return mode; },
    get agents() { return agents; },
    async call(action, payload) {
      await ready;
      if (mode === 'bridge') return viaParent(action, payload);
      if (mode === 'direct') return direct(action, payload);
      throw new Error('Open the studio from Mr. Mak to reach an agent.');
    }
  };
}
