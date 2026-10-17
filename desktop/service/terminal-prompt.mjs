import { createHash } from 'node:crypto';

// Claude Code and Codex ask for permission with a numbered menu at the bottom of
// the terminal, one option marked as selected. Box borders and the Codex gutter
// are drawing characters, not text.
const OPTION = /^(?:([❯›>▸▶➤])\s*)?(\d{1,2})[.)]\s+(\S.*)$/;
const BORDER = /^[─━═╭╮╰╯┌┐└┘\s-]*$/;
const clean = line => line.replace(/^[\s│┃║▌▐|]+/, '').replace(/[\s│┃║▐|]+$/, '');

export function terminalPrompt(screen) {
  const lines = String(screen || '').split('\n').map(clean);
  let end = lines.length - 1;
  while (end >= 0 && (!lines[end] || BORDER.test(lines[end]))) end--;
  if (end < 0) return null;
  let block = null, best = null, gap = 0;
  for (let index = Math.max(0, end - 40); index <= end; index++) {
    const match = OPTION.exec(lines[index]);
    if (match && Number(match[2]) === 1) { block = { start: index, last: index, options: [] }; gap = 0; }
    else if (!match || !block || Number(match[2]) !== block.options.length + 1) {
      // Long options wrap onto a few continuation lines.
      if (block && ++gap > 3) block = null;
      continue;
    }
    gap = 0; block.last = index;
    block.options.push({ label: match[3].trim(), selected: !!match[1] });
    if (block.options.length >= 2) best = { ...block, options: [...block.options] };
  }
  if (!best || end - best.last > 8 || best.options.filter(item => item.selected).length !== 1) return null;
  let question = -1;
  for (let index = best.start - 1; index >= Math.max(0, best.start - 15); index--) if (lines[index].endsWith('?')) { question = index; break; }
  // What is being approved: the lines above the question, up to the box's top edge.
  const detail = [];
  for (let index = (question < 0 ? best.start : question) - 1; index >= 0 && detail.length < 6; index--) {
    if (lines[index] && BORDER.test(lines[index])) break;
    if (lines[index]) detail.unshift(lines[index]);
  }
  // Codex shows the command between its question and the options.
  if (question >= 0) detail.push(...lines.slice(question + 1, best.start).filter(line => line && !BORDER.test(line)).slice(0, 6));
  const prompt = { question: question < 0 ? 'The agent is asking you to choose.' : lines[question], detail, options: best.options.map(item => item.label), selected: best.options.findIndex(item => item.selected) };
  return { id: createHash('sha256').update(JSON.stringify([prompt.question, prompt.options])).digest('hex').slice(0, 24), ...prompt };
}

const keyDelay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Answer only the prompt the user saw: re-read the screen first, so a stale
// click cannot select an option in a newer, different prompt.
export async function answerPrompt(sessions, id, promptId, choice) {
  const prompt = terminalPrompt((await sessions.read(id, 60)).screen);
  if (!prompt || prompt.id !== promptId) throw Object.assign(new Error('This prompt changed or was already answered. Check the terminal.'), { status: 409 });
  if (choice === 'cancel') { sessions.input(id, '\x1b'); return { delivered: true, choice }; }
  if (!Number.isInteger(choice) || choice < 0 || choice >= prompt.options.length) throw new Error('Choose one of the listed options.');
  await chooseOption(data => sessions.input(id, data), prompt, choice);
  return { delivered: true, choice, option: prompt.options[choice] };
}

// Arrow keys, then Enter, one key per write: menus parse a combined burst as one sequence.
export async function chooseOption(press, prompt, choice) {
  const key = choice > prompt.selected ? '\x1b[B' : '\x1b[A';
  for (let step = 0; step < Math.abs(choice - prompt.selected); step++) { press(key); await keyDelay(60); }
  await keyDelay(60);
  press('\r');
}
