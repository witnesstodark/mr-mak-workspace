import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { codexSegments, codexTranscript, findCodexChat, newerCodexRollout } from '../codex-history.mjs';
import { ConversationTranscripts, transcriptText } from '../mobile-transcript.mjs';

const cwd = path.resolve('test-project');
const now = new Date(2026, 9, 16, 12).getTime();
const chat = { id: 'chat-a', cwd, createdAt: new Date(now).toISOString(), startedAt: now };
const line = record => JSON.stringify(record) + '\n';
const meta = (id, extra = {}) => line({ type: 'session_meta', payload: { id, cwd, source: 'cli', originator: `mrmak_chat_${chat.id}`, thread_source: 'user', ...extra } });
const message = (kind, text) => line({ type: 'event_msg', payload: { type: 'item_completed', item: { type: kind, id: randomUUID(), content: [{ type: kind === 'UserMessage' ? 'text' : 'Text', text }] } } });

// One thread rewound once (to before its second message), then /new in the same terminal.
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mrmak-codex-threads-'));
  const folder = path.join(home, 'sessions', '2026', '10', '16');
  await mkdir(folder, { recursive: true });
  const id = randomUUID(), segment = randomUUID(), next = randomUUID();
  const kept = meta(id) + message('UserMessage', 'one') + message('AgentMessage', '1');
  const base = path.join(folder, `rollout-2026-10-16T10-00-00-${id}.jsonl`);
  await writeFile(base, kept + message('UserMessage', 'two') + message('AgentMessage', '2'));
  const fork = path.join(folder, `rollout-2026-10-16T10-01-00-${id}_${segment}.jsonl`);
  await writeFile(fork, meta(id, { history_base: { thread_id: id, end_ordinal_exclusive: 3, end_byte_offset: Buffer.byteLength(kept) } }) + message('UserMessage', 'three') + message('AgentMessage', '3'));
  return { home, folder, id, base, fork, next };
}

test('A rewound Codex thread reads as one conversation across its rollout segments', async () => {
  const { home, id, base, fork } = await fixture();
  assert.deepEqual(await codexSegments(id, { home }), [base, fork]);
  assert.equal(await codexTranscript(id, { home }), fork);
  // The rewind's segments are one thread, not two candidates.
  assert.equal((await findCodexChat(chat, { home, now })).file, fork);

  const prior = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    const value = await new ConversationTranscripts().read({ id: 'chat', agent: 'codex', nativeId: id, cwd });
    assert.deepEqual(value.messages.map(item => item.text), ['one', '1', 'three', '3']);
    assert.equal(value.truncated, false);
  } finally { if (prior === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prior; }
  // The 4 MB window still applies across segments.
  const cut = await transcriptText([base, fork], 400);
  assert.ok(cut.truncated && !cut.text.includes('"one"') && cut.text.includes('"three"'));
});

test('A Codex terminal follows its newest rollout: a rewind segment or a thread from /new', async () => {
  const { home, folder, base, fork, next } = await fixture();
  assert.equal((await newerCodexRollout(chat, base, { home, now })).file, fork);
  assert.equal(await newerCodexRollout(chat, fork, { home, now }), null);
  // A subagent thread or another chat's thread is never followed.
  await writeFile(path.join(folder, `rollout-2026-10-16T10-02-00-${randomUUID()}.jsonl`), meta(randomUUID(), { source: { subagent: { parent_thread_id: 'x' } } }));
  await writeFile(path.join(folder, `rollout-2026-10-16T10-03-00-${randomUUID()}.jsonl`), meta(randomUUID(), { originator: 'mrmak_chat_other' }));
  assert.equal(await newerCodexRollout(chat, fork, { home, now }), null);
  const started = path.join(folder, `rollout-2026-10-16T10-04-00-${next}.jsonl`);
  await writeFile(started, meta(next));
  const found = await newerCodexRollout(chat, fork, { home, now });
  assert.deepEqual([found.id, found.file], [next, started]);
});
