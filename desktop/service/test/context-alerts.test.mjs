import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_TTL_MINUTES, IDLE_CACHE_MINUTES, IDLE_CACHE_MIN_TOKENS, compactCommand, idleCacheAlert } from '../context-alerts.mjs';

const minute = 60000;
const last = '2026-10-28T10:00:00.000Z';
const at = minutes => Date.parse(last) + minutes * minute;
const chat = (minutes, tokens = 150000, extra = {}) => ({ agent: 'claude', status: 'running', activity: 'idle', usage: { at: last, tokens: { current: tokens } }, now: at(minutes), ...extra });

test('compact is offered only by CLIs that ship /compact', () => {
  for (const agent of ['claude', 'codex', 'opencode', 'antigravity']) assert.equal(compactCommand(agent), '/compact');
  for (const agent of ['kimi', 'shell', 'unknown', undefined]) assert.equal(compactCommand(agent), null);
});

test('an idle Claude chat with a large context is alerted shortly before its cache expires', () => {
  assert.equal(IDLE_CACHE_MINUTES, 55); assert.equal(IDLE_CACHE_MIN_TOKENS, 100000); assert.equal(CACHE_TTL_MINUTES, 60);
  assert.equal(idleCacheAlert(chat(54.9)), null);
  assert.deepEqual(idleCacheAlert(chat(55)), { at: last, tokens: 150000, idleMinutes: 55, expiresInMinutes: 5 });
  assert.deepEqual(idleCacheAlert(chat(58.5)), { at: last, tokens: 150000, idleMinutes: 58, expiresInMinutes: 2 });
  // Once the cache has expired, compacting no longer makes the return cheaper.
  assert.equal(idleCacheAlert(chat(60)), null);
  assert.equal(idleCacheAlert(chat(180)), null);
});

test('the idle alert needs enough context, an idle running Claude chat and an undismissed idle period', () => {
  assert.equal(idleCacheAlert(chat(56, 99999)), null);
  assert.ok(idleCacheAlert(chat(56, 100000)));
  for (const activity of ['working', 'waiting']) assert.equal(idleCacheAlert(chat(56, 150000, { activity })), null);
  for (const status of ['starting', 'stopped', 'exited']) assert.equal(idleCacheAlert(chat(56, 150000, { status })), null);
  for (const agent of ['codex', 'antigravity', 'opencode']) assert.equal(idleCacheAlert(chat(56, 150000, { agent })), null);
  assert.equal(idleCacheAlert(chat(56, 150000, { usage: null })), null);
  assert.equal(idleCacheAlert(chat(56, 150000, { usage: { at: null, tokens: { current: 150000 } } })), null);
  assert.equal(idleCacheAlert(chat(56, 150000, { usage: { at: 'not a date', tokens: { current: 150000 } } })), null);
  // Dismissing or compacting hides this idle period only; the next one alerts again.
  assert.equal(idleCacheAlert(chat(56, 150000, { dismissed: last })), null);
  assert.ok(idleCacheAlert(chat(56, 150000, { dismissed: '2026-10-28T08:00:00.000Z' })));
});

test('the idle alert follows the settings and is off at 0 minutes', () => {
  assert.equal(idleCacheAlert(chat(40, 150000, { minutes: 45 })), null);
  assert.ok(idleCacheAlert(chat(45, 150000, { minutes: 45 })));
  assert.equal(idleCacheAlert(chat(56, 150000, { minTokens: 200000 })), null);
  assert.ok(idleCacheAlert(chat(56, 60000, { minTokens: 50000 })));
  assert.equal(idleCacheAlert(chat(56, 150000, { minutes: 0 })), null);
  assert.equal(idleCacheAlert(chat(59, 150000, { minutes: 60 })), null);
});
