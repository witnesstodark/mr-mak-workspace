import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { Sessions, terminalReport } from '../sessions.mjs';
import { createService } from '../server.mjs';
import { nativeActivity, tailNativeFile } from '../native-events.mjs';
import { sleep } from '../util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const answer = id => ({ kind: 'turn-completed', id, text: 'The agent finished its turn.', preview: 'Ready to review.' });
async function fixture() {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'activity-test-'));
  const sessions = await new Sessions(repo, path.join(repo, '.mrmak')).init();
  const item = sessions.make({ id: 'chat-a', name: 'Activity Review', agent: 'codex', open: false, status: 'running', createdAt: new Date().toISOString(), cols: 80, rows: 25 });
  sessions.items.set(item.id, item);
  return { repo, sessions, item };
}
async function until(check, timeout = 3500) {
  const end = Date.now() + timeout;
  while (!(await check())) { if (Date.now() > end) throw new Error('Timed out'); await sleep(30); }
}

test('native activity separates accepted tasks, tool work, final answers and interruptions', () => {
  assert.equal(nativeActivity({ type: 'event_msg', payload: { type: 'task_started' } }, 'codex').kind, 'turn-started');
  assert.equal(nativeActivity({ type: 'event_msg', payload: { type: 'token_count' } }, 'codex'), null);
  assert.equal(nativeActivity({ type: 'event_msg', payload: { type: 'turn_aborted' } }, 'codex').kind, 'turn-interrupted');
  assert.equal(nativeActivity({ type: 'user', message: { content: 'Please review this.' } }, 'claude').kind, 'turn-started');
  assert.equal(nativeActivity({ type: 'user', isMeta: true, message: { content: 'Context loaded.' } }, 'claude'), null);
  assert.equal(nativeActivity({ type: 'assistant', isSidechain: true, message: { stop_reason: 'tool_use' } }, 'claude'), null);
  assert.equal(nativeActivity({ type: 'assistant', message: { stop_reason: 'tool_use' } }, 'claude').kind, 'turn-started');
  assert.equal(nativeActivity({ type: 'user', message: { content: [{ type: 'tool_result', content: 'Command finished.' }] } }, 'claude').kind, 'turn-started');
  assert.equal(nativeActivity({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'Internal reasoning.' }] } }, 'claude'), null);
  assert.equal(nativeActivity({ type: 'assistant', message: { id: 'msg-1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } }, 'claude').id, 'msg-1');
  assert.equal(nativeActivity({ type: 'user', message: { content: '[Request interrupted by user]' } }, 'claude').kind, 'turn-interrupted');
  assert.equal(nativeActivity({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }, 'claude').kind, 'turn-interrupted');
  assert.equal(nativeActivity({ type: 'assistant', message: { stop_reason: 'end_turn' } }, 'kimi'), null);
});

test('unread answers survive new work and restart; stale acknowledgements and duplicate completions are ignored', async () => {
  const { repo, sessions, item } = await fixture();
  let restored;
  try {
    assert.equal(item.activity, 'idle'); // A live process is not a working agent.
    sessions.nativeEvent(item, { kind: 'turn-started' });
    assert.equal(item.activity, 'working'); assert.equal(item.unread, false);
    sessions.nativeEvent(item, answer('turn-1'));
    assert.equal(item.activity, 'idle'); assert.equal(item.unread, true);
    const version = item.completionVersion;
    sessions.nativeEvent(item, answer('turn-1'));
    assert.equal(item.completionVersion, version);
    sessions.nativeEvent(item, { kind: 'turn-started' });
    assert.equal(item.unread, true);
    sessions.nativeEvent(item, answer('turn-2'));
    sessions.seen(item.id, version);
    assert.equal(item.unread, true);
    sessions.nativeEvent(item, { kind: 'turn-started' });
    await sessions.close();
    restored = await new Sessions(repo, path.join(repo, '.mrmak')).init();
    const saved = restored.get(item.id);
    assert.equal(saved.unread, true); assert.equal(saved.activity, 'idle'); assert.equal(saved.status, 'stopped');
    restored.seen(item.id, saved.completionVersion);
    assert.equal(saved.unread, false);
    restored.nativeEvent(saved, answer('turn-2'));
    assert.equal(saved.unread, false);
    restored.nativeEvent(saved, { kind: 'turn-started' });
    restored.nativeEvent(saved, { kind: 'turn-interrupted' });
    assert.equal(saved.activity, 'idle'); assert.equal(saved.unread, false);
  } finally { await restored?.close(); await sessions.close(); }
});

test('tailing reacts to new native records without replaying history or completing from silence', async () => {
  const { repo, sessions } = await fixture();
  const file = path.join(repo, 'native.jsonl');
  const old = JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'old' } }) + '\n';
  await writeFile(file, old);
  const events = [];
  const stop = tailNativeFile(file, 'codex', event => events.push(event), Buffer.byteLength(old));
  try {
    await appendFile(file, JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }) + '\n');
    await until(() => events.length === 1);
    await sleep(900); assert.deepEqual(events.map(x => x.kind), ['turn-started']);
    const next = Buffer.from(JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'new', last_agent_message: 'Ready 🐽' } }) + '\n');
    const split = next.indexOf(Buffer.from('🐽')) + 2;
    await appendFile(file, next.subarray(0, split));
    await sleep(550); assert.equal(events.length, 1);
    await appendFile(file, next.subarray(split));
    await until(() => events.length === 2);
    assert.equal(events[1].id, 'new'); assert.equal(events[1].preview, 'Ready 🐽');
  } finally { stop(); await sessions.close(); }
});

test('New chat with a native ID and History resume capture the transcript boundary before launch', async () => {
  const { repo, sessions } = await fixture();
  const original = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(repo, 'codex-home');
  const nativeId = '00000000-0000-0000-0000-000000000123';
  const folder = path.join(process.env.CODEX_HOME, 'sessions', '2026', '09', '12');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `rollout-${nativeId}.jsonl`);
  const old = JSON.stringify({ type: 'session_meta', payload: { id: nativeId } }) + '\n';
  await writeFile(file, old);
  const boundaries = [];
  // Check the real create/resume paths without running or prompting another agent.
  sessions.launch = (session, resumeId, boundary) => { assert.equal(resumeId, nativeId); boundaries.push(boundary); };
  try {
    const created = await sessions.create({ agent: 'codex', name: 'Imported Review', cwd: repo, resumeId: nativeId });
    assert.deepEqual(boundaries[0], { file, offset: Buffer.byteLength(old) });
    const extra = JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'old' } }) + '\n';
    await appendFile(file, extra);
    await sessions.resume(created.id);
    assert.deepEqual(boundaries[1], { file, offset: Buffer.byteLength(old + extra) });
  } finally { if (original === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = original; await sessions.close(); }
});

test('only the subscribed Chats view can acknowledge the exact answer; navigation and Workspace cannot', async () => {
  const { repo, sessions } = await fixture();
  await sessions.close();
  await mkdir(path.join(repo, 'workspace'));
  await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), '{"entities":[]}');
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>Activity test</html>');
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  const sockets = [];
  async function connect(surface) {
    const ws = new WebSocket(service.origin.replace('http:', 'ws:') + '/events', { origin: service.origin });
    const messages = [];
    sockets.push(ws); ws.on('message', raw => messages.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'auth', token: service.token, surface }));
    await until(() => messages.some(x => x.type === 'connected'));
    return { ws, messages };
  }
  async function send(ws, message, messages) {
    const before = messages.filter(x => x.type === 'pong').length;
    ws.send(JSON.stringify(message)); ws.send(JSON.stringify({ type: 'ping' }));
    await until(() => messages.filter(x => x.type === 'pong').length > before);
  }
  try {
    const item = service.sessions.get('chat-a');
    service.sessions.nativeEvent(item, answer('new'));
    await fetch(service.origin + '/api/sessions/chat-a/focus', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(item.unread, true);
    const workspace = await connect('workspace'), chats = await connect('chats');
    for (const client of [workspace, chats]) {
      await send(client.ws, { type: 'selected', id: item.id }, client.messages);
      assert.equal(item.unread, true);
    }
    const seen = { type: 'seen', id: item.id, completionVersion: item.completionVersion };
    await send(chats.ws, seen, chats.messages); assert.equal(item.unread, true);
    await send(workspace.ws, { type: 'subscribe', id: item.id }, workspace.messages);
    await until(() => workspace.messages.some(x => x.type === 'snapshot'));
    await send(workspace.ws, seen, workspace.messages); assert.equal(item.unread, true);
    await send(chats.ws, { type: 'subscribe', id: item.id }, chats.messages);
    await until(() => chats.messages.some(x => x.type === 'snapshot'));
    await send(chats.ws, { ...seen, completionVersion: seen.completionVersion - 1 }, chats.messages);
    assert.equal(item.unread, true);
    await send(chats.ws, seen, chats.messages); assert.equal(item.unread, false);
  } finally { sockets.forEach(ws => ws.terminate()); await service.close(); }
});

test('terminal replies and mouse reports do not count as typing, keys do', () => {
  // Moving the pointer over a fullscreen Claude chat sends SGR mouse reports.
  for (const report of ['\x1b[<35;40;12M', '\x1b[<0;10;5M\x1b[<0;10;5m', '\x1b[I', '\x1b[O', '\x1b[12;40R', '\x1b[?2026;2$y', '\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\','\x1b[M #!']) assert.equal(terminalReport(report), true, JSON.stringify(report));
  for (const key of ['a', 'hello', '\r', '\x1b[A', '\x7f', '\x1b[<35;40;12Mx']) assert.equal(terminalReport(key), false, JSON.stringify(key));
});
