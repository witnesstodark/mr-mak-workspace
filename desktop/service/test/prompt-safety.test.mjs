import test from 'node:test';
import assert from 'node:assert/strict';
import { answerPrompt, readPrompt, terminalPrompt } from '../terminal-prompt.mjs';

function fixture() {
  const state = { command: 'echo first', selected: 0, visible: true, process: {}, writes: [], afterKey: null };
  const screen = () => state.visible ? ['Allow command?', `$ ${state.command}`, '', ...['Yes, proceed', 'Yes, always', 'No'].map((label, i) => `${i === state.selected ? '>' : ' '} ${i + 1}. ${label}`), 'Press enter to confirm'].join('\n') : 'Working...';
  const sessions = { get: () => ({ process: state.process }), read: async () => ({ screen: screen() }), keys: (_, data) => {
    state.writes.push(data);
    if (data === '\x1b[B') state.selected++;
    if (data === '\x1b[A') state.selected--;
    state.afterKey?.(data);
  } };
  return { state, sessions, screen };
}

test('a numbered message the person sent is not a menu while the composer is visible', () => {
  const claude = ['Preciso de duas decisões suas:', '1. Nascimento das unidades iniciais.', '2. Ritmo da partida. Esse ritmo mais lento é aceitável?', '',
    '❯ 1. vamos corrigir o nascimento das unidades iniciais      ', '  2. esse ritmo é aceitável      ', ' ', '✻Quantumizing… (3s)', '',
    '──────────', '❯ ', '──────────', '⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt'];
  assert.equal(terminalPrompt(claude.join('\n')), null);
  const codex = ['› 1. fix the spawn', '  2. keep the pace', '', '• Working (2s • esc to interrupt)', '', '› Ask Codex to do anything', '', '  100% context left'];
  assert.equal(terminalPrompt(codex.join('\n')), null);
  // The same lines with the composer replaced by a menu footer are a menu.
  assert.equal(terminalPrompt([...claude.slice(0, 6), '', 'Enter to select · Esc to cancel'].join('\n')).kind, 'single');
});

test('changing a command invalidates the displayed approval, including long wrapped details', async () => {
  const { state, sessions, screen } = fixture();
  state.command = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\necho first';
  const fingerprint = terminalPrompt(screen()).id;
  const prompt = await readPrompt(sessions, 'chat');
  state.command = state.command.replace('echo first', 'echo second');
  assert.notEqual(terminalPrompt(screen()).id, fingerprint);
  await assert.rejects(answerPrompt(sessions, 'chat', prompt.id, 0), error => error.status === 409);
  assert.deepEqual(state.writes, []);
});

test('approval revalidates the command after moving the menu selection', async () => {
  const { state, sessions } = fixture();
  const prompt = await readPrompt(sessions, 'chat');
  state.afterKey = () => { state.command = 'echo replacement'; };
  await assert.rejects(answerPrompt(sessions, 'chat', prompt.id, 1), error => error.status === 409);
  assert.deepEqual(state.writes, ['\x1b[B']);
});

test('a simultaneous or repeated approval cannot submit twice', async () => {
  const { state, sessions } = fixture();
  const prompt = await readPrompt(sessions, 'chat');
  const first = answerPrompt(sessions, 'chat', prompt.id, 0);
  await assert.rejects(answerPrompt(sessions, 'chat', prompt.id, 0), error => error.status === 409);
  await first;
  await assert.rejects(answerPrompt(sessions, 'chat', prompt.id, 0), error => error.status === 409);
  assert.equal(await readPrompt(sessions, 'chat'), null);
  assert.deepEqual(state.writes, ['\r']);
});

test('a returned identical prompt or restarted process needs a new approval', async () => {
  const { state, sessions } = fixture();
  const first = await readPrompt(sessions, 'chat');
  state.visible = false; assert.equal(await readPrompt(sessions, 'chat'), null);
  state.visible = true; const second = await readPrompt(sessions, 'chat');
  assert.notEqual(second.id, first.id);
  await assert.rejects(answerPrompt(sessions, 'chat', first.id, 0), error => error.status === 409);
  state.process = {};
  await assert.rejects(answerPrompt(sessions, 'chat', second.id, 0), error => error.status === 409);
  assert.deepEqual(state.writes, []);
});

// Claude Code's multiple choice, as drawn in a 214-column chat: boxed options,
// an unnumbered Next button, then Chat about this below a rule.
function multipleFixture() {
  const labels = ['Apple', 'Banana', 'Grape', 'Type something'];
  const state = { focus: 0, checked: [false, false, false, false], writes: [], process: {} };
  const screen = () => [
    '──────────', `←  ${state.checked.some(Boolean) ? '☒' : '☐'} Fruit  ☐ Colour  ✔ Submit  →`, '', '│ Which fruits do you want?', '',
    ...labels.flatMap((label, i) => [`${state.focus === i ? '❯' : ' '} ${i + 1}. [${state.checked[i] ? '✔' : ' '}] ${label}`, ...(i < 3 ? [`       Option ${i + 1}.`] : [])]),
    `${state.focus === 4 ? '❯' : ' '}    Next`, '──────────', `  ${state.focus === 5 ? '❯' : ' '} 5. Chat about this`, '', 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
  ].join('\n');
  const sessions = { get: () => ({ process: state.process }), read: async () => ({ screen: screen() }), keys: (_, data) => {
    state.writes.push(data);
    if (data === '\x1b[B') state.focus = Math.min(5, state.focus + 1);
    if (data === '\x1b[A') state.focus = Math.max(0, state.focus - 1);
    if (data === ' ' && state.focus < 4) state.checked[state.focus] = !state.checked[state.focus];
  } };
  return { state, sessions, screen };
}

test('a multiple choice lists its boxes and button, including while the button has focus', () => {
  const { state, screen } = multipleFixture();
  state.checked[1] = true;
  const prompt = terminalPrompt(screen());
  assert.equal(prompt.kind, 'multiple');
  assert.equal(prompt.question, 'Which fruits do you want?');
  assert.deepEqual(prompt.options, ['Apple', 'Banana', 'Grape', 'Type something']);
  assert.deepEqual(prompt.checked, [false, true, false, false]);
  assert.deepEqual([prompt.input, prompt.submit, prompt.selected], [3, 'Next', 0]);
  state.focus = 4; assert.equal(terminalPrompt(screen()).selected, 4);
  state.focus = 5; assert.equal(terminalPrompt(screen()).selected, 5);
  // Checking boxes keeps the approval; a changed option invalidates it.
  state.checked[0] = true; assert.equal(terminalPrompt(screen()).id, prompt.id);
  assert.notEqual(terminalPrompt(screen().replace('Grape', 'Melon')).id, prompt.id);
});

test('a multiple choice toggles only the differing boxes with Space, then submits on the button', async () => {
  const { state, sessions } = multipleFixture();
  state.checked[1] = true;
  const prompt = await readPrompt(sessions, 'chat');
  const result = await answerPrompt(sessions, 'chat', prompt.id, { checked: [0, 2] });
  assert.deepEqual(result, { delivered: true, choice: [0, 2], submit: 'Next' });
  assert.deepEqual(state.checked, [true, false, true, false]);
  assert.deepEqual(state.writes, [' ', '\x1b[B', ' ', '\x1b[B', ' ', '\x1b[B', '\x1b[B', '\r']);
  assert.equal(await readPrompt(sessions, 'chat'), null);
});

test('a multiple choice refuses the typed-answer box, unknown boxes and single answers', async () => {
  const { state, sessions } = multipleFixture();
  const prompt = await readPrompt(sessions, 'chat');
  for (const choice of [{ checked: [3] }, { checked: [9] }, { checked: [0, 0] }, 1, {}]) await assert.rejects(answerPrompt(sessions, 'chat', prompt.id, choice), /Choose one/);
  assert.deepEqual(state.writes, []);
});

// Claude Code 2.1's /effort slider, as the terminal draws it.
function sliderFixture() {
  const levels = ['low', 'medium', 'high', 'xhigh', 'max'], columns = [19, 27, 38, 47, 58];
  const state = { selected: 3, process: {}, writes: [] };
  const screen = () => {
    const ruler = Array(42).fill('─'); ruler[columns[state.selected] - 19 + 1] = '▲';
    return ['❯ /effort', '', `${'▔'.repeat(80)} ◉ xhigh · /effort ▔`, '   Effort', '', '                   Faster                             Smarter',
      `                   ${ruler.join('')}      Ultracode  off`, `                   ${levels.join('     ')}      Tab to toggle`, '',
      `                          ~${state.selected}x the estimated cost of medium`, '', '   ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel'].join('\n');
  };
  const sessions = { get: () => ({ process: state.process }), read: async () => ({ screen: screen() }), keys: (_, data) => {
    state.writes.push(data);
    if (data === '\x1b[C') state.selected++;
    if (data === '\x1b[D') state.selected--;
  } };
  return { state, sessions };
}

test('the /effort slider reads as a choice of levels and moves with the side arrows', async () => {
  const { state, sessions } = sliderFixture();
  const prompt = await readPrompt(sessions, 'chat');
  assert.deepEqual({ ...prompt, id: undefined }, { id: undefined, kind: 'scale', question: 'Effort', detail: ['Faster                             Smarter'], options: ['low', 'medium', 'high', 'xhigh', 'max'], selected: 3 });
  assert.deepEqual(await answerPrompt(sessions, 'chat', prompt.id, 1), { delivered: true, choice: 1, option: 'medium' });
  assert.deepEqual(state.writes, ['\x1b[D', '\x1b[D', '\r']);
});

test('a scrolled /model list keeps the option marked with a scroll arrow', () => {
  const prompt = terminalPrompt(['▔'.repeat(80), '   Select model', '   Switch between Claude models.', '',
    '     1.  Default (recommended)  Opus 5.5', '   ❯ 2.  Opus 5.5 ✔             For complex work', '     3.  Sonnet 5.5             Most efficient',
    '   ↓ 4.  Haiku 5.5              Fastest', '      … +7 models', '', '   ◉ xHigh effort ←/→ to adjust', '', '   Enter to set as default · Esc to cancel'].join('\n'));
  assert.equal(prompt.kind, 'single');
  assert.deepEqual(prompt.detail, ['Select model', 'Switch between Claude models.']);
  assert.equal(prompt.options.length, 4);
  assert.equal(prompt.selected, 1);
});

test('Antigravity 1.4 /model list and /effort slider read as choices, below its status line', async () => {
  const status = '                                                                             Gemini 3.8 Flash · high';
  const model = terminalPrompt(['─'.repeat(100), '>', '─'.repeat(100), 'Switch Model', '', '  Search:  ', '          ────────────────────', '',
    '  Gemini 4 Argon', '> Gemini 3.8 Flash      (current)', '  Claude Opus 5.5', '',
    '  Effort  ◂        ●━━━━━━━━━━━━━━●━━━━━━━━━━━━━━◉        ▸', '                  low          medium          high      ', '',
    'Keyboard: ↑/↓ Navigate  ←/→ Effort  enter Select  esc Go Back', '', status].join('\n'));
  assert.deepEqual({ ...model, id: undefined }, { id: undefined, kind: 'single', question: 'Switch Model', detail: [], options: ['Gemini 4 Argon', 'Gemini 3.8 Flash      (current)', 'Claude Opus 5.5'], selected: 1 });
  const state = { selected: 2 }, levels = ['low', 'medium', 'high'];
  const screen = () => {
    const ruler = ['●', '━'.repeat(14), '●', '━'.repeat(14), '●']; ruler[state.selected * 2] = '◉';
    return ['─'.repeat(100), '>', '─'.repeat(100), 'Set Effort', '', `  ◂        ${ruler.join('')}        ▸`, `          ${levels.join('          ')}      `, `    Reasoning ${state.selected}`, '', 'Keyboard: ←/→ Effort  enter Select  esc Go Back', '', status].join('\n');
  };
  const writes = [];
  const sessions = { get: () => ({ process: state }), read: async () => ({ screen: screen() }), keys: (_, key) => { writes.push(key); if (key === '\x1b[D') state.selected--; } };
  const prompt = await readPrompt(sessions, 'chat');
  assert.deepEqual([prompt.kind, prompt.question, prompt.options, prompt.selected], ['scale', 'Set Effort', levels, 2]);
  assert.deepEqual(await answerPrompt(sessions, 'chat', prompt.id, 0), { delivered: true, choice: 0, option: 'low' });
  assert.deepEqual(writes, ['\x1b[D', '\x1b[D', '\r']);
});

test("Codex's /model menu shows only its title, not the banner above it", () => {
  const prompt = terminalPrompt(['  >_ OpenAI Codex (v0.164.0)', '     E:\MrMak\Mak', '', '  Select Reasoning Level for GPT-6.1-Sol', '', '',
    '  1. Low (default)    Fast responses', '› 2. High (current)   Greater reasoning depth', '', '  enter default · s session · esc back'].join('\n'));
  assert.deepEqual([prompt.detail, prompt.options.length, prompt.selected], [['Select Reasoning Level for GPT-6.1-Sol'], 2, 1]);
});

// Claude Code's single choice with an own-answer option, as captured from
// Claude Code: focusing it adds an editor hint, and typing replaces its label.
function ownAnswerFixture() {
  const labels = ['Switch to Low', 'Switch, and auto-adjust from now', 'Keep Medium'];
  const state = { focus: 0, typed: '', writes: [], process: {} };
  const screen = () => [
    '│ Which effort should this chat use?', '',
    ...labels.map((label, i) => `${state.focus === i ? '❯' : ' '} ${i + 1}. ${label}`),
    `${state.focus === 3 ? '❯' : ' '} 4. ${state.typed || 'Type something.'}`,
    '──────────', `${state.focus === 4 ? '❯' : ' '} 5. Chat about this`, '',
    `Enter to select · ↑/↓ to navigate${state.focus === 3 ? ' · ctrl+g to edit in Notepad' : ''} · Esc to cancel`,
  ].join('\n');
  const sessions = { get: () => ({ process: state.process }), read: async () => ({ screen: screen() }), keys: (_, data) => {
    state.writes.push(data);
    if (data === '\x1b[B') state.focus = Math.min(4, state.focus + 1);
    else if (data === '\x1b[A') state.focus = Math.max(0, state.focus - 1);
    else if (data !== '\r' && state.focus === 3) state.typed += data;
  } };
  return { state, sessions, screen };
}

test('a single choice names its own-answer option and keeps the approval while it has focus', async () => {
  const { state, sessions, screen } = ownAnswerFixture();
  const prompt = terminalPrompt(screen());
  assert.deepEqual([prompt.kind, prompt.input, prompt.options.length], ['single', 3, 5]);
  state.focus = 3; assert.equal(terminalPrompt(screen()).id, (state.focus = 0, terminalPrompt(screen())).id);
  // Moving past the free-text option to Chat about this still answers.
  const shown = await readPrompt(sessions, 'chat');
  assert.deepEqual(await answerPrompt(sessions, 'chat', shown.id, 4), { delivered: true, choice: 4, option: 'Chat about this' });
  assert.deepEqual(state.writes, ['\x1b[B', '\x1b[B', '\x1b[B', '\x1b[B', '\r']);
});

test('an own answer is typed into the free-text option, then submitted once it shows', async () => {
  const { state, sessions } = ownAnswerFixture();
  let shown = await readPrompt(sessions, 'chat');
  await assert.rejects(answerPrompt(sessions, 'chat', shown.id, 3), /own answer/);
  await assert.rejects(answerPrompt(sessions, 'chat', shown.id, { text: '  ' }), /at most 2000/);
  shown = await readPrompt(sessions, 'chat');
  assert.deepEqual(await answerPrompt(sessions, 'chat', shown.id, { text: 'Keep it\nfree' }), { delivered: true, choice: 3, option: 'Keep it free' });
  assert.deepEqual(state.writes, ['\x1b[B', '\x1b[B', '\x1b[B', 'Keep it free', '\r']);
  assert.equal(state.typed, 'Keep it free');
});

test('an own answer that does not appear in the menu is not submitted', async () => {
  const { state, sessions } = ownAnswerFixture();
  sessions.keys = (_, data) => { state.writes.push(data); if (data === '\x1b[B') state.focus++; };
  const shown = await readPrompt(sessions, 'chat');
  await assert.rejects(answerPrompt(sessions, 'chat', shown.id, { text: 'lost' }), error => error.status === 409 && /did not show up/.test(error.message));
  assert.equal(state.writes.includes('\r'), false);
});
