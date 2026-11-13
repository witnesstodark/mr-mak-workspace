import test from 'node:test';
import assert from 'node:assert/strict';
import { assetMessage, chooseChat, findItem, handleAssetRequest, parseAssetRequest, projectFolder, CANCELLED } from '../../../src/desktop/assetBridge.ts';

const repo = 'E:\\Repo';
const card = { id: 'game', title: 'Sample Game', folder: 'sample-game', project: 'projects/Sample Game' };
const chat = (id, cwd, extra = {}) => ({ id, name: `Chat ${id}`, agent: 'claude', cwd, status: 'running', open: true, createdAt: '2026-11-01T00:00:00Z', lastInputAt: null, ...extra });
const library = { items: [{ id: 'hero', name: 'Hero', category: 'characters', family: 'heroes', status: 'review', version: 3, thumbnail: 'media/hero-v03.png', original: 'Art/Hero.psd', prompt: 'A brave hero', generation: { provider: 'fal', job: 'job-9', model: 'flux', date: '2026-11-02', cost: 4 } }] };

// `answers` are the owner's choices in the Workspace confirmation, in order.
function fixture({ sessions = [chat('a', 'E:\\Repo\\projects\\Sample Game'), chat('b', 'E:\\Repo\\projects\\Other Game')], selected = 'b', answers = [true], data = library, close = false } = {}) {
  const calls = [], asked = [], reads = [];
  let current = sessions;
  const deps = {
    api: async (path, body) => { calls.push({ path, body }); return {}; },
    read: async relative => { reads.push(relative); return typeof data === 'string' ? data : JSON.stringify(data); },
    repo: () => repo,
    sessions: () => current,
    selectedId: () => selected,
    agentLabel: agent => agent === 'claude' ? 'Claude' : agent,
    confirm: async view => { asked.push(view); if (close) current = []; return answers.shift() ?? false; },
  };
  return { deps, calls, asked, reads };
}

test('requests name an action and an item id only', () => {
  assert.deepEqual(parseAssetRequest({ type: 'mrmak:asset-request', action: 'send', item: 'hero', repositorio: 'C:\\Elsewhere' }), { action: 'send', item: 'hero' });
  for (const bad of [{ action: 'delete', item: 'hero' }, { action: 'send', item: '../hero' }, { action: 'send', item: 'Hero' }, { action: 'send' }, null]) assert.throws(() => parseAssetRequest(bad));
});

test('the project comes from the card in workspace.json', () => {
  assert.equal(projectFolder(card, repo), 'E:\\Repo\\projects\\Sample Game');
  assert.equal(projectFolder({ ...card, project: 'D:\\Games\\Ship\\' }, repo), 'D:\\Games\\Ship');
  assert.throws(() => projectFolder({ ...card, project: '../outside' }, repo), /inside the repository/);
  assert.throws(() => projectFolder({ ...card, project: undefined }, repo), /names no project in workspace\.json/);
});

test('the chat is the selected one when it works in the project, else the project\'s latest', () => {
  const folder = 'E:\\Repo\\projects\\Sample Game';
  const sessions = [
    chat('old', `${folder}\\src`, { lastInputAt: '2026-11-02T00:00:00Z' }),
    chat('new', folder, { lastInputAt: '2026-11-03T00:00:00Z' }),
    chat('shell', folder, { agent: 'shell', lastInputAt: '2026-11-09T00:00:00Z' }),
    chat('closed', folder, { open: false, lastInputAt: '2026-11-09T00:00:00Z' }),
    chat('stopped', folder, { status: 'exited', lastInputAt: '2026-11-09T00:00:00Z' }),
    chat('near', `${folder} 2`, { lastInputAt: '2026-11-09T00:00:00Z' }),
  ];
  assert.equal(chooseChat(sessions, 'old', folder).id, 'old');
  assert.equal(chooseChat(sessions, 'near', folder).id, 'new');
  assert.throws(() => chooseChat(sessions.slice(2), null, folder), /Open a chat in/);
});

test('the item is read from assets.json and checked again', () => {
  assert.equal(findItem(JSON.stringify(library), 'hero').name, 'Hero');
  assert.throws(() => findItem(JSON.stringify(library), 'ghost'), /no item "ghost"/);
  assert.throws(() => findItem('{', 'hero'), /not valid JSON/);
  assert.throws(() => findItem(JSON.stringify({ items: [{ ...library.items[0], thumbnail: '../../secret.png' }] }), 'hero'), /not valid/);
  assert.throws(() => findItem(JSON.stringify({ items: [{ ...library.items[0], name: 'x'.repeat(201) }] }), 'hero'), /not valid/);
});

test('the message lists the item with absolute paths', () => {
  const item = findItem(JSON.stringify(library), 'hero');
  const send = assetMessage({ action: 'send', item, card, repo });
  assert.equal(send, [
    'Workspace asset from Sample Game: "Hero" (id hero, v03, characters/heroes, review).',
    'Original: Art/Hero.psd',
    'Preview: E:\\Repo\\workspace\\sample-game\\media\\hero-v03.png',
    'Prompt: A brave hero',
    'Generation: fal job job-9, model flux, 2026-11-02, cost 4 credits.',
    'Asset library: E:\\Repo\\workspace\\sample-game\\assets.json',
    'This is the asset I am pointing you to. Wait for my instructions about it.',
  ].join('\n'));
  const variation = assetMessage({ action: 'variation', item, card, repo });
  assert.match(variation, /ask me before spending credits/);
  assert.match(variation, /node "E:\\Repo\\workspace\\_shared\\asset-library\\build\.mjs" "E:\\Repo\\workspace\\sample-game"/);
});

test('a confirmed request sends the shown text to the project\'s chat, not the frame\'s choice', async () => {
  const { deps, calls, asked, reads } = fixture();
  let waited = false;
  const result = await handleAssetRequest(deps, card, { action: 'send', item: 'hero', project: 'projects/Other Game', repositorio: 'E:\\Repo\\projects\\Other Game' }, () => { waited = true; });
  assert.equal(waited, true);
  assert.deepEqual(reads, ['workspace/sample-game/assets.json']);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].facts.find(fact => fact.label === 'Chat').value, 'Chat a');
  assert.equal(asked[0].facts.find(fact => fact.label === 'Project').value, 'E:\\Repo\\projects\\Sample Game');
  assert.deepEqual(calls.map(call => call.path), ['/sessions/a/send', '/sessions/a/focus']);
  assert.equal(calls[0].body.text, asked[0].text);
  assert.equal(result.text, 'Sent to the chat Chat a.');
});

test('Cancel sends nothing', async () => {
  const { deps, calls, asked } = fixture({ answers: [false] });
  await assert.rejects(handleAssetRequest(deps, card, { action: 'variation', item: 'hero' }), new RegExp(CANCELLED));
  assert.equal(asked.length, 1);
  assert.deepEqual(calls, []);
});

test('nothing is asked or sent without a project, a library item or a chat', async () => {
  for (const [options, owner, request, expected] of [
    [{}, { ...card, project: '' }, { action: 'send', item: 'hero' }, /names no project/],
    [{}, { ...card, folder: '../elsewhere' }, { action: 'send', item: 'hero' }, /folder is not valid/],
    [{}, card, { action: 'send', item: 'ghost' }, /no item "ghost"/],
    [{ sessions: [chat('b', 'E:\\Repo\\projects\\Other Game')] }, card, { action: 'send', item: 'hero' }, /Open a chat in E:\\Repo\\projects\\Sample Game first/],
  ]) {
    const { deps, calls, asked } = fixture(options);
    await assert.rejects(handleAssetRequest(deps, owner, request), expected);
    assert.equal(asked.length, 0);
    assert.deepEqual(calls, []);
  }
});

test('a chat that closed during the confirmation receives nothing', async () => {
  const { deps, calls } = fixture({ close: true });
  await assert.rejects(handleAssetRequest(deps, card, { action: 'send', item: 'hero' }), /no longer running/);
  assert.deepEqual(calls, []);
});
