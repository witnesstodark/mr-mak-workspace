import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeSessions, promptPreview, sessionRail, sessionSummary } from '../claude-sessions.mjs';
import { ConversationTranscripts } from '../mobile-transcript.mjs';

const lines = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const context = '\n\n<mrmak_workspace_context>\nThis is the current Workspace where we are working.\n{"version":1,"workspace":null}\n</mrmak_workspace_context>';

test('a session is summarized from its first and last records', () => {
  const head = [
    { type: 'user', isMeta: true, message: { content: 'Caveat' } },
    { type: 'user', message: { content: '<command-name>/model</command-name>' } },
    { type: 'user', uuid: 'u1', message: { content: `Build the session rail${context}` } },
    { type: 'ai-title', aiTitle: 'Old generated title' },
  ];
  const tail = [
    { type: 'ai-title', aiTitle: 'Session rail for Claude chats' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { type: 'user', uuid: 'u9', message: { content: 'Now add tests' } },
    { type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 80000, cache_creation_input_tokens: 2000, output_tokens: 500 } } },
    { type: 'assistant', isSidechain: true, message: { usage: { input_tokens: 1 } } },
  ];
  assert.deepEqual(sessionSummary(head, tail), { title: 'Session rail for Claude chats', firstPrompt: 'Build the session rail', lastPrompt: 'Now add tests', contextTokens: 82510, model: 'claude-opus-5-5' });
  assert.equal(sessionSummary(head, [...tail, { type: 'custom-title', customTitle: 'My rail' }]).title, 'My rail');
  assert.equal(sessionSummary([{ type: 'user', message: { content: 'Only a prompt' } }], []).title, 'Only a prompt');
  assert.equal(sessionSummary([], []).title, 'Untitled conversation');
  assert.equal(promptPreview(`Fix it${context}`), 'Fix it');
});

test('the rail lists a folder\'s conversations with the chats that hold them', async () => {
  const config = await mkdtemp(path.join(os.tmpdir(), 'mrmak-rail-')), cwd = path.resolve('rail-project');
  const folder = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(folder, { recursive: true });
  const old = path.join(folder, 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), current = path.join(folder, 'bbbbbbbb-0000-4000-8000-000000000002.jsonl');
  await writeFile(old, lines([{ type: 'user', uuid: 'o1', timestamp: '2026-10-01T10:00:00Z', message: { content: 'Plan the menus' } }, { type: 'ai-title', aiTitle: 'Correção dos menus' }]));
  await writeFile(current, lines([
    { type: 'user', uuid: 'p1', timestamp: '2026-10-02T10:00:00Z', message: { content: 'First prompt' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-10-02T10:00:05Z', message: { id: 'm1', content: [{ type: 'text', text: 'Done.' }] } },
    { type: 'user', uuid: 'p2', timestamp: '2026-10-02T10:01:00Z', message: { content: `Second prompt${context}` } },
  ]));
  await writeFile(path.join(folder, 'notes.txt'), 'not a transcript');
  await utimes(old, new Date('2026-10-01T10:00:00Z'), new Date('2026-10-01T10:00:00Z'));
  const prior = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  try {
    const session = { id: 'chat', agent: 'claude', cwd, nativeId: 'bbbbbbbb-0000-4000-8000-000000000002' };
    const chats = [{ id: 'other', agent: 'claude', nativeId: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Menu plan', open: false, status: 'stopped', activity: 'idle' }, { id: 'chat', agent: 'claude', ...session, name: 'Rail', open: true, status: 'running', activity: 'working' }];
    const rail = await sessionRail(session, chats, new ClaudeSessions(), new ConversationTranscripts());
    assert.equal(rail.total, 2);
    assert.deepEqual(rail.sessions.map(({ id, title, importName, current, chat }) => ({ id, title, importName, current, chat: chat?.id })), [
      { id: session.nativeId, title: 'First prompt', importName: 'First prompt', current: true, chat: 'chat' },
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Correção dos menus', importName: 'Correcao dos menus', current: false, chat: 'other' },
    ]);
    assert.equal(rail.sessions[0].lastPrompt, 'Second prompt');
    assert.deepEqual(rail.prompts.map(({ id, text, shown }) => ({ id, text, shown })), [{ id: 'p1', text: 'First prompt', shown: true }, { id: 'p2', text: 'Second prompt', shown: true }]);
    await assert.rejects(sessionRail({ ...session, agent: 'codex' }, chats, new ClaudeSessions(), new ConversationTranscripts()), /Claude Code chats/);
    // A folder Claude Code never used has no conversations.
    assert.deepEqual((await new ClaudeSessions().list(path.resolve('never-used'))).sessions, []);
  } finally { if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prior; }
});
