import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioBridge, resolveFolder, CANCELLED } from '../../../src/desktop/studioBridge.ts';

// `answers` are the owner's choices in the Workspace confirmation, in order.
function fixture({ running = true, answers = [], menu = null } = {}) {
  const calls = [], asked = [];
  let clock = 0;
  const api = async (path, data) => {
    calls.push({ path, data });
    if (path === '/sessions') return { id: 'chat-1', agent: data.agent };
    if (path.endsWith('/screen')) return { status: running ? 'running' : 'exited', activity: 'idle', lastOutputAt: new Date(0).toISOString(), screen: 'line 1\nline 2' };
    if (path.endsWith('/messages')) return { supported: true, messages: [{ id: 'm1', role: 'user', text: 'x'.repeat(70000), at: '', imageRefs: ['a.png'] }], prompt: menu, btw: [] };
    if (path.endsWith('/prompt')) return { delivered: true };
    if (path.startsWith('/files')) return { entries: [{ name: 'Game', path: 'E:\\Repo\\projects\\Game', directory: true }, { name: 'notes.md', path: 'E:\\Repo\\projects\\notes.md', directory: false }] };
    return {};
  };
  const bridge = createStudioBridge({
    api,
    repo: () => 'E:\\Repo',
    agents: () => [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: false }, { id: 'shell', label: 'Shell', available: true }],
    confirm: async request => { asked.push(request); return answers.length ? answers.shift() : true; },
    sleep: async ms => { clock += ms; },
    now: () => clock + 100000,
  });
  const sent = () => calls.filter(c => c.path === '/sessions' || c.path.endsWith('/send') || c.path.endsWith('/prompt'));
  return { bridge, calls, asked, sent };
}

test('studio folders resolve inside the repository', () => {
  assert.equal(resolveFolder('projects/Sample Game', 'E:\\Repo'), 'E:\\Repo\\projects\\Sample Game');
  assert.equal(resolveFolder('', '/home/me/repo'), '/home/me/repo');
  assert.equal(resolveFolder('D:/Games', 'E:\\Repo'), 'D:/Games');
  assert.equal(resolveFolder('/srv/game', '/home/me/repo'), '/srv/game');
  assert.throws(() => resolveFolder('projects/../../etc', 'E:\\Repo'), /inside the repository/);
});

test('reads need no confirmation and stay trimmed', async () => {
  const { bridge, calls, asked } = fixture();
  const hello = await bridge.handle('hello', {});
  assert.deepEqual(hello.agents.map(a => a.id), ['claude', 'codex']);
  const list = await bridge.handle('list', { path: 'projects' });
  assert.deepEqual(list.entries, [{ name: 'Game', path: 'E:\\Repo\\projects\\Game' }]);
  assert.match(calls.find(c => c.path.startsWith('/files')).path, /E%3A%5CRepo%5Cprojects$/);
  await bridge.handle('state', {});
  await bridge.handle('start', { agent: 'claude' });
  asked.length = 0;
  const read = await bridge.handle('messages', { id: 'chat-1' });
  assert.equal(read.supported, true);
  assert.equal(read.activity, 'idle');
  assert.equal(read.messages[0].text.length, 60000);
  assert.equal(read.messages[0].imageRefs, undefined);
  assert.equal(read.screen, undefined);
  assert.equal(read.prompt, null);
  await bridge.handle('open', { id: 'chat-1' });
  assert.deepEqual(asked, [], 'reading and opening the studio chat ask nothing');
  await assert.rejects(bridge.handle('rm', {}), /Unknown studio request/);
});

test('starting a studio chat waits for the owner and never bypasses permissions', async () => {
  const { bridge, calls, asked, sent } = fixture({ answers: [false] });
  await assert.rejects(bridge.handle('start', { agent: 'shell' }), /Choose Claude/);
  await assert.rejects(bridge.handle('start', { agent: 'codex' }), /not installed/);
  await assert.rejects(bridge.handle('start', { agent: 'claude', effort: 'turbo' }), /Effort/);
  assert.deepEqual(asked, [], 'invalid requests are refused before asking');

  // Cancel: no chat is started.
  await assert.rejects(bridge.handle('start', { agent: 'claude', cwd: 'projects/Game', effort: 'high', name: 'UI Studio Game' }), new RegExp(CANCELLED.replace(/[.;]/g, '\\$&')));
  assert.deepEqual(sent(), []);
  assert.deepEqual(asked[0], { kind: 'start', agent: 'Claude', folder: 'E:\\Repo\\projects\\Game', effort: 'high', chat: 'UI Studio Game', text: null });

  const started = await bridge.handle('start', { agent: 'claude', cwd: 'projects/Game', effort: 'high', name: 'UI Studio Game', bypass: true });
  assert.deepEqual(started, { id: 'chat-1', agent: 'claude', reused: false, sent: false });
  assert.deepEqual(calls.find(c => c.path === '/sessions').data, { agent: 'claude', cwd: 'E:\\Repo\\projects\\Game', effort: 'high', name: 'UI Studio Game', bypass: false, background: true });

  // A running chat with the same agent, folder and effort is reused without asking.
  const before = asked.length;
  assert.equal((await bridge.handle('start', { agent: 'claude', cwd: 'projects/Game', effort: 'high' })).reused, true);
  assert.equal(asked.length, before);
  assert.equal(calls.filter(c => c.path === '/sessions').length, 1);
});

test('a first message is confirmed with the chat it starts, exactly as sent', async () => {
  const { bridge, asked, sent } = fixture();
  const result = await bridge.handle('start', { agent: 'claude', cwd: 'projects/Game', name: 'UI Studio Game', text: 'Add a Back button' });
  assert.deepEqual(result, { id: 'chat-1', agent: 'claude', reused: false, sent: true, before: ['m1'] });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].kind, 'start');
  assert.equal(asked[0].text, 'Add a Back button');
  assert.deepEqual(sent().map(c => c.path), ['/sessions', '/sessions/chat-1/send']);
  assert.deepEqual(sent()[1].data, { text: 'Add a Back button', effort: { action: 'keep' } });
  // Sending again to the reused chat asks again.
  await bridge.handle('start', { agent: 'claude', cwd: 'projects/Game', text: 'And a title' });
  assert.deepEqual(asked[1], { kind: 'send', agent: 'Claude', folder: 'E:\\Repo\\projects\\Game', chat: 'UI Studio Game', text: 'And a title' });
});

test('every message to the studio chat waits for the owner, and Cancel sends nothing', async () => {
  const { bridge, asked, sent } = fixture({ answers: [true, false, true] });
  await bridge.handle('start', { agent: 'claude', name: 'UI Studio' });
  await assert.rejects(bridge.handle('send', { id: 'someone-else', text: 'hi' }), /only reach chats it started/);
  await assert.rejects(bridge.handle('messages', { id: 'someone-else' }), /only reach chats it started/);
  await assert.rejects(bridge.handle('send', { id: 'chat-1', text: 'x'.repeat(64001) }), /Message is not valid/);

  await assert.rejects(bridge.handle('send', { id: 'chat-1', text: 'Remove the HUD' }), /nothing was sent/);
  assert.deepEqual(sent().map(c => c.path), ['/sessions']);
  assert.deepEqual(asked.at(-1), { kind: 'send', agent: 'Claude', folder: 'E:\\Repo', chat: 'UI Studio', text: 'Remove the HUD' });

  assert.deepEqual(await bridge.handle('send', { id: 'chat-1', text: 'Add a Back button' }), { sent: true });
  assert.deepEqual(sent().at(-1).data, { text: 'Add a Back button', effort: { action: 'keep' } });
});

test('a stopped studio chat is replaced instead of reused', async () => {
  const { bridge, calls } = fixture({ running: false });
  await assert.rejects(bridge.handle('start', { agent: 'claude' }), /stopped while starting/);
  assert.equal(calls.filter(c => c.path === '/sessions').length, 1);
  await assert.rejects(bridge.handle('start', { agent: 'claude' }), /stopped while starting/);
  assert.equal(calls.filter(c => c.path === '/sessions').length, 2, 'the stopped chat is not reused');
});

test('the studio answers the menu of its own chat only, after the owner confirms the option on screen', async () => {
  const menu = { id: 'ticket-1', kind: 'single', question: 'Allow copying the art?', detail: ['cp a b', 7], options: ['Yes', 'No', 'Type something.'], selected: 0, input: 2, extra: 'dropped' };
  const { bridge, asked, calls } = fixture({ menu, answers: [true, true, false, true, true] });
  await bridge.handle('start', { agent: 'claude', name: 'UI Studio' });

  const read = await bridge.handle('messages', { id: 'chat-1' });
  assert.deepEqual(read.prompt, { id: 'ticket-1', kind: 'single', question: 'Allow copying the art?', detail: ['cp a b', '7'], options: ['Yes', 'No', 'Type something.'], selected: 0, input: 2 });

  await bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: 1 });
  assert.deepEqual(asked.at(-1), { kind: 'answer', agent: 'Claude', folder: 'E:\\Repo', chat: 'UI Studio', question: 'Allow copying the art?', answer: 'No' });
  await assert.rejects(bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: 0 }), /nothing was sent/);
  await bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: { text: 'Copy only the icons', extra: 1 } });
  assert.equal(asked.at(-1).answer, 'Copy only the icons');
  await bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: { checked: [0, 2] } });
  assert.equal(asked.at(-1).answer, 'Yes, Type something.');
  assert.deepEqual(calls.filter(c => c.path.endsWith('/prompt')).map(c => c.data), [
    { id: 'ticket-1', choice: 1 },
    { id: 'ticket-1', choice: { text: 'Copy only the icons' } },
    { id: 'ticket-1', choice: { checked: [0, 2] } },
  ]);
  const count = asked.length;
  await assert.rejects(bridge.handle('answer', { id: 'someone-else', prompt: 'ticket-1', choice: 0 }), /only reach chats it started/);
  await assert.rejects(bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: 'yes' }), /listed options/);
  await assert.rejects(bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: 9 }), /listed options/);
  await assert.rejects(bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-1', choice: { text: '  ' } }), /listed options/);
  await assert.rejects(bridge.handle('answer', { id: 'chat-1', prompt: 'ticket-old', choice: 0 }), /no longer open/);
  assert.equal(asked.length, count, 'nothing is asked for a request that cannot be sent');
});

test('the studio state goes to the service store', async () => {
  const calls = [];
  const api = async (path, data) => { calls.push({ path, data }); return data ? { draftAt: 5 } : { projects: null, draft: null, prefs: null }; };
  const bridge = createStudioBridge({ api, repo: () => 'E:\\Repo', agents: () => [], confirm: async () => assert.fail('state needs no confirmation') });
  assert.deepEqual(await bridge.handle('state', {}), { projects: null, draft: null, prefs: null });
  const projects = { roots: ['projects'], hidden: ['projects/old-game'] };
  await bridge.handle('save-state', { projects, draft: { doc: '{}', at: 5 }, other: 1 });
  assert.deepEqual(calls, [{ path: '/ui-studio/state', data: undefined }, { path: '/ui-studio/state', data: { projects, draft: { doc: '{}', at: 5 }, prefs: undefined } }]);
});
