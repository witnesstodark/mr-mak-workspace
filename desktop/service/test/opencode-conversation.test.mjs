import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readOpencodeSession } from '../opencode-history.mjs';
import { ConversationTranscripts } from '../mobile-transcript.mjs';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32)]);
const inlinePng = `data:image/png;base64,${png.toString('base64')}`;
const current = 'ses_mrmakFixtureCurrent', legacy = 'ses_mrmakFixtureLegacy';

// The tables and columns Mr. Mak reads, as OpenCode 1.x and 2.x create them.
const schema = ['session', 'session_v2'].map(table => `create table ${table} (id text primary key, project_id text not null, directory text not null, version text not null, time_created integer not null, time_updated integer not null, revert text);`).join('\n') + `
create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null);
create index message_session_time_created_id_idx on message (session_id, time_created, id);
create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null);
create index part_message_id_id_idx on part (message_id, id);
create index part_session_idx on part (session_id);
create table session_message (id text primary key, session_id text not null, type text not null, seq integer not null, time_created integer not null, time_updated integer not null, data text not null);
create unique index session_message_session_seq_idx on session_message (session_id, seq);`;

const addSession = (db, table, item) => db.prepare(`insert into ${table} (id, project_id, directory, version, time_created, time_updated, revert) values (?, 'prj_fixture', ?, ?, ?, ?, ?)`)
  .run(item.id, item.directory, item.version, item.time_created, item.time_updated, item.revert ? JSON.stringify(item.revert) : null);
const addRow = (db, session, row, updated = row.time_created) => db.prepare('insert into session_message (id, session_id, type, seq, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?, ?)')
  .run(row.id, session, row.type, row.seq, row.time_created, updated, JSON.stringify(row.data));

// A store like OpenCode's: WAL journal, with OpenCode's own connection left open.
async function openCodeStore(t, name = 'opencode.db') {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const home = await mkdtemp(path.join(root, '.cache', 'opencode-store-'));
  const folder = path.join(home, 'data', 'opencode');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(home, 'shot.png'), png);
  const text = await readFile(new URL('./fixtures/opencode-store.json', import.meta.url), 'utf8');
  const fixture = JSON.parse(text.replaceAll('{{folderUrl}}', pathToFileURL(home).href));
  const db = new DatabaseSync(path.join(folder, name));
  db.exec('pragma journal_mode = wal');
  db.exec(schema);
  addSession(db, 'session_v2', fixture.v2.session);
  for (const row of fixture.v2.messages) addRow(db, current, row);
  addSession(db, 'session', fixture.v1.session);
  for (const message of fixture.v1.messages) {
    db.prepare('insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)').run(message.id, legacy, message.time_created, message.time_created, JSON.stringify(message.data));
    for (const part of message.parts) db.prepare('insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)').run(part.id, message.id, legacy, message.time_created, message.time_created, JSON.stringify(part.data));
  }
  const prior = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(home, 'data');
  t.after(() => { db.close(); if (prior === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prior; });
  return { home, db, fixture };
}

const shown = value => value.messages.map(item => [item.role, item.text]);

test('OpenCode 2.x Conversation shows its stored text, images, tool calls and notices; reasoning and tool output stay hidden', async t => {
  const { db, fixture } = await openCodeStore(t);
  const transcripts = new ConversationTranscripts(), session = { id: 'chat-current', agent: 'opencode', nativeId: current, cwd: root };
  const first = await transcripts.read(session);
  assert.equal(first.supported, true);
  assert.deepEqual(shown(first), [
    ['user', 'Fix the collision bug in player.ts'],
    ['assistant', 'Fixed the collision check in `player.ts`.'],
    ['system', 'The previous response was interrupted. Continue from where you left off.'],
    ['system', 'OpenCode error: Quota exceeded for this API key.'],
    ['system', 'Conversation compacted · summary of earlier messages'],
    ['user', 'Now add a regression test.'],
  ]);
  assert.deepEqual(first.messages.map(item => item.id), ['msg_c002', 'msg_c003', 'msg_c004', 'msg_c005-error', 'msg_c007', 'msg_c009']);
  assert.equal(first.messages[0].at, new Date(1792900001000).toISOString());
  assert.deepEqual(first.messages[0].imageRefs, [inlinePng]);
  assert.deepEqual(first.messages[1].imageRefs, [inlinePng], 'an image a tool returned is shown with the reply');
  assert.equal(first.messages[2].event.kind, 'notice');
  assert.match(first.messages[3].event.detail, /Retry later/);
  assert.equal(first.messages[4].event.detail, 'Earlier: the collision check in player.ts was fixed.');
  const everything = JSON.stringify(first);
  for (const hidden of ['PRIVATE_REASONING_SENTINEL', 'TOOL_OUTPUT_SENTINEL', 'Project instructions loaded']) assert.equal(everything.includes(hidden), false, hidden);
  assert.deepEqual(first.activity.map(({ id, name, status }) => [id, name, status]), [['call_read', 'read', 'completed'], ['call_test', 'bash', 'failed'], ['call_write', 'write', 'running']]);
  assert.equal(first.model, 'anthropic/claude-sonnet-4-5');
  assert.equal(first.effort, null, 'the default variant is not an effort');
  assert.equal(first.userMessages, 2);
  assert.equal(first.truncated, false);

  assert.equal(await transcripts.read(session), first, 'an unchanged chat is not read again');
  addRow(db, current, { id: 'msg_c011', type: 'assistant', seq: 11, time_created: 1792900011000, data: { time: { created: 1792900011000 }, model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' }, content: [{ type: 'text', text: 'Added `player.test.ts`.' }] } });
  assert.deepEqual(shown(await transcripts.read(session)).at(-1), ['assistant', 'Added `player.test.ts`.']);
  const limited = await readOpencodeSession(current, undefined, { budget: 1 });
  assert.equal(limited.truncated, true);
  assert.deepEqual(limited.records.map(item => item.uuid), ['msg_c011'], 'a long chat keeps its newest records');

  // /undo back to before the compaction hides what followed, as OpenCode does.
  db.prepare('update session_v2 set revert = ?, time_updated = ? where id = ?').run(JSON.stringify({ messageID: 'msg_c007' }), fixture.v2.session.time_updated + 5000, current);
  const reverted = await transcripts.read(session);
  assert.deepEqual(reverted.messages.map(item => item.id), ['msg_c002', 'msg_c003', 'msg_c004', 'msg_c005-error']);
  assert.equal(reverted.model, 'openai/gpt-5.1-codex');
  assert.equal(reverted.effort, 'high');
  assert.deepEqual(reverted.activity.map(item => item.id), ['call_read', 'call_test']);
});

test('OpenCode 1.x Conversation reads message parts; the 2.x copy of the session is used only once it is newer', async t => {
  const { db, home, fixture } = await openCodeStore(t);
  const transcripts = new ConversationTranscripts(), session = { id: 'chat-legacy', agent: 'opencode', nativeId: legacy, cwd: home };
  const expected = [
    ['user', 'Where is the spawn point set?'],
    ['assistant', 'The spawn point is set in `level.ts` line 12.'],
    ['system', 'Conversation compacted · summary of earlier messages'],
    ['user', 'Move it two tiles left.'],
  ];
  const value = await transcripts.read(session);
  assert.deepEqual(shown(value), expected, 'synthetic attachment text, reasoning and an interruption are not shown');
  assert.deepEqual(value.messages[0].imageRefs, [path.join(home, 'shot.png')]);
  assert.equal(value.messages[2].event.detail, 'Earlier: the spawn point lives in level.ts.');
  assert.deepEqual(value.activity.map(({ id, name, status }) => [id, name, status]), [['call_grep', 'grep', 'completed']]);
  assert.equal(value.model, 'ollama/gpt-oss:20b');
  assert.equal(value.effort, null);
  assert.equal(JSON.stringify(value).includes('SENTINEL'), false);

  // OpenCode 2.x copied the session when it first opened the store; 1.x kept writing its own tables.
  addSession(db, 'session_v2', fixture.v1.session);
  addRow(db, legacy, { id: 'msg_l001', type: 'user', seq: 1, time_created: 1792800001000, data: { time: { created: 1792800001000 }, text: 'Where is the spawn point set?', files: [] } }, 1792800001000);
  assert.deepEqual(shown(await transcripts.read(session)), expected);
  addRow(db, legacy, { id: 'msg_m001', type: 'assistant', seq: 2, time_created: 1792800020000, data: { time: { created: 1792800020000 }, model: { id: 'gpt-oss:20b', providerID: 'ollama' }, content: [{ type: 'text', text: 'Continued in OpenCode 2.' }] } });
  assert.deepEqual(shown(await transcripts.read(session)), [['user', 'Where is the spawn point set?'], ['assistant', 'Continued in OpenCode 2.']]);
});

test('OpenCode Conversation finds a release-channel store and needs a valid stored session', async t => {
  await openCodeStore(t, 'opencode-beta.db');
  assert.deepEqual((await readOpencodeSession(current)).records.find(item => item.role === 'user')?.text, 'Fix the collision bug in player.ts');
  assert.equal(await readOpencodeSession('ses_mrmakMissing'), null);
  assert.equal(await readOpencodeSession('../opencode.db'), null);
  const transcripts = new ConversationTranscripts();
  assert.deepEqual(await transcripts.read({ id: 'new-chat', agent: 'opencode', nativeId: null, cwd: root }), { supported: false, messages: [] });
  assert.deepEqual(await transcripts.read({ id: 'missing', agent: 'opencode', nativeId: 'ses_mrmakMissing', cwd: root }), { supported: false, messages: [] });
});

test('desktop Conversation and its stats serve an OpenCode chat with granted images', { timeout: 30000 }, async t => {
  const { home } = await openCodeStore(t);
  await mkdir(path.join(home, 'ui')); await writeFile(path.join(home, 'ui', 'index.html'), '<html></html>');
  await mkdir(path.join(home, 'workspace')); await writeFile(path.join(home, 'workspace', 'workspace.json'), '{"entities":[]}');
  const service = await createService({ repo: home, uiDir: path.join(home, 'ui') });
  t.after(() => service.close());
  const request = (route, data) => fetch(service.origin + '/api' + route, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const chat = await (await request('/history/import', { agent: 'opencode', nativeId: legacy, name: 'Spawn point', cwd: home })).json();
  const transcript = await (await request(`/sessions/${chat.id}/messages`)).json();
  assert.equal(transcript.supported, true);
  assert.equal(transcript.messages[0].text, 'Where is the spawn point set?');
  const media = await fetch(service.origin + transcript.messages[0].images[0].url);
  assert.equal(media.status, 200); assert.equal(media.headers.get('content-type'), 'image/png');
  assert.deepEqual(await (await request(`/sessions/${chat.id}/stats`)).json(), { supported: true, userMessages: 2, truncated: false, model: 'ollama/gpt-oss:20b', effort: null, usage: null, handoff: null });
});
