import { createHash, randomUUID } from 'node:crypto';

// Claude Code and Codex ask for permission with a numbered menu at the bottom of
// the terminal, one option marked as selected. Box borders and the Codex gutter
// are drawing characters, not text.
// A long list scrolls and marks its first or last visible option with an arrow.
const OPTION = /^(?:([❯›>▸▶➤])\s*|[↑↓]\s*)?(\d{1,2})[.)]\s+(\S.*)$/;
const BORDER = /^[─━═╭╮╰╯┌┐└┘▔\s-]*$/;
// Claude Code tops a full-width dialog with ▔, sometimes with a label inside it.
const edge = line => BORDER.test(line) || /▔{8}/.test(line);
// Claude Code's multiple-choice questions: boxed options, then an unnumbered button.
const CHECKBOX = /^\[([ ✔✓√×xX])\]\s+(\S.*)$/;
const SUBMIT = /^(?:([❯›>▸▶➤])\s*)?(Next|Submit|Review)$/;
// The CLI hides its composer while a menu is open. A numbered message the person
// sent echoes with the same marker, but above a visible composer.
const COMPOSER = /^[❯›](?:\s|$)/;
// Claude Code's own-answer option: focused, it becomes a text field.
const FREE_TEXT = /^Type something\.?$/;
const EDITOR_HINT = /\s*·\s*ctrl\+g to edit in [^·]*?(?=\s*·|$)/i;
const clean = line => line.replace(/^[\s│┃║▌▐|]+/, '').replace(/[\s│┃║▐|]+$/, '');

const prove = proof => createHash('sha256').update(JSON.stringify(proof)).digest('hex');

// The key hint under a picker; Antigravity keeps its status line below it.
function hintAt(lines, end, pattern) {
  for (let index = end, seen = 0; index >= 0 && seen < 3; index--) if (lines[index]) { if (pattern.test(lines[index])) return index; seen++; }
  return -1;
}

// An /effort slider: a ruler whose marker (Claude Code's ▲, Antigravity's ◉)
// points at one of the level names below it, then a ←/→ hint. Columns matter,
// so it reads the raw lines.
function scalePrompt(raw, lines, end) {
  const hint = hintAt(lines, end, /←\/→/);
  if (hint < 0) return null;
  for (let index = hint - 1; index >= Math.max(1, hint - 10); index--) {
    const ruler = /[─━●]*[▲◉][─━●]*/.exec(raw[index - 1]);
    if (!ruler || ruler[0].length < 10) continue;
    const marker = ruler.index + ruler[0].search(/[▲◉]/), stop = ruler.index + ruler[0].length;
    const levels = [...raw[index].matchAll(/\S+/g)].filter(item => item.index >= ruler.index - 2 && item.index < stop);
    if (levels.length < 2) return null;
    const distance = item => Math.abs(item.index + item[0].length / 2 - marker);
    const selected = levels.reduce((best, item, at) => distance(item) < distance(levels[best]) ? at : best, 0);
    const above = [];
    for (let line = index - 2; line >= Math.max(0, index - 8); line--) {
      if (lines[line] && edge(lines[line])) break;
      if (lines[line]) above.unshift(lines[line]);
    }
    if (!above.length) return null;
    // The cost note under the slider follows the selection, so only the levels bind.
    return { id: prove([...above, levels.map(item => item[0])]), kind: 'scale', question: above[0], detail: above.slice(1), options: levels.map(item => item[0]), selected };
  }
  return null;
}

// Antigravity's /model: unnumbered options under a title, the current one marked
// with ">", then a ↑/↓ hint.
const ITEM = /^(?:(>)|\s)\s(\S.*)$/;
function listPrompt(raw, lines, end) {
  const hint = hintAt(lines, end, /↑\/↓/);
  if (hint < 0) return null;
  let last = hint - 1;
  for (; last >= Math.max(0, hint - 20); last--) {
    if (!ITEM.exec(raw[last]) || !ITEM.exec(raw[last - 1] || '')) continue;
    let start = last;
    while (start > 0 && ITEM.exec(raw[start - 1])) start--;
    const items = raw.slice(start, last + 1).map(line => ITEM.exec(line));
    // Numbered menus are read below, with their own checks.
    if (items.filter(item => item[1]).length !== 1 || items.some(item => OPTION.test(item[2]))) { last = start; continue; }
    let title = start - 1;
    while (title >= Math.max(0, start - 8) && !/^\S/.test(raw[title])) title--;
    const question = title >= 0 && /^\S/.test(raw[title]) && !edge(lines[title]) ? lines[title] : 'The agent is asking you to choose.';
    const options = items.map(item => item[2].trim());
    return { id: prove([question, options]), kind: 'single', question, detail: [], options, selected: items.findIndex(item => item[1]) };
  }
  return null;
}

// Text still waiting in Claude Code's composer, the `❯` line under a rule; null
// when the composer is hidden. Sent messages echo with the same marker in the
// scrollback, but not right under a rule.
export function composerText(screen) {
  const lines = String(screen || '').split('\n').map(clean);
  for (let index = lines.length - 1; index > 0; index--) {
    if (!COMPOSER.test(lines[index]) || !edge(lines[index - 1]) || !lines[index - 1].trim()) continue;
    return OPTION.test(lines[index]) ? null : lines[index].replace(COMPOSER, '').trim();
  }
  return null;
}

export function terminalPrompt(screen) {
  const raw = String(screen || '').split('\n');
  const lines = raw.map(clean);
  let end = lines.length - 1;
  while (end >= 0 && (!lines[end] || BORDER.test(lines[end]))) end--;
  if (end < 0) return null;
  // A model list can hold its own effort slider, so the list wins.
  const picker = listPrompt(raw, lines, end) || scalePrompt(raw, lines, end);
  if (picker) return picker;
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
    if (lines[index] && edge(lines[index])) break;
    // Without a box or question (Codex's /model), only the title paragraph belongs.
    if (!lines[index] && question < 0 && detail.length) break;
    if (lines[index]) detail.unshift(lines[index]);
  }
  // Codex shows the command between its question and the options.
  if (question >= 0) detail.push(...lines.slice(question + 1, best.start).filter(line => line && !BORDER.test(line)));
  const base = { question: question < 0 ? 'The agent is asking you to choose.' : lines[question], detail };
  const focus = best.options.findIndex(item => item.selected);
  // A multiple choice keeps one focus order for the arrow keys: the boxes, the
  // button, then any numbered option drawn below it.
  const prompt = multiple
    ? { ...base, kind: 'multiple', options: boxes.map(box => box[2]), checked: boxes.map(box => box[1] !== ' '), input: boxes.findIndex(box => FREE_TEXT.test(box[2])), submit: best.submit.label, selected: best.submit.selected ? boxes.length : focus < boxes.length ? focus : focus + 1 }
    : { ...base, kind: 'single', options: best.options.map(item => item.label), selected: focus, input: best.options.findIndex(item => FREE_TEXT.test(item.label)) };
  // Bind every visible detail and wrapped option, allowing only selection and
  // checkbox changes, including the answered marks of a question's tabs. The key
  // hint gains "ctrl+g to edit in <editor>" while the free-text option has focus.
  const proof = lines.slice(0, end + 1).map(line => {
    const option = OPTION.exec(line), submit = SUBMIT.exec(line);
    if (option) return `${option[2]}. ${option[3].replace(CHECKBOX, '[ ] $2')}`;
    return submit ? submit[2] : line.replace(/[☐☑☒]/g, '☐').replace(EDITOR_HINT, '');
  });
  return { id: prove(proof), ...prompt };
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
    // A slider moves with ←/→, a menu with ↑/↓.
    const [next, back] = prompt.kind === 'scale' ? ['\x1b[C', '\x1b[D'] : ['\x1b[B', '\x1b[A'];
    const move = async target => {
      for (let moves = 0; prompt.selected !== target; moves++) {
        if (moves > prompt.options.length + 1) throw conflict();
        await press(target > prompt.selected ? next : back, (before, after) => after.selected !== before.selected);
      }
    };
    // Your own answer: focus the free-text option, type, and press Enter only
    // once the menu shows the typed text in that option's place.
    if (choice && typeof choice === 'object' && 'text' in choice) {
      // eslint-disable-next-line no-control-regex
      const text = typeof choice.text === 'string' ? choice.text.replace(/[\x00-\x1f\x7f]+/g, ' ').trim() : '';
      if (prompt.kind !== 'single' || prompt.input < 0) throw new Error('This menu has no option for your own answer.');
      if (!text || text.length > 2000) throw new Error('Write an answer of at most 2000 characters.');
      const row = prompt.input;
      await move(row);
      await keyDelay(60); prompt = await current();
      if (prompt.selected !== row) throw conflict();
      state.prompts.get(id).used = true;
      sessions.keys(id, text);
      const flat = value => value.replace(/\s+/g, ' ').trim();
      const shows = screen => {
        const label = flat(screen?.selected === row ? screen.options[row] || '' : '').replace(/…$/, '');
        return !!label && !FREE_TEXT.test(label) && flat(text).startsWith(label);
      };
      const deadline = Date.now() + 1500;
      let typed = false;
      do { await keyDelay(80); typed = shows(terminalPrompt((await sessions.read(id, 60)).screen)); } while (!typed && Date.now() < deadline);
      if (!typed) throw Object.assign(new Error('Your answer did not show up in the menu, so Enter was not pressed. Check the terminal.'), { status: 409 });
      sessions.keys(id, '\r');
      return { delivered: true, choice: row, option: text };
    }
    const multiple = prompt.kind === 'multiple';
    const wanted = multiple && Array.isArray(choice?.checked) ? choice.checked : null;
    const target = multiple ? prompt.options.length : choice;
    if (multiple ? !wanted || new Set(wanted).size !== wanted.length || wanted.some(index => !Number.isInteger(index) || index < 0 || index >= prompt.options.length || index === prompt.input)
      : !Number.isInteger(choice) || choice < 0 || choice >= prompt.options.length) throw new Error('Choose one of the listed options.');
    if (!multiple && choice === prompt.input) throw new Error('Write your own answer for this option.');
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
