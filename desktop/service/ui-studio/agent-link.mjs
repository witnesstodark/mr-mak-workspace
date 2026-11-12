/**
 * Game UI Studio - connection to Mr. Mak agent sessions
 *
 * Mr. Mak serves the studio from its app on an isolated origin of its own,
 * which cannot call the desktop API. The Workspace window relays a few studio
 * requests (src/desktop/studioBridge.ts): list project folders, read and save the
 * studio's project list, draft and preferences (Mr. Mak keeps them), start or
 * reuse a studio chat, send a prompt, read its conversation transcript and open
 * terminal menu, answer that menu, open the chat. The Workspace window asks the
 * owner to confirm anything that reaches a chat, so those requests can wait for
 * a person. Outside Mr. Mak the studio is offline and the Copilot only explains
 * that.
 */

const CONFIRM_MS = 10 * 60 * 1000;
const TIMEOUTS = { hello: 1500, list: 15000, state: 15000, 'save-state': 15000, start: CONFIRM_MS + 60000, send: CONFIRM_MS, messages: 15000, answer: CONFIRM_MS, open: 10000 };

export function createAgentLink() {
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

  const ready = (async () => {
    if (embedded) {
      try {
        const hello = await viaParent('hello');
        agents = Array.isArray(hello?.agents) ? hello.agents : null;
        mode = 'bridge';
        return mode;
      } catch { /* Not inside Mr. Mak, or an older Workspace without the bridge. */ }
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
      throw new Error('Open the studio from Mr. Mak to reach an agent.');
    }
  };
}
