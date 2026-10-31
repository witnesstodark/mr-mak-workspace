import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { body, equalSecret, json, publicError, saveJson, secret } from './util.mjs';

// Claude Code runs PermissionRequest hooks while its AskUserQuestion dialog is
// already open (checked with Claude Code 2.1.314). The terminal and a phone
// therefore race: the first answer wins, a late hook answer is ignored and the
// terminal dialog is never hidden or delayed. PreToolUse would hold the dialog
// back until the hook finished, so it is not used.
export const HOOK_SCRIPT = fileURLToPath(new URL('./claude-question-hook.mjs', import.meta.url));
const WAIT = 20000, STALE = 75000, PICKUP = 5000, KEEP = 10 * 60 * 1000;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const clean = (value, limit) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, limit) : '';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Display form of AskUserQuestion's input: header, question, options and whether
// several options may be chosen. Text is bounded; nothing else is passed on.
export function questionItems(input) {
  const list = Array.isArray(input?.questions) ? input.questions : [];
  return list.slice(0, 8).filter(item => typeof item?.question === 'string' && item.question.trim()).map(item => ({
    question: clean(item.question, 2000), header: clean(item.header, 80), multiSelect: item.multiSelect === true,
    options: (Array.isArray(item.options) ? item.options : []).slice(0, 12).filter(option => typeof option?.label === 'string').map(option => ({
      label: clean(option.label, 300), description: clean(option.description, 1000),
      ...(typeof option.preview === 'string' && option.preview.trim() ? { preview: clean(option.preview, 4000) } : {}),
    })),
  }));
}
export const questionKey = items => JSON.stringify(items.map(item => item.question));

// Claude reads `answers` keyed by the exact question text. Several choices are
// one comma-separated string, as its own dialog sends them; free text is the
// user's words rather than the word "Other".
export function answeredInput(input, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail('Answer every question before sending.');
  const result = {};
  for (const item of input.questions) {
    const value = answers[item.question];
    const text = clean(Array.isArray(value) ? value.filter(part => typeof part === 'string' && part.trim()).join(', ') : value, 4000).trim();
    if (!text) fail('Answer every question before sending.');
    result[item.question] = text;
  }
  return { ...input, answers: result };
}

export class ClaudeQuestions extends EventEmitter {
  constructor({ stateDir, node = process.execPath }) {
    super();
    Object.assign(this, { stateDir, node });
    this.origin = ''; this.tokens = new Map(); this.items = new Map(); this.done = new Map(); this.written = null;
    this.timer = setInterval(() => this.sweep(), 15000); this.timer.unref();
  }

  get settingsFile() { return path.join(this.stateDir, 'claude-question-hooks.json'); }

  // Per-launch settings and environment. `--settings` adds this hook beside the
  // user's own hooks; their settings files are never edited.
  async launch(sessionId) {
    if (!this.origin) return null;
    this.end(sessionId);
    const token = secret();
    this.tokens.set(token, sessionId);
    const quote = value => `"${value.replaceAll('\\', '/')}"`;
    const settings = { hooks: { PermissionRequest: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: `${quote(this.node)} ${quote(HOOK_SCRIPT)}`, timeout: 86400 }] }] } };
    const text = JSON.stringify(settings);
    if (this.written !== text) { await saveJson(this.settingsFile, settings); this.written = text; }
    return { settings: this.settingsFile, env: { IAAR_QUESTION_URL: `${this.origin}/hooks/claude-question`, IAAR_QUESTION_TOKEN: token } };
  }

  // The terminal stopped: its token is revoked and any waiting hook is released.
  end(sessionId) {
    for (const [token, id] of this.tokens) if (id === sessionId) this.tokens.delete(token);
    this.closeWhere(item => item.sessionId === sessionId);
  }
  closeSession(sessionId) { this.closeWhere(item => item.sessionId === sessionId); }
  // The same question was answered or cancelled in the terminal.
  resolved(sessionId, key) { this.closeWhere(item => item.sessionId === sessionId && (!key || item.key === key)); }
  closeWhere(match) {
    for (const item of [...this.items.values()]) if (match(item)) this.remove(item, 'closed');
  }
  remove(item, status) {
    if (this.items.get(item.id) !== item) return;
    this.items.delete(item.id); item.status = status;
    item.wake?.(); item.picked?.(status === 'delivered');
    if (status === 'delivered') this.emit('delivered', item);
    this.emit('changed', item.sessionId);
  }
  pending(sessionId) {
    return [...this.items.values()].filter(item => item.sessionId === sessionId && item.status === 'pending').map(({ id, at, items, key }) => ({ id, at, key, questions: items, answerable: true }));
  }
  sweep() {
    const now = Date.now();
    // A hook stops polling only when Claude ended it; the dialog decides alone.
    for (const item of [...this.items.values()]) if (now - item.seen > STALE) this.remove(item, 'closed');
    for (const [id, done] of this.done) if (done.expires < now) this.done.delete(id);
  }

  async answer(sessionId, id, answers) {
    const item = this.items.get(id);
    if (!item || item.sessionId !== sessionId) {
      const done = this.done.get(id);
      if (done?.sessionId === sessionId && done.hash === digest(answers)) return { status: 'delivered', answers: done.answers };
      fail('This question was already answered or closed. Check the conversation.', 409);
    }
    if (item.status !== 'pending') fail('An answer to this question is already being delivered.', 409);
    item.updatedInput = answeredInput(item.input, answers);
    item.status = 'answered'; item.hash = digest(answers);
    const picked = new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), PICKUP); timer.unref();
      item.picked = value => { clearTimeout(timer); resolve(value); };
    });
    item.wake?.();
    if (await picked) return { status: 'delivered', answers: item.updatedInput.answers };
    // The hook is gone, so the answer cannot reach Claude this way.
    this.remove(item, 'closed');
    fail('The terminal stopped waiting for an answer from Iaar. Answer this question in the Terminal view.', 409);
  }

  async handle(request, response) {
    try {
      if (request.method !== 'POST') fail('Not allowed', 405);
      const header = String(request.headers['x-iaar-question-token'] || '');
      const sessionId = [...this.tokens].find(([token]) => equalSecret(token, header))?.[1];
      if (!sessionId) fail('Unknown chat', 401);
      const data = await body(request, 256 * 1024);
      if (data.action === 'ask') return json(response, 200, this.ask(sessionId, data.input));
      if (data.action === 'wait') return json(response, 200, await this.wait(sessionId, data.id, response));
      if (data.action === 'close') { const item = this.items.get(data.id); if (item?.sessionId === sessionId) this.remove(item, 'closed'); return json(response, 200, { status: 'closed' }); }
      fail('Unknown action');
    } catch (error) { if (!response.headersSent) json(response, error.status || 400, { error: publicError(error) }); }
  }

  ask(sessionId, input) {
    if (input?.tool_name !== 'AskUserQuestion') fail('Only AskUserQuestion is supported.');
    const items = questionItems(input.tool_input);
    if (!items.length || items.length !== input.tool_input.questions.length) fail('The question has no readable text.');
    if (this.pending(sessionId).length >= 8) fail('Too many open questions in this chat.', 429);
    const item = { id: randomUUID(), sessionId, at: new Date().toISOString(), seen: Date.now(), status: 'pending', input: input.tool_input, items, key: questionKey(items) };
    this.items.set(item.id, item);
    this.emit('asked', item); this.emit('changed', sessionId);
    return { id: item.id };
  }

  async wait(sessionId, id, response) {
    const item = this.items.get(id);
    if (!item || item.sessionId !== sessionId) return { status: 'closed' };
    item.seen = Date.now();
    if (item.status === 'pending') await new Promise(resolve => {
      const done = () => { clearTimeout(timer); response.off('close', done); if (item.wake === done) item.wake = null; resolve(); };
      const timer = setTimeout(done, WAIT);
      item.wake = done; response.once('close', done);
    });
    item.seen = Date.now();
    if (this.items.get(id) !== item) return { status: 'closed' };
    if (item.status !== 'answered') return { status: 'pending' };
    // Leave the answer for the next poll if this hook connection already ended.
    if (response.destroyed || response.writableEnded) return { status: 'pending' };
    this.done.set(item.id, { sessionId, hash: item.hash, answers: item.updatedInput.answers, expires: Date.now() + KEEP });
    this.remove(item, 'delivered');
    return { status: 'answered', updatedInput: item.updatedInput };
  }

  close() {
    clearInterval(this.timer);
    for (const item of [...this.items.values()]) this.remove(item, 'closed');
    this.tokens.clear();
  }
}
