import test from 'node:test';
import assert from 'node:assert/strict';
import { messageLabel, rewindList, rewindToMessage, sameLabel } from '../message-edit.mjs';
import { activeBranch, transcriptMessages } from '../mobile-transcript.mjs';

test('Claude transcripts show only the branch that a rewind left current', () => {
  const records = [
    { type: 'user', uuid: 'u1', parentUuid: null, message: { content: 'First' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { id: 'm1', content: [{ type: 'text', text: 'One' }] } },
    { type: 'user', uuid: 'u2', parentUuid: 'a1', message: { content: 'Old wording' } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u2', message: { id: 'm2', content: [{ type: 'text', text: 'Old reply' }] } },
    { type: 'mode', mode: 'normal' },
    { type: 'user', uuid: 'u3', parentUuid: 'a1', message: { content: 'New wording' } },
    // Parallel tool calls branch too; their results stay.
    { type: 'assistant', uuid: 't1', parentUuid: 'u3', message: { id: 'm3', content: [{ type: 'tool_use', id: 'x', name: 'Read' }] } },
    { type: 'assistant', uuid: 't2', parentUuid: 't1', message: { id: 'm3', content: [{ type: 'tool_use', id: 'y', name: 'Read' }] } },
    { type: 'user', uuid: 'r1', parentUuid: 't1', message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] } },
    { type: 'user', uuid: 'r2', parentUuid: 't1', message: { content: [{ type: 'tool_result', tool_use_id: 'y' }] } },
    { type: 'assistant', uuid: 'a3', parentUuid: 'r2', message: { id: 'm4', content: [{ type: 'text', text: 'New reply' }] } },
  ];
  assert.deepEqual(transcriptMessages(records, 'claude').map(item => item.text), ['First', 'One', 'New wording', 'New reply']);
  assert.deepEqual(activeBranch(records).filter(item => item.uuid).map(item => item.uuid), ['u1', 'a1', 'u3', 't1', 't2', 'r1', 'r2', 'a3']);
  // Rewinding to the first message replaces it too.
  assert.deepEqual(activeBranch([{ type: 'user', uuid: 'p1', parentUuid: null, message: { content: 'A' } }, { type: 'user', uuid: 'p2', parentUuid: null, message: { content: 'B' } }]).map(item => item.uuid), ['p2']);
});

test('Rewind list labels match a message by its first line, even when cut', () => {
  assert.equal(messageLabel('\n  Fix the   tabs\nand more'), 'Fix the tabs');
  assert.ok(sameLabel('Fix the ta…', 'Fix the tabs'));
  assert.ok(!sameLabel('Fix the tabs', 'Fix the'));
  assert.ok(!sameLabel('…', 'Anything'));
  const screen = '❯ earlier prompt\n   Rewind\n   Restore the code and/or conversation to the point before…\n   ❯ Fix the tabs\n     No code changes\n   (current)\n   Enter to continue · Esc to cancel';
  assert.equal(rewindList(screen).selected, 'Fix the tabs');
  assert.equal(rewindList('❯ Fix the tabs'), null);
});

// A stand-in for Claude Code's terminal: Esc Esc opens the rewind list, Enter
// confirms, the chosen option restores, and Esc Esc clears the restored input.
function fakeClaude(labels) {
  const state = { mode: 'idle', escapes: 0, selected: labels.length, option: 0, restored: null, keys: [] };
  const options = ['Restore conversation', 'Summarize from here', 'Never mind'];
  const screen = () => {
    if (state.mode === 'list') return ['   Rewind', '   Restore the code and/or conversation to the point before…',
      ...[...labels, '(current)'].flatMap((label, index) => [`   ${index === state.selected ? '❯ ' : '  '}${label}`, '     No code changes']), '   Enter to continue · Esc to cancel'].join('\n');
    if (state.mode === 'confirm') return ['   Rewind', '   Confirm you want to restore to the point before you sent this message:', ...options.map((label, index) => `   ${index === state.option ? '❯' : ' '} ${index + 1}. ${label}`)].join('\n');
    return state.mode === 'prefilled' ? `❯ ${labels[state.restored]}` : '❯ ';
  };
  const sessions = {
    get: () => ({ agent: 'claude', process: {}, activity: 'idle' }),
    read: async () => ({ screen: screen() }),
    keys: (_id, data) => {
      state.keys.push(data);
      if (data === '\x1b') {
        if (state.mode === 'list' || state.mode === 'confirm') { state.mode = 'idle'; return; }
        if (++state.escapes < 2) return;
        state.escapes = 0;
        if (state.mode === 'prefilled') state.mode = 'idle';
        else { state.mode = 'list'; state.selected = labels.length; }
        return;
      }
      if (state.mode === 'list' && data === '\x1b[A') state.selected = Math.max(0, state.selected - 1);
      else if (state.mode === 'list' && data === '\r') { state.mode = 'confirm'; state.option = 0; }
      else if (state.mode === 'confirm' && data === '\x1b[B') state.option++;
      else if (state.mode === 'confirm' && data === '\r') { if (options[state.option] === 'Restore conversation') state.restored = state.selected; state.mode = 'prefilled'; }
    },
  };
  return { state, sessions };
}

test('Editing a message rewinds Claude Code to that message and clears the restored input', async () => {
  const { state, sessions } = fakeClaude(['Same question', 'Second question', 'Same question']);
  const messages = [
    { id: 'u1', role: 'user', text: 'Same question\nwith details' }, { id: 'a1', role: 'assistant', text: 'Reply' },
    { id: 'u2', role: 'user', text: 'Second question' }, { id: 'u3', role: 'user', text: 'Same question' },
  ];
  const transcripts = { read: async () => ({ messages }) };
  assert.deepEqual(await rewindToMessage(sessions, transcripts, 'chat', 'u1'), { rewound: true });
  // The earlier of two messages with the same first line was chosen.
  assert.equal(state.restored, 0);
  assert.equal(state.mode, 'idle');

  await assert.rejects(rewindToMessage(sessions, transcripts, 'chat', 'gone'), error => error.status === 409);
  await assert.rejects(rewindToMessage({ ...sessions, get: () => ({ agent: 'codex', process: {} }) }, transcripts, 'chat', 'u1'), /Claude Code chats/);
  await assert.rejects(rewindToMessage({ ...sessions, get: () => ({ agent: 'claude', process: {}, activity: 'working' }) }, transcripts, 'chat', 'u1'), error => error.status === 409);
});

test('A message missing from the rewind list closes the list and reports it', async () => {
  const { state, sessions } = fakeClaude(['Something else']);
  const transcripts = { read: async () => ({ messages: [{ id: 'u1', role: 'user', text: 'Not shown' }] }) };
  await assert.rejects(rewindToMessage(sessions, transcripts, 'chat', 'u1'), /not found in the rewind list/);
  assert.equal(state.mode, 'idle');
  assert.equal(state.restored, null);
});
