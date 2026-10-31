import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initialPromptArgument, terminalCommand } from '../agents.mjs';
import { HANDOFF_REQUEST, Handoffs, PAUSE_REQUEST, handoffText } from '../handoff.mjs';

test('a handoff is the reply to the latest request, from its heading', () => {
  const messages = [
    { role: 'user', text: HANDOFF_REQUEST }, { role: 'assistant', text: '# Handoff\nOld summary' },
    { role: 'user', text: 'Keep going' }, { role: 'assistant', text: '# Handoff\nNot requested' },
    { role: 'user', text: HANDOFF_REQUEST }, { role: 'assistant', text: 'Sure.\n\n# Handoff\n## Goal\nShip it' },
  ];
  assert.equal(handoffText(messages), '# Handoff\n## Goal\nShip it');
  assert.equal(handoffText(messages.slice(0, 1)), null);
  assert.equal(handoffText([{ role: 'assistant', text: '# Handoff\nUnrequested' }]), null);
});

test('a first message is one safe argument, placed before Claude\'s variadic --add-dir', async () => {
  const bin = await mkdtemp(path.join(os.tmpdir(), 'mrmak-first-prompt-'));
  for (const name of ['claude', 'codex']) await writeFile(path.join(bin, process.platform === 'win32' ? `${name}.exe` : name), '', { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try {
    const prompt = 'Continue the work. First read its handoff: `C:/handoffs/a b.md`.';
    const claude = terminalCommand('claude', { nativeId: '019a0000-1111-4222-8333-444455556666', initialPrompt: prompt, readDir: bin, effort: 'xhigh' });
    assert.equal(claude.args[0], prompt);
    assert.deepEqual(claude.args.slice(-2), ['--add-dir', bin]);
    const codex = terminalCommand('codex', { initialPrompt: prompt });
    assert.equal(codex.args.at(-1), prompt);
    // Codex runs in the terminal's own process only when it offers --no-daemon.
    assert.ok(!codex.args.includes('--no-daemon') && terminalCommand('codex', { noDaemon: true }).args.includes('--no-daemon'));
    for (const initialPrompt of ['--dangerously-skip-permissions', 'two\nlines', 'say "hi"', 'x'.repeat(4001), '   ']) assert.throws(() => terminalCommand('claude', { initialPrompt }), /first message/);
    assert.throws(() => terminalCommand('claude', { initialPrompt: prompt, resumeId: '019a0000-1111-4222-8333-444455556666' }), /new Codex or Claude/);
    assert.throws(() => terminalCommand('claude', { readDir: 'relative' }), /absolute folder/);
  } finally { process.env.PATH = previous; }
});

function fixture(reply) {
  const sessions = new EventEmitter(), inputs = [], created = [], opened = [], changes = [];
  const session = { id: 'old', agent: 'claude', name: 'Dream Game Combat', cwd: '/projects/game', bypass: false, effort: 'xhigh', status: 'running', activity: 'idle', completionVersion: 3, process: {} };
  sessions.get = () => session;
  sessions.input = (id, text, options) => inputs.push({ id, text, options });
  sessions.create = async options => { created.push(options); return { id: 'new' }; };
  const transcripts = { read: async () => ({ messages: [{ role: 'user', text: HANDOFF_REQUEST }, { role: 'assistant', text: reply }] }) };
  return { sessions, session, inputs, created, opened, changes, transcripts };
}

test('accepting a handoff asks the chat, saves its summary and opens a new chat in the same project', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-handoff-'));
  const { sessions, session, inputs, created, opened, changes, transcripts } = fixture('# Handoff\n## Next\nAdd parry timing');
  const handoffs = new Handoffs({ repo, sessions, transcripts, opened: id => opened.push(id), changed: (id, job) => changes.push(job.status) });
  assert.equal(handoffs.start('old').status, 'summarizing');
  assert.deepEqual(inputs.map(item => [item.text, item.options]), [[HANDOFF_REQUEST, { coordinator: true, submit: true }]]);
  assert.equal(handoffs.start('old').status, 'summarizing');
  assert.equal(inputs.length, 1);
  sessions.emit('session', { id: 'old', status: 'running', completionVersion: 3 });
  sessions.emit('session', { id: 'old', status: 'running', completionVersion: 4 });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(changes, ['summarizing', 'opening', 'done']);
  const job = handoffs.state('old');
  assert.equal(job.sessionId, 'new'); assert.deepEqual(opened, ['new']);
  assert.equal(path.dirname(job.file), path.join(repo, 'inbox', 'handoffs'));
  assert.match(await readFile(job.file, 'utf8'), /^# Handoff\n## Next\nAdd parry timing\n/);
  assert.equal(created.length, 1);
  assert.deepEqual({ ...created[0], initialPrompt: undefined }, { agent: 'claude', cwd: session.cwd, bypass: false, effort: 'xhigh', name: 'Dream Game Combat · continued', initialPrompt: undefined, readDir: path.join(repo, 'inbox', 'handoffs') });
  assert.ok(created[0].initialPrompt.includes(job.file));
  assert.equal(initialPromptArgument(created[0].initialPrompt), created[0].initialPrompt);
});

test('a pause saves the handoff and opens nothing until the owner chooses', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-handoff-'));
  const { sessions, inputs, created, opened, changes, transcripts } = fixture('# Handoff\n## Next\nTune the dash');
  transcripts.read = async () => ({ messages: [{ role: 'user', text: PAUSE_REQUEST }, { role: 'assistant', text: '# Handoff\n## Next\nTune the dash' }] });
  const handoffs = new Handoffs({ repo, sessions, transcripts, opened: id => opened.push(id), changed: (id, job) => changes.push(job?.status ?? null) });
  assert.equal(handoffs.pause('old').pause, true);
  assert.equal(inputs[0].text, PAUSE_REQUEST);
  assert.ok(PAUSE_REQUEST.startsWith('Mr. Mak handoff request: ') && PAUSE_REQUEST.includes('# Handoff'));
  sessions.emit('session', { id: 'old', status: 'running', completionVersion: 4 });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(changes, ['summarizing', 'paused']);
  const file = handoffs.state('old').file;
  assert.match(await readFile(file, 'utf8'), /Tune the dash/);
  assert.equal(created.length, 0); assert.deepEqual(opened, []);
  // Keep this chat clears the pause; a new chat from it opens only on request.
  assert.equal(handoffs.dismiss('old'), null); assert.equal(handoffs.state('old'), null);
  await assert.rejects(handoffs.continueFromPause('old'), /no paused handoff/);
  handoffs.pause('old'); sessions.emit('session', { id: 'old', status: 'running', completionVersion: 5 });
  await new Promise(resolve => setTimeout(resolve, 50));
  await handoffs.continueFromPause('old');
  assert.equal(handoffs.state('old').status, 'done'); assert.deepEqual(opened, ['new']);
  assert.ok(created[0].initialPrompt.includes(handoffs.state('old').file));
});

test('a paused handoff survives a service restart until it is used or dismissed', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-handoff-')), stateDir = await mkdtemp(path.join(os.tmpdir(), 'mrmak-state-'));
  const { sessions, transcripts } = fixture('# Handoff\n## Next\nTune the dash');
  transcripts.read = async () => ({ messages: [{ role: 'user', text: PAUSE_REQUEST }, { role: 'assistant', text: '# Handoff\n## Next\nTune the dash' }] });
  const savedFile = path.join(stateDir, 'paused-handoffs.json');
  const saved = async () => JSON.parse(await readFile(savedFile, 'utf8').catch(() => '{}'));
  // Saves run in the background; wait for the state the step expects instead of a fixed delay.
  const until = async check => { for (let i = 0; i < 500 && !(await check()); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(await check()); };
  const empty = async () => Object.keys(await saved()).length === 0;
  const first = await new Handoffs({ repo, stateDir, sessions, transcripts, opened: () => {}, changed: () => {} }).init();
  first.pause('old'); sessions.emit('session', { id: 'old', status: 'running', completionVersion: 4 });
  await until(async () => first.state('old')?.status === 'paused' && !!(await saved()).old);
  const file = first.state('old').file;
  // After a restart the chat still offers its pause, with the same handoff file.
  const second = await new Handoffs({ repo, stateDir, sessions, transcripts, opened: () => {}, changed: () => {} }).init();
  assert.deepEqual([second.state('old').status, second.state('old').file], ['paused', file]);
  // A chat that no longer exists, or a deleted handoff file, is dropped.
  const gone = { ...sessions, get: () => { throw new Error('Chat no longer exists'); } };
  const dropped = await new Handoffs({ repo, stateDir, sessions: gone, transcripts, opened: () => {}, changed: () => {} }).init();
  assert.equal(dropped.state('old'), null);
  await dropped.saved; assert.ok(await empty());
  await writeFile(savedFile, JSON.stringify({ old: { file: path.join(repo, 'missing.md'), at: 'x' } }));
  const missing = await new Handoffs({ repo, stateDir, sessions, transcripts, opened: () => {}, changed: () => {} }).init();
  assert.equal(missing.state('old'), null);
  await missing.saved; assert.ok(await empty());
  // Keep this chat and a new chat from the pause both clear the saved state.
  await writeFile(savedFile, JSON.stringify({ old: { file, at: 'x' } }));
  const third = await new Handoffs({ repo, stateDir, sessions, transcripts, opened: () => {}, changed: () => {} }).init();
  third.dismiss('old'); await third.saved; assert.ok(await empty());
  await writeFile(savedFile, JSON.stringify({ old: { file, at: 'x' } }));
  const fourth = await new Handoffs({ repo, stateDir, sessions, transcripts, opened: () => {}, changed: () => {} }).init();
  await fourth.continueFromPause('old'); await fourth.saved; assert.ok(await empty());
  assert.equal(fourth.state('old').status, 'done');
});

test('a handoff fails clearly when the chat stops or the reply has no summary', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-handoff-'));
  const stopped = fixture('# Handoff');
  const first = new Handoffs({ repo, ...stopped, opened: () => {}, changed: () => {} });
  first.start('old'); stopped.sessions.emit('session', { id: 'old', status: 'exited', completionVersion: 3 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(first.state('old').error, /stopped before/);
  const vague = fixture('I would rather keep going here.');
  const second = new Handoffs({ repo, ...vague, opened: () => {}, changed: () => {} });
  second.start('old'); vague.sessions.emit('session', { id: 'old', status: 'running', completionVersion: 4 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(second.state('old').status, 'failed'); assert.match(second.state('old').error, /did not reply with a handoff/);
  assert.equal(vague.created.length, 0);
  vague.session.activity = 'working';
  assert.throws(() => new Handoffs({ repo, ...vague, opened: () => {}, changed: () => {} }).start('old'), /current turn/);
});

test('compacting sends the CLI\'s own /compact only to an idle chat without an open menu', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-compact-'));
  const chat = fixture('# Handoff');
  let screen = 'Welcome back\n> ';
  chat.sessions.read = async () => ({ screen });
  const handoffs = new Handoffs({ repo, ...chat, opened: () => {}, changed: () => {} });
  assert.deepEqual(await handoffs.compact('old'), { command: '/compact' });
  assert.deepEqual(chat.inputs, [{ id: 'old', text: '/compact', options: { coordinator: true, submit: true } }]);
  screen = 'Do you want to make this edit?\n❯ 1. Yes\n  2. No, and tell Claude what to do differently\n';
  await assert.rejects(handoffs.compact('old'), /Answer the question/);
  screen = 'Welcome back\n> ';
  for (const activity of ['working', 'waiting']) { chat.session.activity = activity; await assert.rejects(handoffs.compact('old'), /current turn/); }
  chat.session.activity = 'idle';
  handoffs.jobs.set('old', { status: 'summarizing' });
  await assert.rejects(handoffs.compact('old'), /writing a handoff/);
  handoffs.jobs.clear();
  chat.session.process = null;
  await assert.rejects(handoffs.compact('old'), /Reconnect/);
  chat.session.process = {}; chat.session.agent = 'kimi';
  await assert.rejects(handoffs.compact('old'), /no compact command/);
  chat.session.agent = 'codex';
  await handoffs.compact('old');
  assert.equal(chat.inputs.length, 2);
  assert.equal(chat.inputs[1].text, '/compact');
});
