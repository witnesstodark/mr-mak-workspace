import test from 'node:test';
import assert from 'node:assert/strict';
import { EffortAdvisor, parseAdvice } from '../effort-advice.mjs';

const claude = { id: 'c1', agent: 'claude' };
function advisor({ mode = 'ask', answer = '{"level":"low","why":"a quick rewrite"}', effort = 'xhigh', result = {} } = {}) {
  const calls = { ask: 0, choose: [] };
  const value = new EffortAdvisor({
    stateDir: '.', sessions: {}, mode: () => mode,
    transcripts: { read: async () => ({ supported: false, effort, messages: [{ role: 'assistant', text: 'Done.' }] }) },
    ask: async () => { calls.ask += 1; return answer; },
    choose: async (sessions, stateDir, id, choice) => { calls.choose.push({ id, ...choice }); return { applied: true, effort: 'applied', ...result }; },
  });
  return { value, calls };
}

test('parseAdvice reads the level and a clean reason, and refuses keep', () => {
  assert.deepEqual(parseAdvice('ok {"level":"Extra high","why":"critical handoff — no questions."}'), { level: 'xhigh', why: 'critical handoff, no questions' });
  assert.equal(parseAdvice('{"level":"keep","why":"approval"}'), null);
  assert.equal(parseAdvice('no json'), null);
});

test('ask mode holds a message whose level differs, with the current level', async () => {
  const { value, calls } = advisor();
  const { advice } = await value.check(claude, 'make this friendlier');
  assert.equal(advice.level, 'low');
  assert.equal(advice.from, 'xhigh');
  assert.match(advice.message, /Low effort task: a quick rewrite/);
  assert.equal(calls.choose.length, 0);
});

test('the answer to an offer switches without asking the model again', async () => {
  const { value, calls } = advisor();
  assert.deepEqual(await value.check(claude, 'make this friendlier', { choice: { action: 'switch', level: 'low' } }), {});
  assert.deepEqual(await value.check(claude, 'make this friendlier', { choice: { action: 'keep', level: 'low' } }), {});
  assert.equal(calls.ask, 0);
  assert.deepEqual(calls.choose, [{ id: 'c1', effort: 'low' }]);
});

test('auto mode switches by itself; the phone in ask mode sends as it is', async () => {
  const auto = advisor({ mode: 'auto' });
  assert.deepEqual(await auto.value.check(claude, 'make this friendlier'), {});
  assert.deepEqual(auto.calls.choose, [{ id: 'c1', effort: 'low' }]);
  const phone = advisor();
  assert.deepEqual(await phone.value.check(claude, 'make this friendlier', { interactive: false }), {});
  assert.equal(phone.calls.choose.length, 0);
});

test('off, other agents, slash commands, the same level and a failed check send as they are', async () => {
  for (const [options, session, text] of [[{ mode: 'off' }, claude, 'hi'], [{}, { id: 'x', agent: 'codex' }, 'hi'], [{}, claude, '/compact'], [{ effort: 'low' }, claude, 'hi'], [{ answer: 'nonsense' }, claude, 'hi']]) {
    const { value, calls } = advisor(options);
    assert.deepEqual(await value.check(session, text), {});
    assert.equal(calls.choose.length, 0);
  }
  const failing = new EffortAdvisor({ stateDir: '.', sessions: {}, mode: () => 'ask', transcripts: { read: async () => ({ supported: false, messages: [] }) }, ask: async () => { throw new Error('offline'); } });
  assert.deepEqual(await failing.check(claude, 'hi'), {});
});

test('a question opened by the switch stops the message', async () => {
  const { value } = advisor({ mode: 'auto', result: { effort: 'prompt' } });
  await assert.rejects(value.check(claude, 'make this friendlier'), /asking about the effort switch/);
});
