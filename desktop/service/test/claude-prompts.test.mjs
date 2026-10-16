import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PromptDriver, cleanPrompt, planChoices, planMenu, promptHookSettings, questionMenu, readPrompt, reviewMenu } from '../claude-prompts.mjs';
import { nativeActivity } from '../native-events.mjs';
import { terminalCommand } from '../agents.mjs';
import { Sessions } from '../sessions.mjs';
import { FakePicker, FakePlan } from './fake-claude-prompts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const temporary = async name => { await mkdir(path.join(root, '.cache'), { recursive: true }); return mkdtemp(path.join(root, '.cache', `${name}-`)); };
const pet = { question: 'Which pet?', header: 'Pet', multiSelect: false, options: [{ label: 'Dragon', description: 'Breathes fire.' }, { label: 'Owl', description: 'Flies at night.' }, { label: 'Moose', description: 'Very northern.' }] };
const snacks = { question: 'Which snacks?', header: 'Snacks', multiSelect: true, options: [{ label: 'Bread', description: 'A loaf.' }, { label: 'Cheese', description: 'A wedge.' }, { label: 'Fish', description: 'Smoked.' }] };

const driver = fake => new PromptDriver({ screen: async () => fake.screen(), press: data => fake.press(data) }, { timeout: 1500 });

test('the terminal\'s question picker, review and plan approval are read from the screen', () => {
  const picker = new FakePicker([pet, snacks]);
  const menu = questionMenu(picker.screen(), pet);
  assert.deepEqual(menu.map(row => [row.number, row.label, row.cursor]), [[1, 'Dragon', true], [2, 'Owl', false], [3, 'Moose', false], [4, 'Type something.', false], [5, 'Chat about this', false]]);
  assert.equal(questionMenu(picker.screen(), snacks), null, 'only the question on screen counts');
  assert.equal(questionMenu(picker.screen(), { ...pet, options: [{ label: 'Cat' }, ...pet.options.slice(1)] }), null, 'options must match');
  picker.advance('Owl');
  assert.deepEqual(questionMenu(picker.screen(), snacks).filter(row => row.submit || row.checked !== undefined).map(row => row.label), ['Bread', 'Cheese', 'Fish', 'Type something', 'Submit']);
  picker.advance('Bread'); assert.deepEqual(reviewMenu(picker.screen()).map(row => row.label), ['Submit answers', 'Cancel']);
  const plan = new FakePlan().screen();
  assert.deepEqual(planMenu(plan).map(row => row.label), ['Yes, and use auto mode', 'Yes, manually approve edits', 'Tell Claude what to change'], 'the plan\'s own numbered steps are not choices');
  assert.deepEqual(planChoices(plan).map(choice => choice.feedback), [false, false, true]);
});

test('answers press the keys a person would and check the screen at each step', async () => {
  const two = new FakePicker([pet, snacks]);
  assert.deepEqual(await driver(two).answerQuestions({ questions: [pet, snacks] }, [{ options: ['Moose'] }, { options: ['Cheese', 'Fish'], other: 'pickled herring 2' }]), { answered: true });
  assert.equal(two.done, true); assert.deepEqual(two.answers, ['Moose', 'Cheese, Fish, pickled herring 2']);
  const typed = new FakePicker([pet]);
  await driver(typed).answerQuestions({ questions: [pet] }, [{ options: [], other: 'A small\nfox' }]);
  assert.deepEqual(typed.answers, ['A small fox'], 'control characters never reach the terminal');
  const plan = new FakePlan();
  await driver(plan).answerPlan({ number: 3, label: 'Tell Claude what to change', text: 'Use hello instead' });
  assert.deepEqual(plan.done, { choice: 3, text: 'Use hello instead' });
  const approve = new FakePlan();
  await driver(approve).answerPlan({ number: 2, label: 'Yes, manually approve edits' });
  assert.deepEqual(approve.done, { choice: 2, text: '' });
});

test('nothing is pressed for a question the terminal is not showing or a changed plan', async () => {
  let pressed = 0;
  const elsewhere = new PromptDriver({ screen: async () => '❯ \n  ⏵⏵ auto mode on', press: () => pressed++ }, { timeout: 300 });
  await assert.rejects(elsewhere.answerQuestions({ questions: [pet] }, [{ options: ['Owl'] }]), /Open the terminal/);
  await assert.rejects(driver(new FakePicker([pet])).answerQuestions({ questions: [pet] }, [{ options: ['Owl', 'Moose'] }]), /Choose one answer/);
  await assert.rejects(driver(new FakePicker([snacks])).answerQuestions({ questions: [snacks] }, [{ options: [] }]), /at least one/);
  const plan = new FakePlan();
  await assert.rejects(driver(plan).answerPlan({ number: 1, label: 'Yes, and bypass permissions' }), /choices changed/);
  assert.equal(pressed, 0); assert.equal(plan.cursor, 0); assert.equal(plan.done, null);
});

test('the hook saves what Claude asks, and only its result or a later prompt ends the wait', async () => {
  const state = await temporary('claude-prompts');
  const { dir, file } = await promptHookSettings(state);
  const settings = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'AskUserQuestion|ExitPlanMode');
  assert.deepEqual(terminalCommand('claude', { claudeSettings: file }).args.slice(-2), ['--settings', file]);
  const id = '11111111-2222-4333-8444-555555555555', input = JSON.stringify({ session_id: id, tool_name: 'AskUserQuestion', tool_use_id: 'toolu_a', tool_input: { questions: [pet] } });
  await new Promise((resolve, reject) => { const child = execFile(process.execPath, [fileURLToPath(new URL('../claude-prompt-hook.mjs', import.meta.url)), dir], error => error ? reject(error) : resolve()); child.stdin.end(input); });
  const prompt = await readPrompt(dir, id);
  assert.equal(prompt.kind, 'question'); assert.equal(prompt.id, 'toolu_a'); assert.deepEqual(prompt.questions, [pet]);
  assert.equal(await readPrompt(dir, id, Date.now() + 60000), null, 'a prompt from before this launch is ignored');
  assert.equal(await readPrompt(dir, '../escape'), null);
  assert.equal(cleanPrompt({ tool: 'Bash', id: 'x', input: {} }), null);

  const sessions = await new Sessions(state, path.join(state, '.mrmak')).init();
  const item = sessions.make({ id: 'chat', name: 'Questions', agent: 'claude', open: false, status: 'running', createdAt: new Date().toISOString(), cols: 80, rows: 25 });
  sessions.items.set(item.id, item);
  const event = record => sessions.nativeEvent(item, nativeActivity({ timestamp: new Date().toISOString(), ...record }, 'claude'));
  sessions.nativeEvent(item, { kind: 'asking', asking: { kind: 'plan', id: 'toolu_b', at: new Date(Date.now() - 1000).toISOString() } });
  assert.equal(item.activity, 'waiting'); assert.equal(sessions.list()[0].asking.id, 'toolu_b');
  event({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_b', name: 'ExitPlanMode' }] } });
  event({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_a' }] } });
  event({ type: 'user', timestamp: new Date(Date.now() - 5000).toISOString(), message: { content: 'Feedback written before this plan' } });
  assert.equal(item.asking?.id, 'toolu_b', 'its own call and earlier records keep the wait');
  event({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_b' }] } });
  assert.equal(item.asking, null); assert.equal(item.activity, 'working');
  await sessions.close();
});
