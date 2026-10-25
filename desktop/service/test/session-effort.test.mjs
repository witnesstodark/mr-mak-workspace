import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sessions } from '../sessions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('new and imported chats default to xhigh; explicit efforts survive saving and reopening', async () => {
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
        const wanted = effort || 'xhigh';
        assert.equal(created.effort, wanted);
        assert.equal(launches.at(-1), wanted);
        expected.set(created.id, wanted);
      }
      const imported = await sessions.importConversation({ agent, nativeId: '00000000-0000-0000-0000-000000000123', name: 'Imported Effort' });
      assert.equal(imported.effort, 'xhigh');
      expected.set(imported.id, 'xhigh');
    }
    for (const agent of ['shell', 'kimi', 'opencode', 'pi']) assert.equal(sessions.make({ agent }).effort, undefined);
    // Pi keeps its own thinking default unless a level is chosen, for example by the coordinator.
    assert.equal(sessions.make({ agent: 'pi', effort: 'high' }).effort, 'high');
  } finally { await sessions.close(); }
  const restored = await new Sessions(repo, stateDir).init();
  try {
    assert.equal(restored.list().length, expected.size);
    for (const session of restored.list()) assert.equal(session.effort, expected.get(session.id));
  } finally { await restored.close(); }
});
