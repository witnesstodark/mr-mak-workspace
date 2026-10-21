import { createHash, randomUUID } from 'node:crypto';

// Claude Code and Codex ask for permission with a numbered menu at the bottom of
// the terminal, one option marked as selected. Box borders and the Codex gutter
// are drawing characters, not text.
const OPTION = /^(?:([❯›>▸▶➤])\s*)?(\d{1,2})[.)]\s+(\S.*)$/;
const BORDER = /^[─━═╭╮╰╯┌┐└┘\s-]*$/;
const clean = line => line.replace(/^[\s│┃║▌▐|]+/, '').replace(/[\s│┃║▐|]+$/, '');
const indent = line => /^[\s│┃║▌▐|]*/.exec(line)[0].length;

export function terminalPrompt(screen) {
  const raw = String(screen || '').split('\n');
  const lines = raw.map(clean);
  let end = lines.length - 1;
  while (end >= 0 && (!lines[end] || BORDER.test(lines[end]))) end--;
  if (end < 0) return null;
  let block = null, best = null, gap = 0;
  for (let index = Math.max(0, end - 55); index <= end; index++) {
    const match = OPTION.exec(lines[index]);
    if (match && Number(match[2]) === 1) { block = { start: index, last: index, options: [] }; gap = 0; }
    else if (!match || !block || Number(match[2]) !== block.options.length + 1) {
      if (!block) continue;
      // Text indented to the label of the option above continues it: a wrapped label or, in
      // AskUserQuestion, the description printed under each option.
      const option = block.options.at(-1);
      if (!match && option && lines[index] && !BORDER.test(lines[index]) && indent(raw[index]) >= option.column) option.notes.push(lines[index]);
      else if (++gap > 3) block = null;
      continue;
    }
    gap = 0; block.last = index;
    block.options.push({ label: match[3].trim(), selected: !!match[1], column: indent(raw[index]) + lines[index].length - match[3].length, notes: [] });
    if (block.options.length >= 2) best = { ...block, options: [...block.options] };
  }
  if (!best || end - best.last > 8 || best.options.filter(item => item.selected).length !== 1) return null;
  let question = -1;
  for (let index = best.start - 1; index >= Math.max(0, best.start - 15); index--) if (lines[index].endsWith('?')) { question = index; break; }
  // A long question wraps: its paragraph runs up to the nearest blank line or border.
  let first = question;
  while (first > 0 && question - first < 5 && lines[first - 1] && !BORDER.test(lines[first - 1])) first--;
  // What is being approved: the lines above the question, up to the box's top edge.
  const detail = [];
  for (let index = (question < 0 ? best.start : first) - 1; index >= 0; index--) {
    if (lines[index] && BORDER.test(lines[index])) break;
    if (lines[index]) detail.unshift(lines[index]);
  }
  // Codex shows the command between its question and the options.
  if (question >= 0) detail.push(...lines.slice(question + 1, best.start).filter(line => line && !BORDER.test(line)));
  const prompt = { question: question < 0 ? 'The agent is asking you to choose.' : lines.slice(first, question + 1).join(' '), detail, options: best.options.map(item => item.label), notes: best.options.map(item => item.notes.join(' ')), selected: best.options.findIndex(item => item.selected) };
  // Bind every visible detail and wrapped option, allowing only selection changes.
  const proof = lines.slice(0, end + 1).map(line => { const option = OPTION.exec(line); return option ? `${option[2]}. ${option[3]}` : line; });
  return { id: createHash('sha256').update(JSON.stringify(proof)).digest('hex'), ...prompt };
}

const keyDelay = ms => new Promise(resolve => setTimeout(resolve, ms));
const states = new WeakMap();
const conflict = () => Object.assign(new Error('This prompt changed or was already answered. Check the terminal.'), { status: 409 });
function stateFor(sessions) {
  if (!states.has(sessions)) states.set(sessions, { prompts: new Map(), answering: new Set() });
  return states.get(sessions);
}

// One-use tickets belong to this process and visible prompt, not merely to a
// repeatable command hash. Polling a consumed prompt cannot make it usable again.
export async function readPrompt(sessions, id) {
  const { prompts } = stateFor(sessions);
  const prompt = terminalPrompt((await sessions.read(id, 60)).screen);
  if (!prompt) { prompts.delete(id); return null; }
  const process = sessions.get?.(id)?.process;
  let entry = prompts.get(id);
  if (!entry || entry.signature !== prompt.id || entry.process !== process) {
    entry = { signature: prompt.id, process, ticket: randomUUID(), used: false };
    prompts.set(id, entry);
  }
  return entry.used ? null : { ...prompt, id: entry.ticket };
}

// Answer only the prompt the user saw: re-read the screen first, so a stale
// click cannot select an option in a newer, different prompt.
export async function answerPrompt(sessions, id, promptId, choice) {
  const state = stateFor(sessions);
  if (state.answering.has(id)) throw conflict();
  state.answering.add(id);
  try {
    const current = async () => {
      const prompt = await readPrompt(sessions, id);
      if (!prompt || prompt.id !== promptId) throw conflict();
      return prompt;
    };
    let prompt = await current();
    if (choice === 'cancel') {
      state.prompts.get(id).used = true; sessions.keys(id, '\x1b');
      return { delivered: true, choice };
    }
    if (!Number.isInteger(choice) || choice < 0 || choice >= prompt.options.length) throw new Error('Choose one of the listed options.');
    for (let moves = 0; prompt.selected !== choice; moves++) {
      if (moves >= prompt.options.length) throw conflict();
      const previous = prompt.selected;
      sessions.keys(id, choice > previous ? '\x1b[B' : '\x1b[A');
      const deadline = Date.now() + 1000;
      do { await keyDelay(60); prompt = await current(); } while (prompt.selected === previous && Date.now() < deadline);
      if (prompt.selected === previous) throw conflict();
    }
    // Recheck after the menu redraws, immediately before Enter.
    await keyDelay(60); prompt = await current();
    if (prompt.selected !== choice) throw conflict();
    state.prompts.get(id).used = true;
    sessions.keys(id, '\r');
    return { delivered: true, choice, option: prompt.options[choice] };
  } finally { state.answering.delete(id); }
}

// Arrow keys, then Enter, one key per write: menus parse a combined burst as one sequence.
export async function chooseOption(press, prompt, choice) {
  const key = choice > prompt.selected ? '\x1b[B' : '\x1b[A';
  for (let step = 0; step < Math.abs(choice - prompt.selected); step++) { press(key); await keyDelay(60); }
  await keyDelay(60);
  press('\r');
}
