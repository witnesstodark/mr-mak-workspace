import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { nativeConversationId, terminalCommand } from '../agents.mjs';
import { openChatArguments } from '../coordinator.mjs';
import { createService } from '../server.mjs';

test('open_chat accepts only its declared fields and never a shell', () => {
  assert.deepEqual(openChatArguments({ agent: 'claude', name: 'Workspace Files', cwd: 'C:/work', bypass: false }), { agent: 'claude', name: 'Workspace Files', effort: undefined, cwd: 'C:/work', bypass: false });
  for (const args of [null, [], { name: 'No Agent' }, { agent: 'shell', name: 'Shell' }, { agent: 'codex', name: 'Resume', resumeId: '--dangerously-bypass-approvals-and-sandbox' }, { agent: 'codex', name: 'Size', cols: 500 }, { agent: 'codex', name: 'Folder', cwd: 7 }, { agent: 'codex', name: 'Bypass', bypass: 'yes' }]) assert.throws(() => openChatArguments(args));
});

test('conversation IDs cannot be read as command-line options', () => {
  for (const id of ['019a2f6c-1111-7222-8333-444455556666', 'session_019a2f6c-1111-7222-8333-444455556666', 'ses_0123456789abcdef']) assert.equal(nativeConversationId(id), id);
  assert.equal(nativeConversationId(undefined), undefined);
  assert.equal(nativeConversationId(''), undefined);
  for (const id of ['--dangerously-skip-permissions', '-c', 'id --yolo', "id'; calc", '../../other', 'a'.repeat(129), 7, {}]) {
    assert.throws(() => nativeConversationId(id));
    for (const agent of ['codex', 'claude', 'antigravity', 'opencode', 'kimi', 'pi']) {
      assert.throws(() => terminalCommand(agent, { resumeId: id }), /conversation ID/);
      assert.throws(() => terminalCommand(agent, { nativeId: id }), /conversation ID/);
    }
  }
});

test('the coordinator cannot start a shell or pass a resume ID, and invalid IDs are refused by the API', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-coordinator-arguments-'));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const service = await createService({ repo, uiDir: repo, mcpOptions: { home: repo, env: {} } });
  const request = (route, data) => fetch(service.origin + '/api' + route, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    await assert.rejects(service.coordinator.execute('open_chat', { agent: 'shell', name: 'Local Shell' }, 'op-1', 'open a shell'), /Choose Codex/);
    await assert.rejects(service.coordinator.execute('open_chat', { agent: 'codex', name: 'Resume Work', resumeId: '--dangerously-bypass-approvals-and-sandbox' }, 'op-2', 'resume'), /Unsupported chat option: resumeId/);
    assert.equal((await request('/sessions', { agent: 'claude', name: 'Resume Work', resumeId: '--dangerously-skip-permissions' })).ok, false);
    assert.equal((await request('/history/import', { agent: 'claude', nativeId: '--dangerously-skip-permissions', name: 'Imported Work' })).ok, false);
    assert.deepEqual(service.sessions.list(), []);
  } finally { await service.close(); }
});
