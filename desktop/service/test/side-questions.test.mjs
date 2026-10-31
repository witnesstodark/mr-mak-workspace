import test from 'node:test';
import assert from 'node:assert/strict';
import { answerText, sameQuestion, scrolled, SideQuestions, sideQuestionPanel } from '../side-questions.mjs';

// Drawn by Claude Code 2.1.312 in a 100 × 32 terminal while the agent was working.
const top = [
  ' ▐▛███▛█   Claude Code v2.1.312',
  '',
  '❯ Reply with just the word OK.',
  '',
  '✢ Mulling… (running PreToolUse hooks… 0/2 · 4s)',
  `${'▔'.repeat(79)} ◐ medium · /effort ▔`,
  '',
];
const question = 'In two short sentences, what is the capital of France and its river?';
const answering = [...top, `    /btw ${question}`, '', '      ✽ Answering…', '', '    Esc to close'].join('\n');
const answer = ['      A capital da França é Paris. A cidade é banhada pelo rio Sena, que a atravessa de leste a', '      oeste.'];
const answered = (lines = answer, asked = question) => [...top, `    /btw ${asked}`, '', ...lines, '', '    ↑/↓ to scroll · c to copy · f to fork · Esc to close'].join('\n');

test('the /btw panel is read from the bottom of the screen', () => {
  assert.deepEqual(sideQuestionPanel(answering), { question, box: ['      ✽ Answering…'], state: 'answering' });
  const panel = sideQuestionPanel(answered());
  assert.equal(panel.state, 'answered');
  assert.equal(panel.question, question);
  assert.equal(answerText(panel.box, 100), 'A capital da França é Paris. A cidade é banhada pelo rio Sena, que a atravessa de leste a oeste.');
  // An error leaves the scroll hint but no copy.
  assert.equal(sideQuestionPanel([...top, `    /btw ${question}`, '', '      Failed to get response', '', '    ↑/↓ to scroll · Esc to close'].join('\n')).state, 'failed');
  // The prompt without a panel, and a conversation that merely quotes one.
  assert.equal(sideQuestionPanel([...top, '❯ ', '  ⏵⏵ auto mode on'].join('\n')), null);
  assert.equal(sideQuestionPanel(['● Here is the hint you asked about:', '  /btw what now', '  Esc to close', '', '❯ ', '  ⏵⏵ auto mode on (shift+tab to cycle)', '  ? for shortcuts', '  status line'].join('\n')), null);
  // Earlier questions are listed above the current one.
  assert.equal(sideQuestionPanel([...top, '    (+1 earlier /btw)', '    /btw older question', `    /btw ${question}`, '', ...answer, '', '    shift+←/→ to browse · c to copy · Esc to close'].join('\n')).question, question);
});

test('a question cut to the terminal width still matches', () => {
  assert.ok(sameQuestion('What is the capital of Fra…', 'What is the capital of  France?'));
  assert.ok(sameQuestion('What   is it?', 'What is it?'));
  assert.equal(sameQuestion('What is the capital of Ger…', 'What is the capital of France?'), false);
  assert.equal(sameQuestion('', 'Anything'), false);
});

test('wrapped answer lines are joined, lists and paragraphs are kept', () => {
  const box = ['      Two points:', '', '      - First, a list item that is long enough to have been wrapped by the terminal at the', '        width.', '      - Second.', '      Short line.', '      Next short line.'];
  assert.equal(answerText(box, 100), 'Two points:\n\n- First, a list item that is long enough to have been wrapped by the terminal at the width.\n- Second.\nShort line.\nNext short line.');
});

test('scrolling appends only the lines the new view adds', () => {
  assert.deepEqual(scrolled(['a', 'b', 'c'], ['b', 'c', 'd']), { lines: ['a', 'b', 'c', 'd'], gap: false });
  assert.deepEqual(scrolled(['a', 'b', 'c'], ['a', 'b', 'c']), { lines: ['a', 'b', 'c'], gap: false });
  assert.deepEqual(scrolled(['a', 'b'], ['x', 'y']), { lines: ['a', 'b', 'x', 'y'], gap: true });
});

// A terminal that shows a scripted screen per read and records the keys pressed.
function fakeSessions(screens, { cols = 100 } = {}) {
  const proc = {}, pressed = [], inputs = [];
  let index = 0;
  const session = { id: 'chat', agent: 'claude', process: proc };
  return {
    pressed, inputs, session,
    get: () => session,
    read: async () => ({ screen: typeof screens === 'function' ? screens(pressed) : screens[Math.min(index++, screens.length - 1)], cols }),
    input: (id, text, options) => { inputs.push({ text, options }); return { delivered: true }; },
    keys: (id, data) => pressed.push(data),
  };
}
const until = async (check, ms = 2000) => { for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('timed out'); };
const timing = { poll: 5, appear: 200, timeout: 2000, redraw: 40 };

test('a side question is sent as /btw, its answer captured and its panel closed', async () => {
  const prompt = [...top, '❯ ', '  ⏵⏵ auto mode on'].join('\n');
  const sessions = fakeSessions(keys => keys.includes('\x1b') ? prompt : sessions.inputs.length ? (sessions.reads++ < 2 ? answering : answered()) : prompt);
  sessions.reads = 0;
  const questions = new SideQuestions(sessions, timing);
  const entry = await questions.ask('chat', `  ${question.replace('capital', 'capital\n')}  `);
  assert.equal(entry.question, question);
  assert.deepEqual(sessions.inputs, [{ text: `/btw ${question}`, options: { coordinator: true, submit: true } }]);
  assert.ok(questions.busy('chat'));
  await assert.rejects(questions.guard('chat'), { status: 409 });
  await until(() => questions.list('chat')[0].status === 'answered');
  const [done] = questions.list('chat');
  assert.match(done.answer, /^A capital da França é Paris\..* oeste\.$/);
  assert.equal(done.closed, true);
  // One ↓ found nothing more to scroll; Esc closed the panel it verified first.
  assert.deepEqual(sessions.pressed, ['\x1b[B', '\x1b']);
  assert.equal(questions.busy('chat'), false);
  await questions.guard('chat');
});

test('a long answer is collected by scrolling the panel', async () => {
  const all = Array.from({ length: 9 }, (_, index) => `      line ${index + 1}`);
  // The box shows four lines; each ↓ moves it two.
  const sessions = fakeSessions(keys => {
    if (!sessions.inputs.length || keys.includes('\x1b')) return [...top, '❯ '].join('\n');
    const offset = Math.min(keys.filter(key => key === '\x1b[B').length * 2, all.length - 4);
    return answered(all.slice(offset, offset + 4));
  });
  const questions = new SideQuestions(sessions, timing);
  await questions.ask('chat', question).catch(error => assert.fail(error));
  await until(() => questions.list('chat')[0].status === 'answered');
  assert.equal(questions.list('chat')[0].answer, all.map(line => line.trim()).join('\n'));
  assert.equal(questions.list('chat')[0].partial, undefined);
});

test('side questions are refused or reported when the terminal cannot take them', async () => {
  const menu = [...top, 'Do you want to proceed?', '❯ 1. Yes', '  2. No', '', 'Esc to cancel'].join('\n');
  await assert.rejects(new SideQuestions(fakeSessions([menu]), timing).ask('chat', 'Why?'), /asking a question/);
  await assert.rejects(new SideQuestions(fakeSessions([answered()]), timing).ask('chat', 'Why?'), /already|open in the terminal/);
  await assert.rejects(new SideQuestions(fakeSessions([top.join('\n')]), timing).ask('chat', '   '), /Write the side question/);
  const codex = fakeSessions([top.join('\n')]); codex.session.agent = 'codex';
  await assert.rejects(new SideQuestions(codex, timing).ask('chat', 'Why?'), /Claude Code chats/);
  await new SideQuestions(codex, timing).guard('chat');
  // The panel never opened: an older CLI, or a dialog took the text.
  const silent = new SideQuestions(fakeSessions([[...top, '❯ '].join('\n')]), timing);
  await silent.ask('chat', 'Why?');
  await until(() => silent.list('chat')[0].status === 'unavailable');
  // Closed in the terminal before the answer arrived.
  const closed = fakeSessions([[...top, '❯ '].join('\n'), answering.replace(question, 'Why?'), [...top, '❯ '].join('\n')]);
  const early = new SideQuestions(closed, timing);
  await early.ask('chat', 'Why?');
  await until(() => early.list('chat')[0].status === 'closed');
  assert.deepEqual(closed.pressed, []);
});
