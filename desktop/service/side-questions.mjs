import { randomUUID } from 'node:crypto';
import { terminalPrompt } from './terminal-prompt.mjs';

// Claude Code answers /btw in a panel that takes the place of its prompt, and it
// never writes the exchange to the transcript, so the answer is read from the
// terminal. Claude Code 2.1 draws, under the prompt's top edge:
//
//     /btw <question, cut to the terminal width>
//
//       <answer, or "✽ Answering…">
//
//     ↑/↓ to scroll · c to copy · f to fork · Esc to close
const HINT = /(?:^|·\s+)Esc to close$/;
const indent = line => line.length - line.trimStart().length;
const LIST = /^\s*(?:[-*•·◦▪]|\d+[.)])\s/;

export function sideQuestionPanel(screen) {
  const lines = String(screen || '').split('\n').map(line => line.replace(/\s+$/, ''));
  let hint = -1;
  // The key hint is the panel's last line; at most a status line sits below it.
  for (let index = lines.length - 1, seen = 0; index >= 0 && seen < 3; index--) {
    if (!lines[index]) continue;
    if (HINT.test(lines[index].trim())) { hint = index; break; }
    seen++;
  }
  if (hint < 0) return null;
  // Earlier questions are listed above the current one; answer lines sit deeper.
  let top = -1;
  for (let index = hint - 1; index >= Math.max(0, hint - 150); index--) {
    if (/▔{8}/.test(lines[index])) break;
    if (indent(lines[index]) === indent(lines[hint]) && /^\/btw(?:\s|$)/.test(lines[index].trimStart())) { top = index; break; }
  }
  if (top < 0) return null;
  // The answer box and the hint each have a blank line above them.
  const box = lines.slice(top + 1, hint);
  if (box.length && !box[0]) box.shift();
  if (box.length && !box.at(-1)) box.pop();
  const keys = lines[hint].trim(), first = box.find(Boolean)?.trim() || '';
  const answered = /\bc to copy\b|Copied to clipboard/.test(keys);
  const waiting = !answered && (!first || /^\S?\s*Answering…/.test(first) || /retrying in \d+s/.test(first));
  return { question: lines[top].trim().replace(/^\/btw\s*/, ''), box, state: answered ? 'answered' : waiting ? 'answering' : 'failed' };
}

// The panel shows the question whitespace-collapsed and cut with an ellipsis.
export function sameQuestion(shown, asked) {
  const value = String(shown || '').replace(/\s+/g, ' ').trim(), full = String(asked || '').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  return value === full || (value.endsWith('…') && value.length > 1 && full.startsWith(value.slice(0, -1).trimEnd()));
}

// ↓ scrolls a long answer. The new view repeats the end of the previous one.
export function scrolled(previous, view) {
  for (let overlap = Math.min(previous.length, view.length); overlap > 0; overlap--) {
    if (previous.slice(-overlap).every((line, index) => line === view[index])) return { lines: [...previous, ...view.slice(overlap)], gap: false };
  }
  return { lines: [...previous, ...view], gap: true };
}

// Ink wraps the answer at the panel's width. A line the next word would have
// overflowed was wrapped there; joining it lets the bubble wrap to its own width.
export function answerText(box, cols = 100) {
  const depths = box.filter(line => line.trim()).map(indent), cut = depths.length ? Math.min(...depths) : 0;
  const lines = box.map(line => line.slice(cut));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const out = [];
  let physical = 0;
  for (const line of lines) {
    const word = line.trimStart().split(/\s/)[0];
    if (out.length && line.trim() && out.at(-1).trim() && !LIST.test(line) && cut + physical + 1 + word.length > cols - 4) out[out.length - 1] += ` ${line.trim()}`;
    else out.push(line);
    physical = line.length;
  }
  return out.join('\n');
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const conflict = message => Object.assign(new Error(message), { status: 409 });
const BUSY = ['asking', 'answering'];

export class SideQuestions {
  constructor(sessions, { poll = 500, appear = 20000, timeout = 180000, redraw = 700 } = {}) {
    this.sessions = sessions; this.items = new Map();
    this.timing = { poll, appear, timeout, redraw };
  }

  list(id) { return (this.items.get(id) || []).map(entry => ({ ...entry })); }
  busy(id) { return (this.items.get(id) || []).some(entry => BUSY.includes(entry.status)); }
  async screen(id) { return (await this.sessions.read(id, 150)).screen; }

  // An open panel takes every key, so a message pasted into it is lost.
  async guard(id) {
    const session = this.sessions.get(id);
    if (session.agent !== 'claude' || !session.process) return;
    if (this.busy(id) || sideQuestionPanel(await this.screen(id))) throw conflict('A /btw side question is open in the terminal. Send again once it is answered, or close it there with Esc.');
  }

  async ask(id, text) {
    const session = this.sessions.get(id);
    if (session.agent !== 'claude') throw new Error('Side questions (/btw) are available in Claude Code chats.');
    if (!session.process) throw new Error('Reconnect this chat before asking a side question.');
    const question = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!question) throw new Error('Write the side question first.');
    if (question.length > 4000) throw new Error('Keep a side question under 4,000 characters.');
    if (this.busy(id)) throw conflict('Wait for the current side question to be answered.');
    const screen = await this.screen(id);
    if (sideQuestionPanel(screen)) throw conflict('A /btw answer is open in the terminal. Close it there with Esc first.');
    if (terminalPrompt(screen)) throw conflict('The terminal is asking a question. Answer it before a side question.');
    this.sessions.input(id, `/btw ${question}`, { coordinator: true, submit: true });
    const entry = { id: randomUUID(), question, answer: '', status: 'asking', at: new Date().toISOString() };
    this.items.set(id, [...(this.items.get(id) || []), entry].slice(-20));
    this.watch(id, entry, session.process).catch(() => { if (BUSY.includes(entry.status)) entry.status = 'unavailable'; });
    return { ...entry };
  }

  async watch(id, entry, proc) {
    const started = Date.now();
    let seen = false, previous = null;
    while (Date.now() - started < this.timing.timeout) {
      await delay(this.timing.poll);
      if (this.sessions.get(id).process !== proc) { entry.status = 'stopped'; return; }
      const { screen, cols } = await this.sessions.read(id, 150);
      const panel = sideQuestionPanel(screen);
      if (!panel || !sameQuestion(panel.question, entry.question)) {
        // Closed in the terminal before it answered, or never opened: an older CLI
        // without /btw, or a dialog that took the text.
        if (seen || Date.now() - started > this.timing.appear) { entry.status = seen ? 'closed' : 'unavailable'; return; }
        continue;
      }
      seen = true;
      if (panel.state === 'answering') { entry.status = 'answering'; previous = null; continue; }
      // A read can land mid-frame: take the answer once two reads agree.
      const frame = panel.box.join('\n');
      if (frame !== previous) { previous = frame; continue; }
      const { lines, partial } = await this.scroll(id, entry, panel.box);
      entry.answer = answerText(lines, cols);
      if (partial) entry.partial = true;
      entry.status = panel.state;
      await this.dismiss(id, entry);
      return;
    }
    entry.status = 'unavailable';
  }

  // ↓ only redraws the panel while there is more answer below.
  async scroll(id, entry, box) {
    let lines = box, partial = false;
    for (let step = 0; step < 80; step++) {
      const before = await this.screen(id);
      const shown = sideQuestionPanel(before);
      if (!shown || !sameQuestion(shown.question, entry.question)) return { lines, partial };
      this.sessions.keys(id, '\x1b[B');
      let view = null;
      for (const end = Date.now() + this.timing.redraw; Date.now() < end;) {
        await delay(60);
        const panel = sideQuestionPanel(await this.screen(id));
        if (!panel || !sameQuestion(panel.question, entry.question)) return { lines, partial };
        if (panel.box.join('\n') !== shown.box.join('\n')) { view = panel.box; break; }
      }
      if (!view) return { lines, partial };
      const next = scrolled(lines, view);
      if (next.lines.length === lines.length) return { lines, partial };
      lines = next.lines; partial ||= next.gap;
    }
    return { lines, partial: true };
  }

  // Esc is the panel's own key. It is sent only while the panel is on screen:
  // in the prompt, Esc interrupts the agent.
  async dismiss(id, entry) {
    const panel = sideQuestionPanel(await this.screen(id));
    if (!panel || !sameQuestion(panel.question, entry.question)) return;
    this.sessions.keys(id, '\x1b');
    entry.closed = true;
  }
}
