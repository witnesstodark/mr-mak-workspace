import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Claude Code asks some things only in its terminal: AskUserQuestion's picker
// and ExitPlanMode's plan approval. Neither reaches its transcript until it is
// answered, so chats started by Mr. Mak get a PreToolUse hook that saves the
// question (claude-prompt-hook.mjs). The phone shows it, and an answer is given
// by pressing the keys a person would, checking the terminal before each key.

export const PROMPT_TOOLS = { AskUserQuestion: 'question', ExitPlanMode: 'plan' };
const HOOK = fileURLToPath(new URL('./claude-prompt-hook.mjs', import.meta.url));
const DOWN = '\x1b[B', UP = '\x1b[A', ENTER = '\r', SPACE = ' ';
const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
const squash = value => String(value).replace(/\s+/g, ' ').trim();

// The settings file given to every Claude chat with --settings. It only adds the
// hook; the user's own settings and hooks still apply.
export async function promptHookSettings(stateDir) {
  const dir = path.join(stateDir, 'claude-prompts'), file = path.join(stateDir, 'claude-prompt-settings.json');
  await mkdir(dir, { recursive: true });
  const quote = value => `"${process.platform === 'win32' ? value.replaceAll('\\', '/') : value}"`;
  const command = [process.execPath, HOOK, dir].map(quote).join(' ');
  await writeFile(file, JSON.stringify({ hooks: { PreToolUse: [{ matcher: Object.keys(PROMPT_TOOLS).join('|'), hooks: [{ type: 'command', command, timeout: 10 }] }] } }, null, 2));
  return { dir, file };
}

export function cleanPrompt(saved) {
  const kind = PROMPT_TOOLS[saved?.tool];
  if (!kind || typeof saved.id !== 'string' || !saved.id) return null;
  if (kind === 'plan') return { kind, id: saved.id, at: text(saved.at, 40), plan: text(saved.input?.plan, 200000) };
  const questions = (Array.isArray(saved.input?.questions) ? saved.input.questions : []).slice(0, 8).map(item => ({
    question: text(item?.question, 2000), header: text(item?.header, 80), multiSelect: item?.multiSelect === true,
    options: (Array.isArray(item?.options) ? item.options : []).slice(0, 8).map(option => ({ label: text(option?.label, 300), description: text(option?.description, 1000) })).filter(option => option.label),
  })).filter(item => item.question && item.options.length);
  return questions.length ? { kind, id: saved.id, at: text(saved.at, 40), questions } : null;
}

// The prompt a chat's hook saved, if it was saved after `since` (ms).
export async function readPrompt(dir, nativeId, since = 0) {
  if (!dir || !/^[A-Za-z0-9-]{1,128}$/.test(nativeId || '')) return null;
  const file = path.join(dir, `${nativeId}.json`);
  const info = await stat(file).catch(() => null);
  if (!info || info.mtimeMs < since) return null;
  try { return { ...cleanPrompt(JSON.parse(await readFile(file, 'utf8'))), mtime: info.mtimeMs }; } catch { return null; }
}

export function promptSummary(prompt) {
  return prompt.kind === 'plan' ? 'A plan is waiting for your approval.' : squash(prompt.questions[0].question).slice(0, 300);
}

// ---- Reading the terminal ----

const ROW = /^\s*(❯)?\s*(\d+)\.\s+(?:\[(.)\]\s+)?(.*?)\s*$/;
const SUBMIT = /^\s*(❯)?\s+Submit\s*$/;
const FOOTER = /Enter to (?:select|confirm)|Esc to cancel|ctrl\+g to edit/;

function lastLine(lines, match) {
  for (let index = lines.length - 1; index >= 0; index--) if (match(lines[index])) return index;
  return -1;
}

// Numbered rows (and a multi-select question's Submit row) from the line after
// `start` to the menu's footer. Descriptions and separators are skipped.
function rows(lines, start) {
  const found = [];
  for (let index = start + 1; index < lines.length && !FOOTER.test(lines[index]); index++) {
    const row = ROW.exec(lines[index]);
    if (row && Number(row[2]) === (found.filter(item => item.number).length + 1)) found.push({ number: Number(row[2]), label: row[4], checked: row[3] === undefined ? undefined : row[3] !== ' ', cursor: !!row[1] });
    else if (SUBMIT.test(lines[index])) found.push({ number: 0, label: 'Submit', submit: true, cursor: !!SUBMIT.exec(lines[index])[1] });
  }
  return found;
}

export function sameLabel(shown, wanted) {
  shown = squash(shown); wanted = squash(wanted);
  return shown === wanted || (shown.endsWith('…') && shown.length > 1 && wanted.startsWith(shown.slice(0, -1).trimEnd()));
}

// The picker showing `question`, if it is on screen with the question's options.
export function questionMenu(screen, question) {
  const lines = screen.split('\n'), start = squash(question.question).slice(0, 30);
  const at = lastLine(lines, line => squash(line).includes(start));
  if (at < 0 || !lines.slice(at).some(line => /Enter to select/.test(line))) return null;
  const menu = rows(lines, at);
  const numbered = menu.filter(row => row.number);
  if (numbered.length < question.options.length + 1 || question.options.some((option, index) => !sameLabel(numbered[index].label, option.label))) return null;
  return menu;
}

export function reviewMenu(screen) {
  const lines = screen.split('\n'), at = lastLine(lines, line => /Ready to submit your answers\?/.test(line));
  return at < 0 ? null : rows(lines, at);
}

export function planMenu(screen) {
  const lines = screen.split('\n'), at = lastLine(lines, line => /Would you like to proceed\?/.test(line));
  const menu = at < 0 ? [] : rows(lines, at).filter(row => row.number);
  return menu.length ? menu : null;
}

// Plan choices for the phone. The one that asks for changes takes text.
export function planChoices(screen) {
  return (planMenu(screen) || []).map(row => ({ number: row.number, label: row.label, feedback: /tell claude|what to change|feedback/i.test(row.label) }));
}

// ---- Answering ----

function typed(value) {
  return String(value || '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 2000);
}

// io: { screen(): Promise<string>, press(data) }. Every step reads the screen
// again, so a menu that changed, moved or closed stops the answer.
export class PromptDriver {
  constructor(io, { timeout = 4000 } = {}) { this.io = io; this.timeout = timeout; }
  async until(check, what) {
    const end = Date.now() + this.timeout;
    for (;;) {
      const screen = await this.io.screen(), value = check(screen);
      if (value) return value;
      if (Date.now() > end) fail(`The terminal stopped showing ${what}. Open the terminal to finish there.`);
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  }
  // Press, then wait for the screen to change and settle.
  async press(data) {
    const before = await this.io.screen();
    this.io.press(data);
    const end = Date.now() + 1500;
    let last = before, stableSince = 0;
    while (Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 40));
      const now = await this.io.screen();
      if (now !== last) { last = now; stableSince = Date.now(); }
      else if (now !== before && Date.now() - stableSince > 120) return;
    }
  }
  async moveTo(read, find, what) {
    for (let step = 0; step < 16; step++) {
      const menu = await this.until(read, what), cursor = menu.findIndex(row => row.cursor), target = menu.findIndex(find);
      if (target < 0) fail(`The terminal does not show ${what}. Open the terminal to answer there.`);
      if (cursor === target) return menu[target];
      if (cursor < 0) fail('The terminal\'s menu has no selection. Open the terminal to answer there.');
      await this.press(target > cursor ? DOWN : UP);
    }
    fail(`Could not reach ${what} in the terminal. Open the terminal to answer there.`);
  }
  async type(read, number, value, what) {
    await this.moveTo(read, row => row.number === number, what);
    this.io.press(value);
    await this.until(screen => { const row = read(screen)?.find(item => item.number === number); return row && squash(row.label).startsWith(squash(value).slice(0, 20)); }, 'your typed answer');
  }

  async answerQuestions(prompt, answers) {
    if (!Array.isArray(answers) || answers.length !== prompt.questions.length) fail('Answer every question.');
    const chosen = prompt.questions.map((question, index) => {
      const answer = answers[index] || {}, other = typed(answer.other);
      const options = (Array.isArray(answer.options) ? answer.options : []).filter(label => question.options.some(option => option.label === label));
      if (!question.multiSelect && options.length + (other ? 1 : 0) !== 1) fail(`Choose one answer for “${question.header || question.question}”.`);
      if (question.multiSelect && !options.length && !other) fail(`Choose at least one answer for “${question.header || question.question}”.`);
      return { options, other };
    });
    // Nothing is pressed unless the first question is the one on screen.
    await this.until(screen => questionMenu(screen, prompt.questions[0]), 'this question');
    for (const [index, question] of prompt.questions.entries()) {
      const read = screen => questionMenu(screen, question), what = `“${question.header || question.question}”`;
      const { options, other } = chosen[index], otherRow = question.options.length + 1;
      if (!question.multiSelect) {
        if (other) await this.type(read, otherRow, other, `the place to type an answer for ${what}`);
        else await this.moveTo(read, row => row.number === question.options.findIndex(option => option.label === options[0]) + 1, `${options[0]} for ${what}`);
        await this.press(ENTER);
      } else {
        for (const [optionIndex, option] of question.options.entries()) {
          const want = options.includes(option.label), number = optionIndex + 1;
          if ((await this.until(read, what)).find(item => item.number === number).checked === want) continue;
          await this.moveTo(read, item => item.number === number, `${option.label} for ${what}`);
          await this.press(SPACE);
          await this.until(screen => read(screen)?.find(item => item.number === number)?.checked === want, `${option.label} ${want ? 'ticked' : 'cleared'}`);
        }
        if (other) await this.type(read, otherRow, other, `the place to type an answer for ${what}`);
        await this.moveTo(read, row => row.submit, `Submit for ${what}`);
        await this.press(ENTER);
      }
      const next = prompt.questions[index + 1];
      if (next) await this.until(screen => questionMenu(screen, next), `the next question, ${next.header || next.question}`);
    }
    // With several questions, the picker ends on a review of the answers.
    const done = await this.until(screen => reviewMenu(screen) ? 'review' : !/Enter to select/.test(screen) ? 'closed' : null, 'the end of the questions');
    if (done === 'review') {
      await this.moveTo(reviewMenu, row => /^Submit answers/.test(row.label), 'Submit answers');
      await this.press(ENTER);
      await this.until(screen => !reviewMenu(screen) && !/Enter to select/.test(screen), 'the questions closing');
    }
    return { answered: true };
  }

  async answerPlan(choice) {
    const number = Number(choice?.number), feedback = typed(choice?.text);
    const row = await this.until(screen => planMenu(screen)?.find(item => item.number === number), 'the plan approval');
    if (!sameLabel(row.label, String(choice?.label || ''))) fail('The plan\'s choices changed. Check them again.');
    if (feedback) await this.type(planMenu, number, feedback, `“${row.label}”`);
    else await this.moveTo(planMenu, item => item.number === number, `“${row.label}”`);
    await this.press(ENTER);
    await this.until(screen => !planMenu(screen), 'the plan approval closing');
    return { answered: true };
  }
}
