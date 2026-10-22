import { createHash, randomUUID } from 'node:crypto';

// Claude Code and Codex ask for permission with a numbered menu at the bottom of
// the terminal, one option marked as selected. Box borders and the Codex gutter
// are drawing characters, not text.
const OPTION = /^(?:([❯›>▸▶➤])\s*)?(\d{1,2})[.)]\s+(\S.*)$/;
const BORDER = /^[─━═╭╮╰╯┌┐└┘\s-]*$/;
// Claude Code's multiple-choice questions: boxed options, then an unnumbered button.
const CHECKBOX = /^\[([ ✔✓√×xX])\]\s+(\S.*)$/;
const SUBMIT = /^(?:([❯›>▸▶➤])\s*)?(Next|Submit|Review)$/;
// The CLI hides its composer while a menu is open. A numbered message the person
// sent echoes with the same marker, but above a visible composer.
const COMPOSER = /^[❯›](?:\s|$)/;
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
      const submit = block && !block.submit && SUBMIT.exec(lines[index]);
      if (submit) block.submit = { label: submit[2], selected: !!submit[1], after: block.options.length };
      // Long options wrap onto a few continuation lines.
      if (block && ++gap > 3) block = null;
      continue;
    }
    gap = 0; block.last = index;
    block.options.push({ label: match[3].trim(), selected: !!match[1] });
    if (block.options.length >= 2) best = block;
  }
  if (!best || end - best.last > 8) return null;
  if (lines.slice(best.last + 1, end + 1).some(line => COMPOSER.test(line) && !OPTION.test(line) && !SUBMIT.test(line))) return null;
  const boxes = best.options.slice(0, best.submit?.after).map(item => CHECKBOX.exec(item.label));
  const multiple = !!best.submit && boxes.length >= 2 && boxes.every(Boolean);
  if (best.options.filter(item => item.selected).length + (multiple && best.submit.selected ? 1 : 0) !== 1) return null;
  let question = -1;
  for (let index = best.start - 1; index >= Math.max(0, best.start - 15); index--) if (lines[index].endsWith('?')) { question = index; break; }
  // What is being approved: the lines above the question, up to the box's top edge.
  const detail = [];
  for (let index = (question < 0 ? best.start : question) - 1; index >= 0; index--) {
    if (lines[index] && BORDER.test(lines[index])) break;
    if (lines[index]) detail.unshift(lines[index]);
  }
  // Codex shows the command between its question and the options.
  if (question >= 0) detail.push(...lines.slice(question + 1, best.start).filter(line => line && !BORDER.test(line)));
  const base = { question: question < 0 ? 'The agent is asking you to choose.' : lines[question], detail };
  const focus = best.options.findIndex(item => item.selected);
  // A multiple choice keeps one focus order for the arrow keys: the boxes, the
  // button, then any numbered option drawn below it.
  const prompt = multiple
    ? { ...base, kind: 'multiple', options: boxes.map(box => box[2]), checked: boxes.map(box => box[1] !== ' '), input: boxes.findIndex(box => /^Type something\.?$/.test(box[2])), submit: best.submit.label, selected: best.submit.selected ? boxes.length : focus < boxes.length ? focus : focus + 1 }
    : { ...base, kind: 'single', options: best.options.map(item => item.label), selected: focus };
  // Bind every visible detail and wrapped option, allowing only selection and
  // checkbox changes, including the answered marks of a question's tabs.
  const proof = lines.slice(0, end + 1).map(line => {
    const option = OPTION.exec(line), submit = SUBMIT.exec(line);
    if (option) return `${option[2]}. ${option[3].replace(CHECKBOX, '[ ] $2')}`;
    return submit ? submit[2] : line.replace(/[☐☑☒]/g, '☐');
  });
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
    // Send one key, then wait for the redrawn menu to show its effect.
    const press = async (key, changed) => {
      const previous = prompt;
      sessions.keys(id, key);
      const deadline = Date.now() + 1000;
      do { await keyDelay(60); prompt = await current(); } while (!changed(previous, prompt) && Date.now() < deadline);
      if (!changed(previous, prompt)) throw conflict();
    };
    const move = async target => {
      for (let moves = 0; prompt.selected !== target; moves++) {
        if (moves > prompt.options.length + 1) throw conflict();
        await press(target > prompt.selected ? '\x1b[B' : '\x1b[A', (before, after) => after.selected !== before.selected);
      }
    };
    const multiple = prompt.kind === 'multiple';
    const wanted = multiple && Array.isArray(choice?.checked) ? choice.checked : null;
    const target = multiple ? prompt.options.length : choice;
    if (multiple ? !wanted || new Set(wanted).size !== wanted.length || wanted.some(index => !Number.isInteger(index) || index < 0 || index >= prompt.options.length || index === prompt.input)
      : !Number.isInteger(choice) || choice < 0 || choice >= prompt.options.length) throw new Error('Choose one of the listed options.');
    // Space toggles a box without ever submitting; the button submits with Enter.
    if (multiple) for (let index = 0; index < prompt.options.length; index++) {
      if (prompt.checked[index] === wanted.includes(index)) continue;
      await move(index);
      await press(' ', (before, after) => after.checked[index] !== before.checked[index]);
    }
    await move(target);
    // Recheck after the menu redraws, immediately before Enter.
    await keyDelay(60); prompt = await current();
    if (prompt.selected !== target || (multiple && prompt.checked.some((on, index) => on !== wanted.includes(index)))) throw conflict();
    state.prompts.get(id).used = true;
    sessions.keys(id, '\r');
    return multiple ? { delivered: true, choice: wanted, submit: prompt.submit } : { delivered: true, choice, option: prompt.options[choice] };
  } finally { state.answering.delete(id); }
}

// Arrow keys, then Enter, one key per write: menus parse a combined burst as one sequence.
export async function chooseOption(press, prompt, choice) {
  const key = choice > prompt.selected ? '\x1b[B' : '\x1b[A';
  for (let step = 0; step < Math.abs(choice - prompt.selected); step++) { press(key); await keyDelay(60); }
  await keyDelay(60);
  press('\r');
}
