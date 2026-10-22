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
