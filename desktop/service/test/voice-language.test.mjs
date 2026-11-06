import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { voiceSession, defaultVoiceStyle } from '../voice-profile.mjs';
import { QuickActions } from '../quick-actions.mjs';

test('voice session keeps the English default even with a custom delivery style', () => {
  for (const settings of [{}, { voiceStyle: 'Warm, calm and brisk.' }]) {
    const session = voiceSession(settings);
    assert.match(session.instructions, /Language: Speak English by default/);
    assert.match(session.instructions, /only when the user explicitly asks/);
    assert.doesNotMatch(session.instructions, /russian|[\u0400-\u04ff]/iu);
  }
  assert.match(defaultVoiceStyle, /Speak English by default/);
});

test('quick command confirmations and empty results are English without a model', async () => {
  await mkdir(path.resolve('.cache'), { recursive: true });
  const stateDir = await mkdtemp(path.resolve('.cache/english-actions-'));
  const card = { id: 'review', title: 'Animation Review' };
  const calls = [];
  let chats = [{ id: 'animation', name: 'Animation Work', attention: true }];
  const actions = await new QuickActions({ stateDir,
    workspace: { list: async () => [card], activity: async date => ({ cards: date === '2026-09-10' ? [card] : [] }) },
    context: () => ({ route: '#/review', chats }),
    execute: async (name, args) => { calls.push({ name, args }); return { name: args.name || 'Animation Work' }; },
    completed: () => {},
  }).init();
  const commands = ['open card Animation Review', 'archive this card', 'unarchive this card',
    'mark this card done', 'pin this card', 'unpin this card', 'open chat Animation Work',
    'close chat Animation Work', 'open workspace', 'list chats', 'list cards',
    'what work on 2026-09-10', 'what work on 2026-09-11', 'create codex chat named "Character Review"', 'create opencode chat named "Scene Review"'];
  for (const [index, text] of commands.entries()) {
    const result = await actions.ask({ id: String(index), text });
    assert.equal(result?.status, 'completed', text);
    assert.doesNotMatch(result.result, /[\u0400-\u04ff]/u, text);
    assert.ok(result.result.length > 5);
  }
  chats = [];
  assert.equal((await actions.ask({ id: 'empty', text: 'list chats' })).result, 'There are no open chats.');
  assert.ok(calls.some(call => call.name === 'open_chat' && call.args.effort === 'xhigh'));
  assert.ok(calls.some(call => call.name === 'open_chat' && call.args.agent === 'opencode' && call.args.name === 'Scene Review'));
});
