import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, open, readFile, readdir, rm, rmdir, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveJson, sleep } from '../util.mjs';
import { Sessions } from '../sessions.mjs';

const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mrmak-persistence-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('mrmak-persistence-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

// Reproduce the Windows lock from a reader that does not share delete access.
// The file path is passed as data, never interpolated into PowerShell code.
async function lockFile(file) {
  const script = `
    $ErrorActionPreference = 'Stop'
    $stream = [IO.File]::Open($env:MRMAK_TEST_LOCK_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      [Console]::Out.WriteLine('locked')
      [Console]::Out.Flush()
      [Console]::ReadLine() | Out-Null
    } finally { $stream.Dispose() }
  `;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, env: { ...process.env, MRMAK_TEST_LOCK_FILE: file }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let stderr = '', stdout = '';
  child.stderr.setEncoding('utf8'); child.stderr.on('data', data => { stderr += data; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out opening the test file lock')), 10000);
      const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
      child.once('error', finish);
      child.once('exit', () => finish(new Error(`Test lock exited before becoming ready: ${stderr}`)));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => { stdout += data; if (stdout.includes('locked')) finish(); });
    });
  } catch (error) { child.kill(); await exited.catch(() => {}); throw error; }
  let releasing;
  return () => releasing ??= (async () => { child.stdin.end('\n'); await exited; })();
}

test('atomic JSON replacement waits for a brief Windows reader lock', { skip: process.platform !== 'win32' }, async t => {
  const root = await directory(t), file = path.join(root, 'screen.json');
  await saveJson(file, { data: 'old screen' });
  const release = await lockFile(file);
  try {
    let completed = false;
    const saving = saveJson(file, { data: 'new screen' });
    // Attach both handlers immediately, including when running against old code.
    const outcome = saving.then(() => { completed = true; return null; }, error => { completed = true; return error; });
    await sleep(200);
    const old = JSON.parse(await readFile(file, 'utf8'));
    const wasPending = !completed;
    await release();
    assert.equal(await outcome, null);
    assert.equal(wasPending, true);
    assert.deepEqual(old, { data: 'old screen' });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { data: 'new screen' });
    assert.deepEqual(await readdir(root), ['screen.json']);
  } finally { await release(); }
});

test('a persistent Windows lock preserves the saved file, cleans up and allows a later save', { skip: process.platform !== 'win32' }, async t => {
  const root = await directory(t), file = path.join(root, 'screen.json');
  await saveJson(file, { data: 'keep this screen' });
  const release = await lockFile(file);
  try {
    await assert.rejects(saveJson(file, { data: 'blocked screen' }), error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code));
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { data: 'keep this screen' });
    assert.deepEqual(await readdir(root), ['screen.json']);
  } finally { await release(); }
  await saveJson(file, { data: 'latest screen' });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { data: 'latest screen' });
});

test('a delayed Windows save cannot overwrite a newer save after the lock clears', { skip: process.platform !== 'win32' }, async t => {
  const root = await directory(t), file = path.join(root, 'screen.json');
  await saveJson(file, { data: 'original screen' });
  const release = await lockFile(file);
  const first = saveJson(file, { data: 'earlier screen' }).then(() => null, error => error);
  try {
    await sleep(200);
    // Other files remain independent of the locked destination's save queue.
    await saveJson(path.join(root, 'other.json'), { saved: true });
    await release();
    const latest = { data: 'latest screen' };
    const second = saveJson(file, latest);
    latest.data = 'mutation after requesting the save';
    await second;
    assert.equal(await first, null);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { data: 'latest screen' });
  } finally { await release(); await first; }
});

async function sessionStore(t, root, ids) {
  const sessions = await new Sessions(root, root).init();
  clearInterval(sessions.timer);
  // These fixtures never launch a CLI; dispose without another disk save.
  t.after(() => { for (const session of sessions.items.values()) session.terminal?.dispose(); });
  for (const id of ids) {
    const session = sessions.make({ id, name: id, agent: 'shell', open: true, cols: 80, rows: 24 });
    sessions.items.set(id, session); await sessions.hydrate(session);
    await write(session.terminal, `${id} screen`);
  }
  return sessions;
}

test('metadata and other chat activity do not rewrite an unchanged screen', async t => {
  const root = await directory(t);
  const sessions = await sessionStore(t, root, ['idle', 'busy']);
  await sessions.persist();
  const file = path.join(root, 'screen-idle.json');
  const past = new Date('2000-01-01T00:00:00Z');
  await utimes(file, past, past);
  const before = await stat(file);
  sessions.rename('idle', 'Renamed chat');
  await write(sessions.get('busy').terminal, '\r\nNew output');
  await Promise.all([sessions.persist(), sessions.persist()]);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.match(JSON.parse(await readFile(path.join(root, 'screen-busy.json'), 'utf8')).data, /New output/);
  const metadata = JSON.parse(await readFile(path.join(root, 'sessions.json'), 'utf8'));
  assert.equal(metadata.find(item => item.id === 'idle').name, 'Renamed chat');
  assert.equal('savedScreen' in metadata[0], false);
  await write(sessions.get('idle').terminal, '\r\nIdle chat now changed');
  await sessions.persist();
  assert.match(JSON.parse(await readFile(file, 'utf8')).data, /Idle chat now changed/);
});

test('a failed screen does not block other snapshots and stays pending for the next autosave', async t => {
  const root = await directory(t);
  const sessions = await sessionStore(t, root, ['blocked', 'working']);
  const blocked = path.join(root, 'screen-blocked.json');
  await mkdir(blocked); await writeFile(path.join(blocked, 'keep.txt'), 'untouched');
  try {
    await assert.rejects(sessions.persist());
    assert.equal(sessions.dirty, true);
    assert.equal(sessions.get('blocked').savedScreen, undefined);
    assert.match(JSON.parse(await readFile(path.join(root, 'screen-working.json'), 'utf8')).data, /working screen/);
    assert.equal(await readFile(path.join(blocked, 'keep.txt'), 'utf8'), 'untouched');
    assert.ok((await readdir(root)).every(name => !name.endsWith('.tmp')));
  } finally {
    await rm(path.join(blocked, 'keep.txt')); await rmdir(blocked);
  }
  await sessions.persist();
  assert.equal(sessions.dirty, false);
  assert.match(JSON.parse(await readFile(blocked, 'utf8')).data, /blocked screen/);
});

test('a failed metadata save stays pending and the save queue recovers', async t => {
  const root = await directory(t);
  const sessions = await sessionStore(t, root, ['chat']);
  const blocked = path.join(root, 'sessions.json');
  await mkdir(blocked); await writeFile(path.join(blocked, 'keep.txt'), 'untouched');
  try {
    await assert.rejects(sessions.persist());
    assert.equal(sessions.dirty, true);
    assert.equal(await readFile(path.join(blocked, 'keep.txt'), 'utf8'), 'untouched');
  } finally {
    await rm(path.join(blocked, 'keep.txt')); await rmdir(blocked);
  }
  await sessions.persist();
  assert.equal(sessions.dirty, false);
  assert.equal(JSON.parse(await readFile(blocked, 'utf8'))[0].id, 'chat');
});

const savedChat = (id, name) => ({ id, name, agent: 'shell', cwd: os.tmpdir(), open: false, pinned: false, tabOrder: 0, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });
async function loadedStore(t, root) {
  const sessions = await new Sessions(root, root).init();
  clearInterval(sessions.timer);
  t.after(() => { for (const session of sessions.items.values()) session.terminal?.dispose(); });
  return sessions;
}
const quietWarnings = t => { const warn = console.warn; console.warn = () => {}; t.after(() => { console.warn = warn; }); };

test('saveJson flushes the new contents to disk before replacing the destination', async t => {
  const root = await directory(t), file = path.join(root, 'sessions.json');
  await saveJson(file, ['old list']);
  const probe = await open(path.join(root, 'probe'), 'w');
  const FileHandle = probe.constructor;
  await probe.close(); await rm(path.join(root, 'probe'));
  const original = FileHandle.prototype.sync;
  const seen = [];
  FileHandle.prototype.sync = async function () {
    await original.call(this);
    // At flush time the destination must still hold the previous list.
    seen.push(JSON.parse(await readFile(file, 'utf8')));
  };
  t.after(() => { FileHandle.prototype.sync = original; });
  await saveJson(file, ['new list']);
  assert.deepEqual(seen, [['old list']]);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), ['new list']);
  assert.deepEqual(await readdir(root), ['sessions.json']);
});

test('a zero-filled chat list is kept aside and History is loaded from the backup', async t => {
  quietWarnings(t);
  const root = await directory(t);
  await saveJson(path.join(root, 'sessions.json.bak'), [savedChat('one', 'First chat'), savedChat('two', 'Second chat')]);
  await writeFile(path.join(root, 'sessions.json'), Buffer.alloc(4096));
  const sessions = await loadedStore(t, root);
  assert.deepEqual(sessions.list().map(item => item.name).sort(), ['First chat', 'Second chat']);
  const kept = (await readdir(root)).filter(name => name.startsWith('sessions.json.unreadable-'));
  assert.equal(kept.length, 1);
  assert.deepEqual(await readFile(path.join(root, kept[0])), Buffer.alloc(4096));
  await sessions.persist();
  assert.equal(JSON.parse(await readFile(path.join(root, 'sessions.json'), 'utf8')).length, 2);
});

test('an invalid chat list without a backup starts empty and preserves the original file', async t => {
  quietWarnings(t);
  const root = await directory(t);
  await writeFile(path.join(root, 'sessions.json'), '[{"id":"cut-off');
  const sessions = await loadedStore(t, root);
  assert.equal(sessions.list().length, 0);
  const kept = (await readdir(root)).filter(name => name.startsWith('sessions.json.unreadable-'));
  assert.equal(kept.length, 1);
  assert.equal(await readFile(path.join(root, kept[0]), 'utf8'), '[{"id":"cut-off');
});

test('a missing chat list starts empty without recovery files', async t => {
  const root = await directory(t);
  const sessions = await loadedStore(t, root);
  assert.equal(sessions.list().length, 0);
  assert.deepEqual(await readdir(root), []);
});

test('a valid chat list is used even when an older backup exists', async t => {
  const root = await directory(t);
  await saveJson(path.join(root, 'sessions.json'), [savedChat('current', 'Current chat')]);
  await saveJson(path.join(root, 'sessions.json.bak'), [savedChat('older', 'Older chat')]);
  const sessions = await loadedStore(t, root);
  assert.deepEqual(sessions.list().map(item => item.name), ['Current chat']);
  assert.deepEqual((await readdir(root)).sort(), ['sessions.json', 'sessions.json.bak']);
});

test('persist keeps a matching backup and rewrites it only when the list changes', async t => {
  const root = await directory(t);
  const sessions = await sessionStore(t, root, ['chat']);
  await sessions.persist();
  const backup = path.join(root, 'sessions.json.bak');
  assert.deepEqual(JSON.parse(await readFile(backup, 'utf8')), JSON.parse(await readFile(path.join(root, 'sessions.json'), 'utf8')));
  const past = new Date('2000-01-01T00:00:00Z');
  await utimes(backup, past, past);
  const before = await stat(backup);
  await sessions.persist();
  assert.equal((await stat(backup)).mtimeMs, before.mtimeMs);
  sessions.rename('chat', 'Renamed chat');
  await sessions.persist();
  assert.equal(JSON.parse(await readFile(backup, 'utf8'))[0].name, 'Renamed chat');
});
