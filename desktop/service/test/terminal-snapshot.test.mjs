import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import headless from '@xterm/headless';
import { TerminalSnapshotAddon } from '../terminal-snapshot.mjs';
import { Sessions } from '../sessions.mjs';

const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));
const create = () => {
  const terminal = new headless.Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const snapshot = new TerminalSnapshotAddon(); terminal.loadAddon(snapshot);
  return { terminal, snapshot };
};

test('fullscreen snapshot preserves SGR encoding, tracking and alternate screen across repeated restores', async () => {
  let current = create();
  try {
    await write(current.terminal, '\x1b[?1049h\x1b[?1003;10');
    await write(current.terminal, '06hClaude transcript');
    for (let i = 0; i < 3; i++) {
      const data = current.snapshot.serialize({ scrollback: 1500 });
      assert.ok(data.endsWith('\x1b[?1006h'));
      current.terminal.dispose(); current = create();
      await write(current.terminal, data);
      assert.equal(current.terminal.buffer.active.type, 'alternate');
      assert.equal(current.terminal.modes.mouseTrackingMode, 'any');
      assert.equal(current.terminal.buffer.active.getLine(0).translateToString(true), 'Claude transcript');
    }
  } finally { current.terminal.dispose(); }
});

test('mouse encoding follows resets, parameter order and pixel mode without parsing OSC text as a mode', async () => {
  const { terminal, snapshot } = create();
  try {
    for (const [data, expected] of [
      ['\x1b[?1006;1016h', 1016], ['\x1b[?1016;1006h', 1006],
      ['\x1b[?1003l', 1006], ['\x1b[?1006l', 0],
      ['\x1b]0;Title: [ ?1006h\x07', 0], ['\x1b[?1006h\x1bc', 0],
      ['\x1b[?1016h\x1b[?1016l', 0],
    ]) {
      await write(terminal, data);
      assert.equal(snapshot.serialize().endsWith(expected ? `\x1b[?${expected}h` : '\x1b[?1016l'), true);
    }
    await write(terminal, '\x1b[?1006h');
    assert.doesNotMatch(snapshot.serialize({ excludeModes: true }), /\x1b\[\?10(?:06|16)[hl]/);
  } finally { terminal.dispose(); }
});

test('a subscriber receives all retained scrollback, not only the last 1500 lines', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'iaar-scrollback-'));
  const sessions = await new Sessions(repo, path.join(repo, 'state')).init();
  const copy = new headless.Terminal({ cols: 80, rows: 24, scrollback: 5000, allowProposedApi: true });
  try {
    const session = sessions.make({ id: 'long-chat', agent: 'codex', name: 'Long chat', open: true, cols: 80, rows: 24 });
    sessions.items.set(session.id, session); await sessions.hydrate(session);
    await write(session.terminal, Array.from({ length: 2600 }, (_, line) => `Line ${line + 1}\r\n`).join(''));
    // The phone re-subscribes whenever it returns; it must get what the desktop holds.
    await write(copy, (await sessions.snapshot(session.id)).data);
    const buffer = copy.buffer.active, lines = [];
    for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index).translateToString(true));
    assert.ok(lines.includes('Line 1') && lines.includes('Line 2600'));
  } finally { copy.dispose(); await sessions.close(); }
});

test('saved session screens retain the fullscreen mouse protocol after service reload', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'iaar-snapshot-'));
  const state = path.join(repo, 'state');
  let sessions = await new Sessions(repo, state).init();
  try {
    const session = sessions.make({ id: 'claude-sgr', agent: 'claude', name: 'Fullscreen', open: true, cols: 80, rows: 24 });
    sessions.items.set(session.id, session); await sessions.hydrate(session);
    await write(session.terminal, '\x1b[?1049h\x1b[?1003;1006hRestored conversation');
    assert.ok((await sessions.snapshot(session.id)).data.endsWith('\x1b[?1006h'));
    await sessions.persist();
    const saved = JSON.parse(await readFile(path.join(state, 'screen-claude-sgr.json'), 'utf8'));
    assert.ok(saved.data.endsWith('\x1b[?1006h'));
    await sessions.close(); sessions = await new Sessions(repo, state).init();
    const restored = await sessions.snapshot('claude-sgr');
    assert.ok(restored.data.endsWith('\x1b[?1006h'));
    assert.equal(sessions.get('claude-sgr').terminal.buffer.active.type, 'alternate');
  } finally { await sessions.close(); }
});
