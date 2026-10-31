import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { englishTitle } from './titles.mjs';
import { compactCommand } from './context-alerts.mjs';
import { terminalPrompt } from './terminal-prompt.mjs';
import { readJson, saveJson } from './util.mjs';

const MARKER = 'Mr. Mak handoff request';
export const HANDOFF_REQUEST = `${MARKER}: this conversation is getting long. Write a handoff for a fresh chat that will continue this work in the same project. Do not change files or run commands. Reply with Markdown only, starting with the heading "# Handoff", covering the goal, current state, decisions and their reasons, files touched, open problems and the exact next steps. Include the paths, commands and IDs a new chat needs; leave out what it can read in the repository.`;
// The same request before a break; the reply is read the same way.
export const PAUSE_REQUEST = `${MARKER}: the owner is pausing and may return after this chat's prompt cache has expired. ${HANDOFF_REQUEST.slice(HANDOFF_REQUEST.indexOf('Write a handoff'))}`;
const WAIT = 15 * 60 * 1000;

// The reply to the latest request, from its "# Handoff" heading. Earlier
// requests and unrelated answers are never used.
export function handoffText(messages) {
  const request = messages.findLastIndex(item => item.role === 'user' && item.text.includes(MARKER));
  if (request < 0) return null;
  const reply = messages.slice(request + 1).filter(item => item.role === 'assistant' && /^#\s*Handoff\b/im.test(item.text)).pop();
  if (!reply) return null;
  return reply.text.slice(reply.text.search(/^#\s*Handoff\b/im)).trim();
}

const fileName = (name, at) => `${at.toISOString().slice(0, 10)}-${(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chat').slice(0, 50)}-${randomUUID().slice(0, 8)}.md`;

// Asks a long chat for its own summary, saves it in inbox/handoffs and opens a
// new chat in the same project that starts by reading it. One job per chat.
// A pause writes the summary while the cache is warm and opens nothing: on the
// owner's return the chat offers a new chat from it, so the new chat's cache
// starts then, or simply continuing in this chat. Paused handoffs are saved in
// stateDir, since the owner may return after the service has restarted.
export class Handoffs {
  constructor({ repo, stateDir = null, sessions, transcripts, opened, changed }) {
    Object.assign(this, { repo, sessions, transcripts, opened, changed });
    this.file = stateDir && path.join(stateDir, 'paused-handoffs.json');
    this.jobs = new Map();
  }
  // Restores the pauses of chats that still exist and whose handoff file is still there.
  async init() {
    const saved = this.file ? await readJson(this.file, {}) : {};
    for (const [id, job] of Object.entries(saved && typeof saved === 'object' ? saved : {})) {
      if (typeof job?.file !== 'string' || !this.exists(id) || !await access(job.file).then(() => true, () => false)) continue;
      this.jobs.set(id, { status: 'paused', pause: true, error: null, sessionId: null, file: job.file, at: job.at });
    }
    if (this.file && Object.keys(saved || {}).length !== this.jobs.size) this.persist();
    return this;
  }
  exists(id) { try { this.sessions.get(id); return true; } catch { return false; } }
  state(id) { return this.jobs.get(id) || null; }
  update(id, value) {
    const was = this.jobs.get(id)?.status, job = { ...this.jobs.get(id), ...value, at: new Date().toISOString() };
    this.jobs.set(id, job); this.changed(id, job);
    if (was === 'paused' || job.status === 'paused') this.persist();
    return job;
  }
  persist() {
    if (!this.file) return;
    const paused = Object.fromEntries([...this.jobs].filter(([, job]) => job.status === 'paused').map(([id, { file, at }]) => [id, { file, at }]));
    // `saved` lets a caller wait for the write; saveJson keeps writes to one file in order.
    this.saved = saveJson(this.file, paused).catch(error => console.error(`Paused handoffs could not be saved: ${error.message}`));
  }
  start(id, { pause = false } = {}) {
    const session = this.sessions.get(id);
    if (!['claude', 'codex'].includes(session.agent)) throw new Error('A handoff is available for Claude Code and Codex chats.');
    if (!session.process) throw new Error('Reconnect this chat before asking for a handoff.');
    if (session.activity === 'working') throw new Error('Wait for the agent to finish its current turn.');
    if (['summarizing', 'opening'].includes(this.jobs.get(id)?.status)) return this.jobs.get(id);
    const baseline = session.completionVersion;
    this.sessions.input(id, pause ? PAUSE_REQUEST : HANDOFF_REQUEST, { coordinator: true, submit: true });
    const job = this.update(id, { status: 'summarizing', pause, error: null, sessionId: null, file: null });
    this.finish(id, baseline, !pause).catch(error => this.update(id, { status: 'failed', error: error.message }));
    return job;
  }
  // Sends the CLI's own /compact, which summarizes the conversation in place. Only
  // the user starts it, from the long-chat or idle-cache alert; it is never automatic.
  async compact(id) {
    const session = this.sessions.get(id);
    const command = compactCommand(session.agent);
    if (!command) throw new Error('This agent has no compact command. Use a handoff instead.');
    if (!session.process) throw new Error('Reconnect this chat before compacting it.');
    if (session.activity !== 'idle') throw new Error('Wait for the agent to finish its current turn.');
    if (['summarizing', 'opening'].includes(this.jobs.get(id)?.status)) throw new Error('This chat is writing a handoff.');
    // A permission or choice menu would take the command as its answer.
    if (terminalPrompt((await this.sessions.read(id, 60)).screen)) throw new Error('Answer the question in this chat first.');
    this.sessions.input(id, command, { coordinator: true, submit: true });
    return { command };
  }
  pause(id) { return this.start(id, { pause: true }); }
  // After a pause: a new chat from the saved handoff, or back to this chat.
  async continueFromPause(id) {
    const job = this.jobs.get(id);
    if (job?.status !== 'paused' || !job.file) throw new Error('This chat has no paused handoff.');
    await this.open(id, job.file);
  }
  dismiss(id) { if (this.jobs.get(id)?.status === 'paused') { this.jobs.delete(id); this.changed(id, null); this.persist(); } return null; }
  async finish(id, baseline, open = true) {
    await this.completed(id, baseline);
    const session = this.sessions.get(id);
    const text = handoffText((await this.transcripts.read(session)).messages);
    if (!text) throw new Error('The agent did not reply with a handoff. Its answer is in the chat; try again or continue there.');
    const now = new Date(), folder = path.join(this.repo, 'inbox', 'handoffs');
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, fileName(session.name, now));
    await writeFile(file, `${text}\n\n---\nFrom the ${session.agent === 'claude' ? 'Claude Code' : 'Codex'} chat "${session.name}" in ${session.cwd}, ${now.toISOString()}.\n`, 'utf8');
    if (!open) { this.update(id, { status: 'paused', file }); return; }
    await this.open(id, file);
  }
  async open(id, file) {
    const session = this.sessions.get(id), folder = path.dirname(file);
    this.update(id, { status: 'opening', file });
    const next = await this.sessions.create({
      agent: session.agent, cwd: session.cwd, bypass: session.bypass, effort: session.effort,
      name: englishTitle(`${session.name.replace(/ · continued$/, '')} · continued`, session.name),
      initialPrompt: `Continue the work from the previous chat '${session.name.replace(/"/g, "'")}'. First read its handoff: \`${file}\`. Then state the next step in one sentence and continue.`,
      readDir: folder,
    });
    this.update(id, { status: 'done', sessionId: next.id });
    this.opened(next.id);
  }
  completed(id, baseline) {
    return new Promise((resolve, reject) => {
      const done = (error) => { clearTimeout(timer); this.sessions.off('session', check); error ? reject(error) : resolve(); };
      const check = session => {
        if (session.id !== id) return;
        if (session.completionVersion > baseline) done();
        else if (!['running', 'starting'].includes(session.status)) done(new Error('The chat stopped before its handoff was written.'));
      };
      const timer = setTimeout(() => done(new Error('No handoff after 15 minutes. Check the chat; it may be waiting for you.')), WAIT);
      timer.unref?.();
      this.sessions.on('session', check);
    });
  }
}
