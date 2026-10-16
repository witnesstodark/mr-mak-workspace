// Explicit live test of answering Claude's terminal-only questions and plan
// approvals from the phone (claude-prompts.mjs). It starts short Claude Code
// chats with Haiku on your own subscription, so it never runs in the test suite.
// node test-claude-prompts.mjs --allow-claude <trusted folder for the chats>
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Sessions } from './sessions.mjs';
import { MobileGateway } from './mobile.mjs';
import { claudeTranscript } from './native-events.mjs';
import { sleep } from './util.mjs';

if (!process.argv.includes('--allow-claude')) throw new Error('Pass --allow-claude to run short Claude Code chats (Haiku) for this test.');
const folder = path.resolve(process.argv.slice(2).find(item => !item.startsWith('--')) || process.cwd());
process.env.ANTHROPIC_MODEL ||= 'haiku';
const sessions = await new Sessions(folder, await mkdtemp(path.join(os.tmpdir(), 'mrmak-prompts-'))).init();
const gateway = Object.assign(Object.create(MobileGateway.prototype), { sessions, answering: new Set() });

async function until(check, what, timeout = 150000) {
  const end = Date.now() + timeout;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`); await sleep(250); }
}
async function start(name, text, { plan = false } = {}) {
  const session = sessions.get((await sessions.create({ agent: 'claude', name, cwd: folder })).id);
  await until(async () => /shift\+tab to cycle/.test(await sessions.screen(session.id)), 'Claude to start', 60000);
  while (plan && !/plan mode on/.test(await sessions.screen(session.id))) { sessions.input(session.id, '\x1b[Z'); await sleep(700); }
  sessions.input(session.id, `\x1b[200~${text}\x1b[201~`); await sleep(500); sessions.input(session.id, '\r');
  return session;
}
async function asked(session, previous) {
  await until(() => session.asking && session.asking.id !== previous, 'the question');
  return until(async () => { const prompt = await gateway.prompt(session); return prompt?.onScreen && prompt; }, 'the question on screen', 20000);
}
async function result(session, id) {
  const file = await claudeTranscript(session.cwd, session.nativeId);
  return until(async () => {
    for (const line of (await readFile(file, 'utf8').catch(() => '')).split('\n')) {
      try { for (const part of JSON.parse(line).message?.content || []) if (part.type === 'tool_result' && part.tool_use_id === id) return JSON.stringify(part.content); } catch { /* Partial line. */ }
    }
    return null;
  }, 'the answer in the transcript', 30000);
}
async function stop(session) { await sessions.remove(session.id).catch(() => {}); }

const checks = [];
try {
  // Two questions, one of them multi-select with a typed extra answer; the picker ends on its review.
  let session = await start('Two questions', 'Call the AskUserQuestion tool right now with exactly two questions. Question 1: "Which pet?", header "Pet", multiSelect false, options Dragon, Owl, Moose. Question 2: "Which snacks?", header "Snacks", multiSelect true, options Bread, Cheese, Fish. Give each option a one-line description. After the answers, reply with one short sentence.');
  let prompt = await asked(session);
  assert.equal(prompt.kind, 'question'); assert.equal(prompt.questions.length, 2); assert.equal(session.activity, 'waiting');
  await assert.rejects(gateway.answer(session, { id: prompt.id, answers: [{ options: ['Owl', 'Moose'] }, { options: ['Bread'] }] }), /Choose one answer/);
  await gateway.answer(session, { id: prompt.id, answers: [{ options: ['Owl'] }, { options: ['Bread', 'Fish'], other: 'pickled herring 2' }] });
  let text = await result(session, prompt.id);
  assert.match(text, /Which pet\?\\"=\\"Owl\\"/); assert.match(text, /Which snacks\?\\"=\\"Bread, Fish, pickled herring 2\\"/);
  await until(() => !session.asking, 'the question to clear', 10000);
  checks.push('two questions, multi-select and a typed extra answer'); await stop(session);

  // One question answered with typed text (spaces, digits and a comma).
  session = await start('Typed answer', 'Call the AskUserQuestion tool right now with one question: "Pick a colour?", header "Colour", multiSelect false, options Red, Green, Blue, each with a one-line description. After the answer, reply with one short sentence.');
  prompt = await asked(session);
  await gateway.answer(session, { id: prompt.id, answers: [{ options: [], other: 'Teal 2, or sea green' }] });
  text = await result(session, prompt.id);
  assert.match(text, /Pick a colour\?\\"=\\"Teal 2, or sea green\\"/);
  checks.push('one question with a typed answer'); await stop(session);

  // A plan sent back with changes, then approved.
  session = await start('Plan', 'Plan how to create hello.txt containing the word hi. Do not research or read anything. Immediately write a three-step plan to the plan file and call ExitPlanMode.', { plan: true });
  prompt = await asked(session);
  assert.equal(prompt.kind, 'plan'); assert.match(prompt.plan, /hello\.txt/);
  const change = prompt.choices.find(choice => choice.feedback), approve = prompt.choices.find(choice => !choice.feedback);
  assert.ok(change && approve, JSON.stringify(prompt.choices));
  await assert.rejects(gateway.answer(session, { id: prompt.id, choice: { number: approve.number, label: 'Something else' } }), /choices changed/);
  await gateway.answer(session, { id: prompt.id, choice: { number: change.number, label: change.label, text: 'Use the word hello instead, then call ExitPlanMode again.' } });
  assert.match(await result(session, prompt.id), /hello instead/);
  const first = prompt.id;
  prompt = await asked(session, first);
  assert.match(prompt.plan, /"hello"|`hello`|word hello/);
  await gateway.answer(session, { id: prompt.id, choice: { number: approve.number, label: approve.label } });
  assert.match(await result(session, prompt.id), /approved your plan/);
  checks.push('plan sent back with changes, then approved'); await stop(session);
  console.log(`CLAUDE PROMPTS TEST PASSED: ${checks.join('; ')}`);
} catch (error) {
  for (const session of sessions.list().filter(item => item.status === 'running')) console.log(`--- ${session.name} screen\n${await sessions.screen(session.id)}`);
  console.log(`Passed before the failure: ${checks.join('; ') || 'none'}`);
  throw error;
} finally {
  for (const session of sessions.list()) await sessions.remove(session.id).catch(() => {});
  await sessions.close();
}
