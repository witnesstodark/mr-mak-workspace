import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioBridge, resolveFolder } from '../../../src/desktop/studioBridge.ts';

function fixture({ running = true } = {}) {
  const calls = [];
  let clock = 0;
  const api = async (path, data) => {
    calls.push({ path, data });
    if (path === '/sessions') return { id: 'chat-1', agent: data.agent };
    if (path.endsWith('/screen')) return { status: running ? 'running' : 'exited', activity: 'idle', lastOutputAt: new Date(0).toISOString(), screen: 'line 1\nline 2' };
    if (path.endsWith('/messages')) return { supported: true, messages: [{ id: 'm1', role: 'user', text: 'x'.repeat(70000), at: '', imageRefs: ['a.png'] }], prompt: null, btw: [] };
    if (path.startsWith('/files')) return { entries: [{ name: 'Game', path: 'E:\\Repo\\projects\\Game', directory: true }, { name: 'notes.md', path: 'E:\\Repo\\projects\\notes.md', directory: false }] };
    return {};
  };
  const bridge = createStudioBridge({
    api,
    repo: () => 'E:\\Repo',
    agents: () => [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: false }, { id: 'shell', label: 'Shell', available: true }],
    sleep: async ms => { clock += ms; },
    now: () => clock + 100000,
  });
  return { bridge, calls };
}

test('studio folders resolve inside the repository', () => {
  assert.equal(resolveFolder('projects/Bleeding Stars', 'E:\\Repo'), 'E:\\Repo\\projects\\Bleeding Stars');
  assert.equal(resolveFolder('', '/home/me/repo'), '/home/me/repo');
  assert.equal(resolveFolder('D:/Games', 'E:\\Repo'), 'D:/Games');
  assert.equal(resolveFolder('/srv/game', '/home/me/repo'), '/srv/game');
  assert.throws(() => resolveFolder('projects/../../etc', 'E:\\Repo'), /inside the repository/);
});

test('the bridge starts studio chats without bypass and reaches only those', async () => {
  const { bridge, calls } = fixture();
  const hello = await bridge.handle('hello', {});
  assert.deepEqual(hello.agents.map(a => a.id), ['claude', 'codex']);
  await assert.rejects(bridge.handle('start', { agent: 'shell' }), /Choose Claude/);
  await assert.rejects(bridge.handle('start', { agent: 'codex' }), /not installed/);
  await assert.rejects(bridge.handle('start', { agent: 'claude', effort: 'turbo' }), /Effort/);
  await assert.rejects(bridge.handle('send', { id: 'someone-else', text: 'hi' }), /only reach chats it started/);
  await assert.rejects(bridge.handle('messages', { id: 'someone-else' }), /only reach chats it started/);

  const started = await bridge.handle('start', { agent: 'claude', cwd: 'projects/Game', effort: 'high', name: 'UI Studio Game', bypass: true });
  assert.deepEqual(started, { id: 'chat-1', agent: 'claude', reused: false });
  const create = calls.find(c => c.path === '/sessions');
  assert.deepEqual(create.data, { agent: 'claude', cwd: 'E:\\Repo\\projects\\Game', effort: 'high', name: 'UI Studio Game', bypass: false, background: true });

  const again = await bridge.handle('start', { agent: 'claude', cwd: 'projects/Game', effort: 'high' });
  assert.equal(again.reused, true);
  assert.equal(calls.filter(c => c.path === '/sessions').length, 1);

  await bridge.handle('send', { id: 'chat-1', text: 'Add a Back button' });
  assert.deepEqual(calls.find(c => c.path.endsWith('/send')).data, { text: 'Add a Back button', effort: { action: 'keep' } });
  await assert.rejects(bridge.handle('send', { id: 'chat-1', text: 'x'.repeat(64001) }), /Message is not valid/);

  const read = await bridge.handle('messages', { id: 'chat-1' });
  assert.equal(read.supported, true);
  assert.equal(read.activity, 'idle');
  assert.equal(read.messages[0].text.length, 60000);
  assert.equal(read.messages[0].imageRefs, undefined);
  assert.equal(read.screen, undefined);
  assert.equal(read.prompt, null);

  const list = await bridge.handle('list', { path: 'projects' });
  assert.deepEqual(list.entries, [{ name: 'Game', path: 'E:\\Repo\\projects\\Game' }]);
  assert.match(calls.find(c => c.path.startsWith('/files')).path, /E%3A%5CRepo%5Cprojects$/);
  await assert.rejects(bridge.handle('rm', {}), /Unknown studio request/);
});

test('a stopped studio chat is replaced instead of reused', async () => {
  const { bridge, calls } = fixture({ running: false });
  await assert.rejects(bridge.handle('start', { agent: 'claude' }), /stopped while starting/);
  assert.equal(calls.filter(c => c.path === '/sessions').length, 1);
  await assert.rejects(bridge.handle('start', { agent: 'claude' }), /stopped while starting/);
  assert.equal(calls.filter(c => c.path === '/sessions').length, 2, 'the stopped chat is not reused');
});

test('the studio reads and answers the menu of its own chat only', async () => {
  const calls = [];
  const menu = { id: 'ticket-1', kind: 'single', question: 'Allow copying the art?', detail: ['cp a b', 7], options: ['Yes', 'No', 'Type something.'], selected: 0, input: 2, extra: 'dropped' };
  const api = async (path, data) => {
    calls.push({ path, data });
    if (path === '/sessions') return { id: 'chat-1' };
    if (path.endsWith('/screen')) return { status: 'running', activity: 'waiting', lastOutputAt: new Date(0).toISOString() };
    if (path.endsWith('/messages')) return { supported: true, messages: [], prompt: menu };
    if (path.endsWith('/prompt')) return { delivered: true };
    return {};
  };
  let clock = 0;
  const bridge = createStudioBridge({ api, repo: () => 'E:\Repo', agents: () => [{ id: 'codex' }], sleep: async ms => { clock += ms; }, now: () => clock + 100000 });
  await bridge.handle('start', { agent: 'codex' });

  const read = await bridge.handle('messages', { id: 'chat-1' });
  assert.deepEqual(read.prompt, { id: 'ticket-1', kind: 'single', question: 'Allow copying the art?', detail: ['cp a b', '7'], options: ['Yes', 'No', 'Type something.'], selected: 0, input: 2 });

  await bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: 1 });
  await bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: { text: 'Copy only the icons', extra: 1 } });
  await bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: { checked: [0, 2] } });
  assert.deepEqual(calls.filter(c => c.path.endsWith('/prompt')).map(c => c.data), [
    { id: 'ticket-1', choice: 1 },
    { id: 'ticket-1', choice: { text: 'Copy only the icons' } },
    { id: 'ticket-1', choice: { checked: [0, 2] } },
  ]);
  await assert.rejects(bridge.handle('answer', { id: 'someone-else', prompt: 'ticket-1', choice: 0 }), /only reach chats it started/);
  await assert.rejects(bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: 'yes' }), /listed options/);
  await assert.rejects(bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: { text: '  ' } }), /listed options/);
});

test('the studio state goes to the service store', async () => {
  const calls = [];
  const api = async (path, data) => { calls.push({ path, data }); return data ? { draftAt: 5 } : { projects: null, draft: null, prefs: null }; };
  const bridge = createStudioBridge({ api, repo: () => 'E:\Repo', agents: () => [] });
  assert.deepEqual(await bridge.handle('state', {}), { projects: null, draft: null, prefs: null });
  const projects = { roots: ['projects'], hidden: ['projects/izztudio'] };
  await bridge.handle('save-state', { projects, draft: { doc: '{}', at: 5 }, other: 1 });
  assert.deepEqual(calls, [{ path: '/ui-studio/state', data: undefined }, { path: '/ui-studio/state', data: { projects, draft: { doc: '{}', at: 5 }, prefs: undefined } }]);
});
