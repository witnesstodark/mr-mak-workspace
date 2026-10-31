import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClaudeQuestions, HOOK_SCRIPT, questionItems, questionKey } from '../claude-questions.mjs';
import { pendingQuestions, transcriptMessages } from '../mobile-transcript.mjs';
import { nativeActivity } from '../native-events.mjs';
import { terminalCommand, inventory } from '../agents.mjs';
import { MobileGateway } from '../mobile.mjs';
import { Attachments } from '../attachments.mjs';
import { Sessions } from '../sessions.mjs';

const QUESTIONS = [
  { question: 'Which colour should the banner use?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'A warm red.' }, { label: 'Blue', description: 'A calm blue.', preview: '[ blue banner ]' }] },
  { question: 'Which extras do you want?', header: 'Extras', multiSelect: true, options: [{ label: 'Shadow', description: 'A soft drop shadow.' }, { label: 'Border', description: 'A thin border.' }, { label: 'Glow', description: 'An outer glow.' }] },
];
const ask = { type: 'assistant', uuid: 'a2', timestamp: '2026-10-30T10:00:02Z', message: { id: 'msg-2', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_ask', name: 'AskUserQuestion', input: { questions: QUESTIONS } }] } };
const records = [
  { type: 'user', uuid: 'u1', timestamp: '2026-10-30T10:00:00Z', message: { content: 'Make a banner.' } },
  { type: 'assistant', uuid: 'a1', timestamp: '2026-10-30T10:00:01Z', message: { id: 'msg-1', stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'Checking the files first.' }, { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'ls banners', description: 'List banners' } }] } },
  { type: 'user', uuid: 'r1', timestamp: '2026-10-30T10:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: '\x1b[32mold.png\x1b[0m\nnew.png' }] } },
  ask,
];

test('a pending AskUserQuestion shows on the phone with its options; tool calls show input and a result preview', () => {
  const messages = transcriptMessages(records, 'claude');
  assert.deepEqual(messages.map(item => item.role), ['user', 'assistant', 'tool', 'tool']);
  const bash = messages[2].tool;
  assert.equal(bash.name, 'Bash'); assert.equal(bash.summary, 'ls banners'); assert.equal(bash.status, 'completed');
  assert.match(bash.input, /"command": "ls banners"/); assert.equal(bash.result, 'old.png\nnew.png');
  assert.ok(!JSON.stringify(messages).includes('private reasoning'));
  const question = messages[3].tool;
  assert.equal(question.status, 'running'); assert.equal(question.input, undefined);
  assert.deepEqual(question.questions, questionItems({ questions: QUESTIONS }));
  assert.equal(question.questions[0].options[1].preview, '[ blue banner ]');
  assert.equal(question.questions[1].multiSelect, true);
  // Without a waiting hook the question is shown but answered in the terminal.
  const [pending] = pendingQuestions(messages, [], true);
  assert.equal(pending.answerable, false); assert.equal(pending.questions[1].options.length, 3);
  assert.deepEqual(pendingQuestions(messages, [], false), []);
  const live = { id: randomUUID(), at: 'now', key: questionKey(question.questions), questions: question.questions };
  assert.deepEqual(pendingQuestions(messages, [live], true), [{ id: live.id, at: ask.timestamp, questions: question.questions, answerable: true }]);
  // A later written message means the agent moved on: no stale question remains.
  assert.deepEqual(pendingQuestions([...messages, { id: 'x', role: 'assistant', text: 'Done.', at: '' }], [], true), []);
  // The answer is shown in place once Claude records it.
  const answered = transcriptMessages([...records, { type: 'user', uuid: 'r2', toolUseResult: { questions: QUESTIONS, answers: { [QUESTIONS[0].question]: 'Blue', [QUESTIONS[1].question]: 'Shadow, Glow' } }, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_ask', content: 'The user answered...' }] } }], 'claude');
  assert.equal(answered[3].tool.status, 'completed');
  assert.deepEqual(answered[3].tool.answers, { [QUESTIONS[0].question]: 'Blue', [QUESTIONS[1].question]: 'Shadow, Glow' });
  assert.deepEqual(pendingQuestions(answered, [], true), []);
});

test('Codex tool calls keep their arguments and output preview', () => {
  const messages = transcriptMessages([
    { type: 'event_msg', payload: { type: 'user_message', message: 'Run the tests' } },
    { type: 'response_item', timestamp: 't', payload: { type: 'function_call', call_id: 'c1', name: 'shell', arguments: JSON.stringify({ command: ['npm', 'test'], workdir: '/repo' }) } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: '142 passing', metadata: { exit_code: 0 } }) } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'All passing.' } },
  ], 'codex');
  assert.deepEqual(messages.map(item => item.role), ['user', 'tool', 'assistant']);
  assert.equal(messages[1].tool.summary, 'npm test'); assert.equal(messages[1].tool.result, '142 passing');
});

test('native activity marks a question as needing the answer and reports its tool result', () => {
  assert.deepEqual(nativeActivity(ask, 'claude'), { kind: 'question', toolUseId: 'toolu_ask', key: questionKey(questionItems({ questions: QUESTIONS })), text: 'Claude is asking you a question.' });
  assert.equal(nativeActivity({ ...ask, isSidechain: true }, 'claude'), null);
  assert.deepEqual(nativeActivity({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_ask', content: 'Answered' }] } }, 'claude'), { kind: 'turn-started', toolResults: ['toolu_ask'] });
});

async function hookFixture(t) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'iaar-questions-'));
  const questions = new ClaudeQuestions({ stateDir });
  const server = http.createServer((request, response) => questions.handle(request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  questions.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { questions.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  // Exactly how Claude Code runs the hook: JSON on stdin, decision on stdout.
  const runHook = (env, input = { session_id: 's', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: QUESTIONS } }) => {
    const child = spawn(process.execPath, [HOOK_SCRIPT], { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stdin.end(JSON.stringify(input));
    return { child, done: new Promise(resolve => child.on('exit', code => resolve({ code, stdout }))) };
  };
  return { stateDir, questions, runHook };
}
const until = async (check, timeout = 5000) => {
  const end = Date.now() + timeout;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 25)); }
};

test('Claude launches with an added --settings hook and its own token', async t => {
  const { stateDir, questions } = await hookFixture(t);
  const launch = await questions.launch('chat-1');
  const settings = JSON.parse(await readFile(launch.settings, 'utf8'));
  assert.equal(launch.settings, path.join(stateDir, 'claude-question-hooks.json'));
  const [entry] = settings.hooks.PermissionRequest;
  assert.equal(entry.matcher, 'AskUserQuestion');
  assert.equal(entry.hooks[0].command, `"${process.execPath.replaceAll('\\', '/')}" "${HOOK_SCRIPT.replaceAll('\\', '/')}"`);
  assert.ok(entry.hooks[0].timeout >= 3600);
  assert.equal(launch.env.IAAR_QUESTION_URL, `${questions.origin}/hooks/claude-question`);
  assert.ok(launch.env.IAAR_QUESTION_TOKEN.length >= 40);
  if (inventory().find(item => item.id === 'claude')?.available) {
    const command = terminalCommand('claude', { settings: launch.settings });
    const args = command.args.includes('-EncodedCommand') ? Buffer.from(command.args.at(-1), 'base64').toString('utf16le') : command.args.join(' ');
    assert.ok(args.includes('--settings') && args.includes('claude-question-hooks.json'));
  }
  // A relaunch or exit revokes the old token.
  const next = await questions.launch('chat-1');
  assert.notEqual(next.env.IAAR_QUESTION_TOKEN, launch.env.IAAR_QUESTION_TOKEN);
  questions.end('chat-1'); assert.equal(questions.tokens.size, 0);
});

test('without Iaar, or with a revoked token, the hook makes no decision and the terminal dialog stays in charge', async t => {
  const { questions, runHook } = await hookFixture(t);
  assert.deepEqual(await runHook({}).done, { code: 0, stdout: '' });
  assert.deepEqual(await runHook({ IAAR_QUESTION_URL: `${questions.origin}/hooks/claude-question`, IAAR_QUESTION_TOKEN: 'revoked' }).done, { code: 0, stdout: '' });
  assert.deepEqual(await runHook({ IAAR_QUESTION_URL: 'http://127.0.0.1:9/hooks/claude-question', IAAR_QUESTION_TOKEN: 'x' }).done, { code: 0, stdout: '' });
  const launch = await questions.launch('chat-1');
  assert.deepEqual(await runHook(launch.env, { tool_name: 'Bash', tool_input: { command: 'ls' } }).done, { code: 0, stdout: '' });
  assert.equal(questions.items.size, 0);
});

async function phoneFixture(t, questions) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'iaar-question-phone-'));
  await mkdir(path.join(repo, 'ui')); await writeFile(path.join(repo, 'ui/index.html'), '<html>Phone</html>');
  const sessions = new EventEmitter(), id = randomUUID();
  const session = { id, agent: 'claude', name: 'Banner chat', status: 'running', cols: 100, rows: 30, process: {}, nativeId: randomUUID(), cwd: repo };
  sessions.get = value => { assert.equal(value, id); return session; };
  sessions.list = () => [session]; sessions.input = () => assert.fail('A phone answer must not type into the terminal');
  const transport = { probe: async () => ({ ready: true }), enable: async origin => ({ origin }), disable: async () => {} };
  const gateway = await new MobileGateway({ repo, uiDir: path.join(repo, 'ui'), stateDir: repo, sessions, attachments: new Attachments(repo), closeChat: async () => {}, settings: () => ({}), transport, questions }).init();
  t.after(() => gateway.close()); await gateway.enable();
  gateway.transcripts.read = async () => ({ supported: true, messages: transcriptMessages(records, 'claude') });
  const request = async (route, data, cookie) => {
    const response = await fetch(`${gateway.origin}/mobile/api${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { Origin: gateway.origin, 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  const qr = await gateway.newPairing(), pending = (await request('/pair', { token: new URL(qr.url).hash.slice(6), name: 'Phone' })).data;
  await gateway.approve(pending.id);
  const { cookie } = await request('/pair/finish', pending);
  return { id, session, request, cookie };
}

test('an answer from the phone reaches the waiting hook as Claude expects: single, multi-select and Other text', async t => {
  const { questions, runHook } = await hookFixture(t);
  const { id, request, cookie } = await phoneFixture(t, questions);
  const launch = await questions.launch(id);
  const hook = runHook(launch.env);
  const pending = await until(async () => (await request(`/sessions/${id}/messages`, undefined, cookie)).data.questions.find(item => item.answerable));
  assert.deepEqual(pending.questions.map(item => [item.header, item.multiSelect, item.options.map(option => option.label)]), [['Colour', false, ['Red', 'Blue']], ['Extras', true, ['Shadow', 'Border', 'Glow']]]);
  assert.equal((await request(`/sessions/${id}/answer`, { id: pending.id, answers: { [QUESTIONS[0].question]: 'Blue' } }, cookie)).status, 400, 'Every question needs an answer');
  assert.equal((await request(`/sessions/${id}/answer`, { id: pending.id, answers: {} })).status, 401, 'Only a paired phone can answer');
  const answers = { [QUESTIONS[0].question]: 'Teal, with a gold edge', [QUESTIONS[1].question]: ['Shadow', 'Glow'] };
  const reply = await request(`/sessions/${id}/answer`, { id: pending.id, answers }, cookie);
  assert.equal(reply.status, 200); assert.equal(reply.data.status, 'delivered');
  const { code, stdout } = await hook.done;
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { questions: QUESTIONS, answers: { [QUESTIONS[0].question]: 'Teal, with a gold edge', [QUESTIONS[1].question]: 'Shadow, Glow' } } } } });
  // A retried request is confirmed; a different answer to a closed question is refused.
  assert.equal((await request(`/sessions/${id}/answer`, { id: pending.id, answers }, cookie)).data.status, 'delivered');
  assert.equal((await request(`/sessions/${id}/answer`, { id: pending.id, answers: { ...answers, [QUESTIONS[0].question]: 'Red' } }, cookie)).status, 409);
  assert.equal(questions.items.size, 0);
});

test('answering in the terminal releases the hook without output, and the phone is told it is closed', async t => {
  const { questions, runHook } = await hookFixture(t);
  const repo = await mkdtemp(path.join(os.tmpdir(), 'iaar-question-session-'));
  const sessions = await new Sessions(repo, path.join(repo, '.iaar')).init();
  t.after(() => sessions.close());
  sessions.questions = questions;
  const session = sessions.make({ id: 'chat-q', name: 'Banner chat', agent: 'claude', open: false, status: 'running', createdAt: new Date().toISOString(), cols: 80, rows: 25 });
  sessions.items.set(session.id, session);
  const notices = []; sessions.on('notice', notice => notices.push(notice.text));
  const launch = await questions.launch(session.id);
  const hook = runHook(launch.env);
  const [item] = await until(() => questions.pending(session.id).length && questions.pending(session.id));
  // The transcript tail reports the question, then the terminal's answer.
  sessions.nativeEvent(session, nativeActivity(ask, 'claude'));
  assert.equal(session.activity, 'waiting'); assert.equal(session.waiting, 'question'); assert.equal(session.attention, true);
  assert.deepEqual(notices, ['Banner chat: Claude is asking you a question.']);
  sessions.nativeEvent(session, { kind: 'question', text: 'Claude is asking you a question.' });
  assert.equal(notices.length, 1, 'The hook and transcript report one question once');
  sessions.nativeEvent(session, nativeActivity({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_ask', content: 'The user answered...' }] } }, 'claude'));
  assert.deepEqual(await hook.done, { code: 0, stdout: '' });
  assert.equal(session.activity, 'working'); assert.equal(session.waiting, null);
  await assert.rejects(questions.answer(session.id, item.id, { [QUESTIONS[0].question]: 'Red', [QUESTIONS[1].question]: 'Glow' }), /already answered or closed/);
});

test('a phone answer is not reported as delivered when the hook has gone', async t => {
  const { questions } = await hookFixture(t);
  const launch = await questions.launch('chat-1');
  // Register as the hook would, then never poll for the answer.
  const response = await fetch(launch.env.IAAR_QUESTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Iaar-Question-Token': launch.env.IAAR_QUESTION_TOKEN }, body: JSON.stringify({ action: 'ask', input: { tool_name: 'AskUserQuestion', tool_input: { questions: QUESTIONS } } }) });
  const { id } = await response.json();
  const started = Date.now();
  await assert.rejects(questions.answer('chat-1', id, { [QUESTIONS[0].question]: 'Red', [QUESTIONS[1].question]: 'Glow' }), /Terminal view/);
  assert.ok(Date.now() - started >= 4500);
  assert.equal(questions.items.size, 0);
});
