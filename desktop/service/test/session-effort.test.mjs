import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sessions } from '../sessions.mjs';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('new and imported chats default to medium; explicit efforts survive saving and reopening', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'session-effort-'));
  const stateDir = path.join(repo, 'state');
  const sessions = await new Sessions(repo, stateDir).init();
  // Exercise creation and persistence without starting a paid CLI conversation.
  sessions.nativeBoundary = async () => undefined;
  const launches = [];
  sessions.launch = session => { launches.push(session.effort); };
  const expected = new Map();
  try {
    for (const agent of ['codex', 'claude', 'antigravity']) {
      for (const effort of [undefined, 'medium', 'high', 'xhigh', 'max']) {
        const created = await sessions.create({ agent, name: 'Terminal Effort', effort });
        const wanted = effort || 'medium';
        assert.equal(created.effort, wanted);
        assert.equal(launches.at(-1), wanted);
        expected.set(created.id, wanted);
      }
      const imported = await sessions.importConversation({ agent, nativeId: '00000000-0000-0000-0000-000000000123', name: 'Imported Effort' });
      assert.equal(imported.effort, 'medium');
      expected.set(imported.id, 'medium');
    }
    for (const agent of ['shell', 'kimi', 'opencode']) assert.equal(sessions.make({ agent }).effort, undefined);
  } finally { await sessions.close(); }
  const restored = await new Sessions(repo, stateDir).init();
  try {
    assert.equal(restored.list().length, expected.size);
    for (const session of restored.list()) assert.equal(session.effort, expected.get(session.id));
  } finally { await restored.close(); }
});

test('the chosen default effort applies to new desktop chats; an explicit effort still wins', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'default-effort-'));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const service = await createService({ repo, uiDir: repo, mcpOptions: { home: repo, env: {} } });
  const request = (route, data) => fetch(service.origin + '/api' + route, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const created = [];
  service.sessions.create = async options => {
    created.push(options);
    return service.sessions.make({ id: `fixture-${created.length}`, cwd: repo, open: false, status: 'closed', ...options });
  };
  try {
    await request('/sessions', { agent: 'claude' }); assert.equal(created.at(-1).effort, 'medium');
    assert.equal((await (await request('/settings', { defaultEffort: 'high' })).json()).defaultEffort, 'high');
    await request('/sessions', { agent: 'codex' }); assert.equal(created.at(-1).effort, 'high');
    await request('/sessions', { agent: 'codex', effort: 'max' }); assert.equal(created.at(-1).effort, 'max');
    assert.equal((await (await request('/settings', { defaultEffort: 'low' })).json()).defaultEffort, 'high');
  } finally { await service.close(); }
});
