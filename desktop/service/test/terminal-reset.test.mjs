import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sessions } from '../sessions.mjs';
import { sleep } from '../util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stamp = { createdAt: '2026-10-17T08:00:00Z', updatedAt: '2026-10-17T08:00:00Z', cols: 80, rows: 24, tabOrder: 0, pinned: false, tabColor: null };
async function fixture(screens = {}) {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'terminal-reset-'));
  const state = path.join(repo, '.mrmak');
  await mkdir(state);
  for (const [id, data] of Object.entries(screens)) await writeFile(path.join(state, `screen-${id}.json`), JSON.stringify({ data }));
  const sessions = await new Sessions(repo, state).init();
  return { repo, sessions };
}
const fakeProcess = record => ({ write: data => record.writes.push(data), kill: () => { record.killed = true; }, onExit: () => ({ dispose() {} }), resize() {} });

test('a restarted chat starts on a clean terminal: the killed CLI\'s alternate screen and mouse capture are gone', async () => {
  // The saved screen of a fullscreen CLI that was stopped without restoring the terminal.
  const { repo, sessions } = await fixture({ t1: 'history line one\r\nhistory line two\r\n\x1b[?1049h\x1b[2J\x1b[H\x1b[?1002;1003;1006h\x1b[?2004h\x1b[?1004hfullscreen frame' });
  try {
    const session = sessions.make({ ...stamp, id: 't1', name: 'Fullscreen', agent: 'claude', cwd: repo, open: false, status: 'stopped' });
    sessions.items.set('t1', session);
    await sessions.hydrate(session);
    const before = session.serializer.serialize({ scrollback: 100 });
    assert.equal(session.terminal.buffer.active.type, 'alternate');
    assert.match(before, /\x1b\[\?1049h/);
    assert.match(before, /\x1b\[\?1003h/);
    assert.match(before, /\x1b\[\?1006h$/, 'the SGR encoding is kept for a live fullscreen CLI');

    const outputs = [];
    sessions.on('output', event => outputs.push(event));
    sessions.resetTerminal(session);
    await new Promise(resolve => session.terminal.write('', resolve));
    assert.equal(session.terminal.buffer.active.type, 'normal');
    const after = session.serializer.serialize({ scrollback: 100 });
    assert.doesNotMatch(after, /\x1b\[\?(1049|1000|1002|1003|1006|1016)h/);
    assert.match(after, /history line two/, 'the normal buffer and its scrollback are back');
    await sleep(60);
    assert.equal(outputs.length, 1, 'attached renderers receive the same reset as live output');
    assert.equal(outputs[0].id, 't1');
    assert.equal(outputs[0].sequence, 1);
    assert.match(outputs[0].data, /\x1b\[\?1049l/);
    assert.match(outputs[0].data, /\x1b\[\?1003l/);
    assert.match(outputs[0].data, /\x1b\[\?25h/);

    // A clean terminal is left alone apart from the same harmless reset.
    sessions.resetTerminal(session);
    await new Promise(resolve => session.terminal.write('', resolve));
    assert.equal(session.terminal.buffer.active.type, 'normal');
    assert.match(session.serializer.serialize({ scrollback: 100 }), /history line two/);
  } finally { await sessions.close(); }
});

test('closing a Claude chat asks it to exit before the hard stop; a shell is stopped at once', async () => {
  const { repo, sessions } = await fixture();
  try {
    const claude = { writes: [], killed: false }, shell = { writes: [], killed: false };
    const chat = sessions.make({ ...stamp, id: 'c1', name: 'Claude', agent: 'claude', cwd: repo, open: true, status: 'running' });
    const terminal = sessions.make({ ...stamp, id: 's1', name: 'Shell', agent: 'shell', cwd: repo, open: true, status: 'running' });
    chat.process = fakeProcess(claude); terminal.process = fakeProcess(shell);
    sessions.items.set('c1', chat); sessions.items.set('s1', terminal);

    sessions.requestStop(terminal);
    assert.deepEqual(shell, { writes: [], killed: true });

    sessions.requestStop(chat);
    assert.deepEqual(claude.writes, ['\x03']);
    assert.equal(claude.killed, false);
    await sleep(700);
    assert.deepEqual(claude.writes, ['\x03', '\x03'], 'a second Ctrl+C exits an idle CLI');
    assert.equal(claude.killed, false);
    await sleep(3100);
    assert.equal(claude.killed, true, 'an unresponsive CLI is still stopped within a few seconds');
    chat.process = null; terminal.process = null;
  } finally { await sessions.close(); }
});
