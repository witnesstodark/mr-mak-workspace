import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { antigravityContext, claudeContextWindow, nativeContext, unknownContext, opencodeContext } from '../native-context.mjs';
import { watchAntigravityContext } from '../antigravity.mjs';
import { tailNativeFile } from '../native-events.mjs';
import { Sessions } from '../sessions.mjs';
import { createObserver } from '../opencode/observer.mjs';
import { opencodeStatePath, watchOpencode } from '../opencode.mjs';

const count = (used = 30000, limit = 200000) => ({ type: 'event_msg', timestamp: '2026-10-23T12:00:00Z', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: used }, total_token_usage: { total_tokens: 9000000 }, model_context_window: limit } } });
const line = record => JSON.stringify(record) + '\n';
// Protobuf wire encoding of agy's generation metadata, only the fields read.
const varint = n => { const out = []; do { let byte = n % 128; n = Math.floor(n / 128); if (n) byte |= 0x80; out.push(byte); } while (n); return out; };
const pb = (...fields) => Buffer.concat(fields.map(([number, value]) => typeof value === 'number' ? Buffer.from([...varint(number * 8), ...varint(value)]) : Buffer.concat([Buffer.from([...varint(number * 8 + 2), ...varint(value.length)]), value])));
const generation = (used, limit = 256000) => pb([4, Buffer.from('execution')], [1, pb([19, Buffer.from('gemini-3.8-flash')], [9, pb([10, pb([1, used], [4, limit])])])]);
const until = async check => { for (let n = 0; n < 100; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('Context update timed out'); };

test('Codex uses active context, never cumulative usage or rate limits', () => {
  const usage = nativeContext(count(), 'codex').usage;
  assert.equal(usage.usedTokens, 30000); assert.equal(usage.limitTokens, 200000);
  const record = count(); delete record.payload.info.last_token_usage;
  assert.equal(nativeContext(record, 'codex').usage.usedTokens, null);
  for (const value of [-1, '300', NaN, Infinity, undefined]) {
    const invalid = count(); invalid.payload.info.last_token_usage.total_tokens = value;
    assert.equal(nativeContext(invalid, 'codex').usage.usedTokens, null);
  }
  assert.equal(nativeContext(count(0, 0), 'codex').usage.usedTokens, 0);
  assert.equal(nativeContext(count(0, 0), 'codex').usage.limitTokens, null);
  assert.equal(nativeContext({ type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { used_percent: 80 } } }, 'codex').usage.usedTokens, null);
});

test('Claude reports latest input including cache and the window of the answering model', () => {
  const record = { type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: 20000, cache_creation_input_tokens: 1000, output_tokens: 900 } } };
  assert.equal(nativeContext(record, 'claude').usage.usedTokens, 21010);
  assert.equal(nativeContext(record, 'claude').usage.limitTokens, null);
  assert.equal(nativeContext({ ...record, isSidechain: true }, 'claude'), null);
  assert.equal(nativeContext({ ...record, isCompactSummary: true }, 'claude'), null);
  assert.equal(nativeContext({ type: 'assistant', message: { usage: { input_tokens: 4 } } }, 'claude').usage.usedTokens, null);
  assert.equal(nativeContext({ type: 'user' }, 'claude'), null);
  assert.equal(nativeContext({ type: 'system', subtype: 'compact_boundary' }, 'claude').usage.reason, 'compacted');
  const answered = model => nativeContext({ ...record, message: { ...record.message, model } }, 'claude').usage;
  assert.equal(answered('claude-opus-5-5').limitTokens, 1000000);
  assert.equal(answered('claude-haiku-4-5-20251001').limitTokens, 200000);
  assert.equal(answered('glm-4.6').limitTokens, null);
  assert.equal(nativeContext({ ...record, message: { model: '<synthetic>', usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }, 'claude'), null);
  const large = { type: 'assistant', message: { model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 10, cache_read_input_tokens: 300000, cache_creation_input_tokens: 0 } } };
  assert.equal(nativeContext(large, 'claude').usage.limitTokens, null, 'a count above the table window drops the window');
});

test('Claude windows follow the model table, including dated and provider IDs', () => {
  for (const [model, window] of [['claude-opus-5-5', 1000000], ['claude-fable-5-1', 1000000], ['claude-sonnet-5-5', 1000000], ['claude-haiku-5-5', 1000000], ['us.anthropic.claude-opus-4-6-v1', 1000000], ['claude-sonnet-4-6', 1000000],
    ['claude-opus-4-1-20250805', 200000], ['claude-sonnet-4-20250514', 200000], ['claude-sonnet-4-5-20250929', 200000], ['claude-haiku-4-5', 200000], ['claude-3-5-sonnet-20241022', 200000], ['gpt-5', null], [undefined, null]]) assert.equal(claudeContextWindow(model), window, model);
});

test('Antigravity reads the CLI context window metadata and rejects other data', () => {
  const usage = antigravityContext(generation(20464));
  assert.deepEqual([usage.usedTokens, usage.limitTokens, usage.source, usage.reason], [20464, 256000, 'antigravity', 'waiting']);
  assert.equal(antigravityContext(generation(20464, 0)).limitTokens, null);
  for (const data of [pb([1, pb([19, Buffer.from('gemini')])]), Buffer.from([0x0a, 0x05, 0x01]), Buffer.from([0xff, 0xff, 0xff]), null, 'text']) assert.equal(antigravityContext(data), null);
});

test('Antigravity follows the latest generation of the bound conversation without replaying it', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mak-agy-context-'));
  const file = id => path.join(folder, `${id}.db`);
  const conversation = id => { const db = new DatabaseSync(file(id)); db.exec('PRAGMA journal_mode = WAL; CREATE TABLE gen_metadata (idx integer PRIMARY KEY, data blob, size integer NOT NULL DEFAULT 0)'); return db; };
  const insert = (db, idx, used) => db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(idx, generation(used));
  const first = randomUUID(), second = randomUUID();
  const db = conversation(first), other = conversation(second);
  let bound = first;
  insert(db, 0, 19000); insert(db, 1, 20000);
  const events = [];
  const stop = watchAntigravityContext(() => bound, usage => events.push(usage), { file });
  try {
    await until(() => events.length); assert.deepEqual([events[0].usedTokens, events[0].limitTokens], [20000, 256000]);
    insert(db, 2, 21000); await until(() => events.at(-1).usedTokens === 21000);
    db.prepare('DELETE FROM gen_metadata WHERE idx = 2').run(); await until(() => events.at(-1).usedTokens === 20000);
    const seen = events.length; await new Promise(resolve => setTimeout(resolve, 1300));
    assert.equal(events.length, seen, 'an unchanged latest generation is not reported again');
    bound = second; insert(other, 0, 500); await until(() => events.at(-1).usedTokens === 500);
  } finally { stop(); db.close(); other.close(); }
});

test('OpenCode uses native message context fields and rejects incomplete counts', () => {
  assert.equal(opencodeContext({ tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 20 } } }).usedTokens, 137);
  assert.equal(opencodeContext({ tokens: { input: 10 } }).usedTokens, null);
});

test('OpenCode observer keeps child and compact-summary tokens out of the parent context', () => {
  const states = [];
  const send = createObserver({ nativeId: 'ses_parent', chatId: 'a', launchId: 'launch', save: state => states.push(state) });
  const message = (sessionID, extra = {}) => ({ type: 'message.updated', properties: { info: { sessionID, role: 'assistant', time: { completed: 10 }, tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 20 } }, ...extra } } });
  send(message('ses_child')); assert.equal(states.length, 0);
  send(message('ses_parent')); assert.equal(states.at(-1).contextUsage.usedTokens, 137);
  send({ type: 'session.compacted', properties: { sessionID: 'ses_parent' } });
  assert.equal(states.at(-1).contextUsage.usedTokens, null);
  send(message('ses_parent', { summary: true }));
  assert.equal(states.at(-1).contextUsage.reason, 'compacted');
  send(message('ses_parent')); assert.equal(states.at(-1).contextUsage.usedTokens, 137);
});

test('OpenCode activity updates cannot restore a context snapshot cleared by input', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mak-opencode-context-'));
  const updates = [], session = { id: 'a', nativeId: 'ses_parent' };
  const state = { chatId: 'a', nativeId: session.nativeId, launchId: 'launch', revision: 1, contextRevision: 1, contextUsage: opencodeContext({ tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 20 } } }) };
  await writeFile(opencodeStatePath(folder, session.id), JSON.stringify(state));
  const stop = watchOpencode(folder, session, 'launch', value => updates.push(value));
  try {
    await until(() => updates.length === 1);
    assert.equal(updates[0].contextUsage.usedTokens, 137);
    await writeFile(opencodeStatePath(folder, session.id), JSON.stringify({ ...state, revision: 2, activity: 'working' }));
    await until(() => updates.length === 2);
    assert.equal(updates[1].contextUsage, undefined);
    await writeFile(opencodeStatePath(folder, session.id), JSON.stringify({ ...state, revision: 3, contextRevision: 3 }));
    await until(() => updates.length === 3);
    assert.equal(updates[2].contextUsage.usedTokens, 137);
  } finally { stop(); }
});

test('resume loads context at boundary without replaying activity; compact and truncation clear it', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mak-context-'));
  const file = path.join(folder, 'native.jsonl');
  const history = line(count()) + line({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'old' } });
  await writeFile(file, history);
  const events = [];
  const stop = tailNativeFile(file, 'codex', event => events.push(event), Buffer.byteLength(history));
  try {
    await until(() => events.length); assert.deepEqual(events.map(event => event.kind), ['context-usage']);
    assert.equal(events.at(-1).usage.usedTokens, 30000);
    await appendFile(file, line({ type: 'compacted', payload: {} }));
    await until(() => events.at(-1).usage?.reason === 'compacted');
    assert.equal(events.at(-1).usage.usedTokens, null);
    await appendFile(file, line(count(5000)));
    await until(() => events.at(-1).usage?.usedTokens === 5000);
    await writeFile(file, line({ type: 'session_meta', payload: { id: 'replacement' } }));
    await until(() => events.at(-1).usage?.usedTokens === null);
    assert.equal(events.at(-1).usage.limitTokens, null);
  } finally { stop(); }
});

test('context stays per session, broadcasts without activity, and saved values are not trusted', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mak-context-sessions-'));
  const sessions = await new Sessions(folder, folder).init();
  const a = sessions.make({ id: 'a', agent: 'codex' }), b = sessions.make({ id: 'b', agent: 'claude' });
  sessions.items.set(a.id, a); sessions.items.set(b.id, b);
  const events = []; sessions.on('session', session => events.push(session));
  try {
    sessions.nativeEvent(a, nativeContext(count(), 'codex'));
    assert.equal(sessions.list().find(s => s.id === 'a').contextUsage.usedTokens, 30000);
    assert.equal(sessions.list().find(s => s.id === 'b').contextUsage.usedTokens, null);
    assert.equal(a.activity, 'idle'); assert.equal(a.unread, false); assert.equal(a.hasConversation, undefined);
    assert.equal(events.at(-1).contextUsage.usedTokens, 30000);
    a.process = { write() {} };
    sessions.input('a', '/clear\r');
    assert.equal(a.contextUsage.usedTokens, null);
    a.process = null;
    sessions.nativeEvent(a, nativeContext(count(), 'codex'));
    sessions.nativeEvent(a, nativeContext({ type: 'event_msg', payload: { type: 'context_compacted' } }, 'codex'));
    assert.equal(a.contextUsage.usedTokens, null);
    assert.deepEqual(sessions.make({ id: 'new', agent: 'codex', contextUsage: { usedTokens: 123 } }).contextUsage, unknownContext('codex'));
    assert.equal(sessions.make({ agent: 'kimi' }).contextUsage.reason, 'unavailable');
    assert.equal(sessions.make({ agent: 'antigravity' }).contextUsage.reason, 'waiting');
  } finally { await sessions.close(); }
});
