import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { englishTitle } from './titles.mjs';

const MARKER = 'Mr. Mak handoff request';
export const HANDOFF_REQUEST = `${MARKER}: this conversation is getting long. Write a handoff for a fresh chat that will continue this work in the same project. Do not change files or run commands. Reply with Markdown only, starting with the heading "# Handoff", covering the goal, current state, decisions and their reasons, files touched, open problems and the exact next steps. Include the paths, commands and IDs a new chat needs; leave out what it can read in the repository.`;
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
export class Handoffs {
  constructor({ repo, sessions, transcripts, opened, changed }) {
    Object.assign(this, { repo, sessions, transcripts, opened, changed });
    this.jobs = new Map();
  }
  state(id) { return this.jobs.get(id) || null; }
  update(id, value) { const job = { ...this.jobs.get(id), ...value, at: new Date().toISOString() }; this.jobs.set(id, job); this.changed(id, job); return job; }
  start(id) {
    const session = this.sessions.get(id);
    if (!['claude', 'codex'].includes(session.agent)) throw new Error('A handoff is available for Claude Code and Codex chats.');
    if (!session.process) throw new Error('Reconnect this chat before asking for a handoff.');
    if (session.activity === 'working') throw new Error('Wait for the agent to finish its current turn.');
    if (['summarizing', 'opening'].includes(this.jobs.get(id)?.status)) return this.jobs.get(id);
    const baseline = session.completionVersion;
    this.sessions.input(id, HANDOFF_REQUEST, { coordinator: true, submit: true });
    const job = this.update(id, { status: 'summarizing', error: null, sessionId: null, file: null });
    this.finish(id, baseline).catch(error => this.update(id, { status: 'failed', error: error.message }));
    return job;
  }
  async finish(id, baseline) {
    await this.completed(id, baseline);
    const session = this.sessions.get(id);
    const text = handoffText((await this.transcripts.read(session)).messages);
    if (!text) throw new Error('The agent did not reply with a handoff. Its answer is in the chat; try again or continue there.');
    const now = new Date(), folder = path.join(this.repo, 'inbox', 'handoffs');
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, fileName(session.name, now));
    await writeFile(file, `${text}\n\n---\nFrom the ${session.agent === 'claude' ? 'Claude Code' : 'Codex'} chat "${session.name}" in ${session.cwd}, ${now.toISOString()}.\n`, 'utf8');
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
