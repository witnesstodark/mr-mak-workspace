import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { antigravityConversation, antigravityLogPath, prepareAntigravityLog, readAntigravityConversation, watchAntigravity } from '../antigravity.mjs';
import { terminalCommand } from '../agents.mjs';
import { commandSearchRoots, resolveCommand } from '../platform.mjs';
import { Sessions } from '../sessions.mjs';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const line = (id, verb = 'Created') => `I1013 23:48:17.916254     258 conversation.go:224] ${verb} conversation ${id}\n`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 160; i++) { if (await check()) return; await pause(50); } throw new Error('Antigravity fixture timed out'); }

test('Antigravity is discoverable before the app refreshes PATH', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mrmak-agy-lookup-'));
  const local = path.join(home, 'Local AppData');
  const bin = process.platform === 'win32' ? path.join(local, 'agy/bin') : path.join(home, '.local/bin');
  await mkdir(bin, { recursive: true });
  const file = path.join(bin, process.platform === 'win32' ? 'agy.exe' : 'agy');
  await writeFile(file, '', { mode: 0o755 });
  assert.ok(commandSearchRoots({ LOCALAPPDATA: local }, home).includes(bin));
  assert.equal(resolveCommand('agy', { PATH: '', LOCALAPPDATA: local }, home), file);
});

test('Antigravity command preserves permissions, explicit effort and an exact conversation target', async () => {
  const bin = await mkdtemp(path.join(os.tmpdir(), 'mrmak-agy-command-'));
  await writeFile(path.join(bin, process.platform === 'win32' ? 'agy.cmd' : 'agy'), '', { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try {
    for (const bypass of [true, false]) {
      const command = terminalCommand('antigravity', { bypass, resumeId: idA, effort: 'xhigh', antigravityLog: path.join(bin, "owner's log.txt") });
      const launch = process.platform === 'win32' ? Buffer.from(command.args.at(-1), 'base64').toString('utf16le') : command.args.join(' ');
      assert.match(launch, /--conversation/); assert.ok(launch.includes(idA));
      assert.match(launch, /--effort.*xhigh/); assert.match(launch, /--log-file/);
      assert.equal(launch.includes('--dangerously-skip-permissions'), bypass);
      assert.doesNotMatch(launch, /--continue|model_reasoning_effort|--session/);
      if (process.platform === 'win32') assert.ok(launch.includes("owner''s log.txt"));
    }
    assert.throws(() => terminalCommand('antigravity', { resumeId: '--continue' }), /conversation ID/);
    assert.throws(() => terminalCommand('antigravity', { resumeId: '../other' }), /conversation ID/);
    assert.throws(() => terminalCommand('antigravity', { resumeId: 'wrong-but-not-an-option' }), /UUID/);
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
});

test('Native ID discovery ignores echoed UUIDs, partial records and unrelated messages', () => {
  assert.equal(antigravityConversation(`Created conversation ${idA}\n`), null);
  assert.equal(antigravityConversation(`I1013 23:48:17.916254 258 tool.go:12] echo Created conversation ${idA}\n`), null);
  assert.equal(antigravityConversation(line(idA) + `tool result ${idB}\n`), idA);
  assert.equal(antigravityConversation(line(idA) + line(idB, 'Resuming')), idB);
  assert.equal(antigravityConversation(line('not-a-uuid')), null);
  assert.throws(() => antigravityLogPath(os.tmpdir(), '../secret'), /Invalid/);
});

test('Two same-folder chats recover separate native IDs after restart, including a log larger than the read window', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-agy-history-'));
  let sessions = await new Sessions(repo, path.join(repo, 'state')).init();
  const first = sessions.make({ id: randomUUID(), agent: 'antigravity', cwd: repo, open: false, hasConversation: false });
  const second = sessions.make({ id: randomUUID(), agent: 'antigravity', cwd: repo, open: false, hasConversation: false });
  sessions.items.set(first.id, first); sessions.items.set(second.id, second);
  const fileA = await prepareAntigravityLog(sessions.stateDir, first.id);
  const fileB = await prepareAntigravityLog(sessions.stateDir, second.id);
  await writeFile(fileA, line(idA) + 'unrelated log line\n'.repeat(40000));
  await writeFile(fileB, line(idB));
  await Promise.all([sessions.recoverNative(first), sessions.recoverNative(second)]);
  assert.deepEqual([first.nativeId, second.nativeId], [idA, idB]);
  sessions.bindAntigravity(first, idB);
  assert.equal(first.nativeId, idA, 'another tab already owns this conversation');
  await sessions.close();
  sessions = await new Sessions(repo, path.join(repo, 'state')).init();
  try {
    const launches = [];
    sessions.launch = (session, resumeId) => { launches.push(resumeId); };
    await sessions.resume(first.id); await sessions.resume(second.id);
    assert.deepEqual(launches, [idA, idB]);
    assert.equal(sessions.get(first.id).effort, 'xhigh');
  } finally { await sessions.close(); }
});

test('Log watcher discovers new and switched conversations and stops after disposal', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'mrmak-agy-watch-'));
  const chatId = randomUUID();
  const file = await prepareAntigravityLog(stateDir, chatId);
  const ids = [];
  const stop = watchAntigravity(stateDir, chatId, id => ids.push(id));
  try {
    await writeFile(file, line(idA)); await until(() => ids.length === 1);
    await writeFile(file, line(idA) + line(idB, 'Resuming')); await until(() => ids.length === 2);
    assert.deepEqual(ids, [idA, idB]);
    assert.equal(await readAntigravityConversation(stateDir, chatId), idB);
  } finally { stop(); }
  await writeFile(file, line(idA)); await pause(500); assert.equal(ids.length, 2);
});

test('Login Enter does not invent a conversation, while missing known history never silently becomes a new chat', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-agy-onboarding-'));
  const sessions = await new Sessions(repo, repo).init();
  const item = sessions.make({ id: randomUUID(), agent: 'antigravity', cwd: repo, open: true, hasConversation: false });
  sessions.items.set(item.id, item);
  item.process = { write() {} };
  sessions.input(item.id, '\r'); assert.equal(item.hasConversation, false);
  item.process = null;
  let launches = 0;
  sessions.launch = () => { launches++; };
  try {
    await sessions.resume(item.id); assert.equal(launches, 1);
    item.hasConversation = true;
    await assert.rejects(sessions.resume(item.id), /native conversation could not be located/);
    assert.equal(launches, 1);
  } finally { await sessions.close(); }
});

test('Real PTY create and resume execute Antigravity flags and retain distinct chats', { timeout: 30000 }, async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-agy-pty-'));
  const bin = path.join(repo, 'bin'); await mkdir(bin);
  const fake = path.join(bin, 'fake.mjs');
  const trace = path.join(repo, 'launches.jsonl');
  await writeFile(fake, `import fs from 'node:fs'; import path from 'node:path';
const args=process.argv.slice(2); const value=k=>args[args.indexOf(k)+1];
const id=args.includes('--conversation')?value('--conversation'):path.basename(value('--log-file'),'.log');
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');
fs.appendFileSync(value('--log-file'),'I1013 23:48:17.916254 258 conversation.go:224] '+(args.includes('--conversation')?'Resuming':'Created')+' conversation '+id+'\\n');
console.log('AGY_FIXTURE '+id); setTimeout(()=>process.exit(0),650);`);
  const entry = path.join(bin, process.platform === 'win32' ? 'agy.cmd' : 'agy');
  await writeFile(entry, process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n` : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${fake.replaceAll("'", "'\\''")}' "$@"\n`);
  if (process.platform !== 'win32') await chmod(entry, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous || ''}`;
  let sessions = await new Sessions(repo, path.join(repo, 'state')).init();
  try {
    const a = await sessions.create({ agent: 'antigravity', name: 'First test', bypass: false });
    const b = await sessions.create({ agent: 'antigravity', name: 'Second test', bypass: false });
    await until(() => [a,b].every(s => !sessions.get(s.id).process && sessions.get(s.id).nativeId));
    assert.equal(sessions.get(a.id).nativeId, a.id); assert.equal(sessions.get(b.id).nativeId, b.id);
    await sessions.remove(a.id); await sessions.remove(b.id);
    await sessions.close();
    sessions = await new Sessions(repo, path.join(repo, 'state')).init();
    await sessions.resume(a.id); await sessions.resume(b.id);
    await until(() => [a,b].every(s => !sessions.get(s.id).process));
    const launches = (await readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(launches.length,4);
    for (const args of launches) { assert.ok(args.includes('--log-file')); assert.ok(args.includes('xhigh')); assert.ok(!args.includes('--dangerously-skip-permissions')); }
    assert.deepEqual(launches.slice(2).map(args=>args[args.indexOf('--conversation')+1]).sort(),[a.id,b.id].sort());
  } finally { await sessions.close(); if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
});
