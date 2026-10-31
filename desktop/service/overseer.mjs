// Overseer mode: while the owner keeps it on, Mr. Mak looks after the open
// chats. A chat that stalled is handed to the coordinator once per stall, so a
// quiet workspace spends no coordinator turns.
export const OVERSEER_CHECK_MS = 3 * 60_000;
const STALLED_MS = 12 * 60_000, WAITING_MS = 5 * 60_000;

// Chats that need a look now. A chat counts once for each state it stalls in.
export function stalledChats(chats, now = Date.now(), seen = new Set()) {
  return chats.flatMap(chat => {
    if (chat.agent === 'shell' || chat.status !== 'running') return [];
    const quiet = now - Date.parse(chat.lastOutputAt || chat.createdAt || 0);
    const reason = chat.activity === 'working' && quiet > STALLED_MS ? 'working without output'
      : (chat.activity === 'waiting' || chat.attention) && quiet > WAITING_MS ? 'waiting for an answer' : '';
    const key = `${chat.id}:${chat.activity}:${chat.lastOutputAt}`;
    return reason && !seen.has(key) ? [{ id: chat.id, name: chat.name, agent: chat.agent, reason, quietMinutes: Math.round(quiet / 60_000), key }] : [];
  });
}

export const overseerRequest = stalled => `Overseer check (automatic, the owner turned Overseer mode on). These chats look stalled: ${JSON.stringify(stalled.map(({ key, ...chat }) => chat))}
For each one, read its screen. If it stopped on a usage limit, a network or API error, or an unfinished turn that only needs to continue, send it a short message to continue its task. If it asks the owner a question or a permission, do not answer it: focus the chat and say what it needs. If it is still making progress, leave it alone. Do not open new chats. Answer with one short line per chat saying what you did.`;

export class Overseer {
  constructor({ chats, ask, enabled }) { Object.assign(this, { chats, ask, enabled }); this.seen = new Set(); this.timer = null; this.running = false; }
  update() {
    if (this.enabled() && !this.timer) { this.timer = setInterval(() => void this.check().catch(() => {}), OVERSEER_CHECK_MS); this.timer.unref?.(); }
    if (!this.enabled() && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  async check(now = Date.now()) {
    if (!this.enabled() || this.running) return null;
    const stalled = stalledChats(this.chats(), now, this.seen);
    if (!stalled.length) return null;
    for (const chat of stalled) this.seen.add(chat.key);
    if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));
    this.running = true;
    try { return await this.ask({ id: `overseer-${now}`, text: overseerRequest(stalled) }); }
    finally { this.running = false; }
  }
  close() { clearInterval(this.timer); this.timer = null; }
}
