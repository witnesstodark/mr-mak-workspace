import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { findCodexChat, readCodexMetadata, codexTranscript } from '../codex-history.mjs';
import { Sessions } from '../sessions.mjs';
import { claudeTranscript } from '../native-events.mjs';

const cwd = path.resolve('test-project');
const now = Date.parse('2026-09-29T19:12:57Z'); // September 30 in Bangkok.
const chat = { id: 'app-chat-a', cwd, createdAt: new Date(now).toISOString(), startedAt: now };
async function fixture() { return mkdtemp(path.join(os.tmpdir(), 'mrmak-codex-history-')); }
async function transcript(home, { day = '2026/09/30', id = randomUUID(), owner = chat.id, source = 'cli', directory = cwd, instructions = '' } = {}) {
  const folder = path.join(home, 'sessions', day);
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `rollout-example-${id}.jsonl`);
  await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id, cwd: directory, source, originator: `mrmak_chat_${owner}`, instructions } }) + '\n');
  return { id, file };
}

test('discovers local-calendar and UTC rollouts across midnight without mixing same-folder chats', async () => {
  const home = await fixture();
  await transcript(home, { owner: 'other-chat', day: '2026/09/29' });
  const expected = await transcript(home);
  assert.equal((await findCodexChat(chat, { home, now })).id, expected.id);
  const past = { ...chat, id: 'previous-date' };
  const previous = await transcript(home, { owner: past.id, day: '2026/09/28' });
  assert.equal((await findCodexChat(past, { home, now })).id, previous.id);
});

test('recovers an old closed chat by exact ownership without relying on birth time or today', async () => {
  const home = await fixture();
  const expected = await transcript(home, { day: '2026/01/01' });
  assert.equal(await findCodexChat(chat, { home, now }), null);
  assert.equal((await findCodexChat(chat, { home, now, full: true })).id, expected.id);
});

test('large metadata, Unicode split across reads and incomplete writes do not lose the native ID', async () => {
  const home = await fixture();
  const expected = await transcript(home, { instructions: '♥'.repeat(24000) });
  assert.equal((await readCodexMetadata(expected.file)).id, expected.id);
  assert.equal(await codexTranscript(expected.id, { home }), expected.file);
  const content = await readFile(expected.file);
  await writeFile(expected.file, content.subarray(0, 500));
  assert.equal(await findCodexChat(chat, { home, now }), null);
  await appendFile(expected.file, content.subarray(500));
  assert.equal((await findCodexChat(chat, { home, now })).id, expected.id);
});

test('never guesses between ambiguous owners, other folders, subagents or unrelated sessions', async () => {
  const home = await fixture();
  await transcript(home, { owner: 'unrelated' });
  await transcript(home, { directory: path.resolve('another-project') });
  await transcript(home, { source: { subagent: { parent_thread_id: 'parent' } } });
  assert.equal(await findCodexChat(chat, { home, now }), null);
  await transcript(home);
  await transcript(home);
  assert.equal(await findCodexChat(chat, { home, now }), null);
});

test('History resumes the original missing-ID conversation and persists the recovered binding', async () => {
  const home = await fixture();
  const expected = await transcript(home, { day: '2026/01/01' });
  const state = path.join(home, 'mrmak');
  const priorHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  let sessions;
  try {
    sessions = await new Sessions(cwd, state).init();
    const item = sessions.make({ ...chat, agent: 'codex', name: 'Recovered history', open: false, status: 'stopped', nativeId: null, hasConversation: true, cols: 80, rows: 24 });
    sessions.items.set(item.id, item);
    let resumed;
    sessions.launch = (session, resumeId, boundary) => { resumed = { resumeId, boundary }; session.status = 'running'; };
    const result = await sessions.resume(item.id);
    assert.equal(result.nativeId, expected.id);
    assert.equal(resumed.resumeId, expected.id);
    assert.equal(resumed.boundary.file, expected.file);
    assert.equal(result.open, true);
    assert.equal(JSON.parse(await readFile(path.join(state, 'sessions.json'), 'utf8'))[0].nativeId, expected.id);
  } finally {
    await sessions?.close();
    if (priorHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = priorHome;
  }
});

test('closing immediately captures a native ID before terminating the process; another chat cannot claim it', async () => {
  const home = await fixture();
  const expected = await transcript(home);
  const priorHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  let sessions;
  try {
    sessions = await new Sessions(cwd, path.join(home, 'mrmak')).init();
    const item = sessions.make({ ...chat, agent: 'codex', name: 'Closed chat', open: true, nativeId: null, cols: 80, rows: 24 });
    sessions.items.set(item.id, item);
    let onExit;
    item.process = {
      onExit(callback) { onExit = callback; return { dispose() {} }; },
      kill() { assert.equal(item.nativeId, expected.id); item.process = null; onExit(); },
    };
    await sessions.remove(item.id);
    assert.equal(item.open, false);
    assert.equal(item.nativeId, expected.id);
    assert.equal(sessions.bindNative({ id: 'other', nativeId: null }, expected), false);
  } finally {
    await sessions?.close();
    if (priorHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = priorHome;
  }
});

test('working folders reached through a symlink match the resolved folder the CLIs record', { skip: process.platform === 'win32' && 'needs POSIX symlinks' }, async () => {
  const home = await fixture();
  // os.tmpdir() is itself under the /var -> /private/var link on macOS.
  const name = 'Görsel project';
  const real = path.join(home, process.platform === 'darwin' ? name.normalize('NFD') : name);
  await mkdir(real);
  const link = path.join(home, 'linked');
  await symlink(real, link);
  const recorded = await realpath(real);
  const priorCodex = process.env.CODEX_HOME, priorClaude = process.env.CLAUDE_CONFIG_DIR;
  process.env.CODEX_HOME = home;
  process.env.CLAUDE_CONFIG_DIR = path.join(home, 'claude');
  let sessions;
  try {
    // Chats saved before folders were stored resolved still find both transcripts.
    const saved = { ...chat, id: 'linked-chat', cwd: link };
    const expected = await transcript(home, { owner: saved.id, directory: recorded });
    assert.equal((await findCodexChat(saved, { home, now })).id, expected.id);
    const nativeId = randomUUID();
    const project = path.join(home, 'claude', 'projects', recorded.replace(/[^a-zA-Z0-9]/g, '-'));
    await mkdir(project, { recursive: true });
    assert.equal(await claudeTranscript(link, nativeId), path.join(project, `${nativeId}.jsonl`));
    assert.equal(await claudeTranscript(recorded, nativeId), path.join(project, `${nativeId}.jsonl`));

    // New and imported chats store the spelling the CLI reports from getcwd().
    sessions = await new Sessions(cwd, path.join(home, 'mrmak')).init();
    sessions.launch = async session => { session.status = 'running'; };
    assert.equal((await sessions.create({ agent: 'codex', name: 'Linked folder', cwd: link })).cwd, recorded);
    assert.equal((await sessions.importConversation({ agent: 'codex', nativeId: randomUUID(), name: 'Imported linked folder', cwd: link })).cwd, recorded);
    // Typed (NFC) names reach the folder macOS stored in NFD.
    if (process.platform === 'darwin') assert.equal((await sessions.create({ agent: 'codex', name: 'Typed folder', cwd: path.join(home, name.normalize('NFC')) })).cwd, recorded);
  } finally {
    await sessions?.close();
    if (priorCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = priorCodex;
    if (priorClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = priorClaude;
  }
});
