import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { importFile, dragFiles, moveFile, recyclePath } from '../file-transfers.mjs';
import { createService } from '../server.mjs';
import { taskTitle } from '../titles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
async function fixture() {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'file-transfer-test-'));
  await mkdir(path.join(repo, 'inbox'));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), '{"entities":[]}');
  await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>Test UI</html>');
  return repo;
}

test('streaming copies preserve bytes and concurrent duplicate names never overwrite', async () => {
  const repo = await fixture(), folder = path.join(repo, 'inbox');
  const original = Buffer.from('Existing file must survive');
  await writeFile(path.join(folder, 'My picture.png'), original);
  const payload = Buffer.from(Array.from({ length: 8193 }, (_, i) => i % 256));
  const files = await Promise.all(Array.from({ length: 3 }, () => importFile(Readable.from([payload.subarray(0, 512), payload.subarray(512)]), folder, 'My picture.png')));
  assert.equal(new Set(files.map(file => file.path)).size, 3);
  assert.deepEqual(await readFile(path.join(folder, 'My picture.png')), original);
  for (const file of files) { assert.deepEqual(await readFile(file.path), payload); assert.equal(file.renamed, true); assert.equal(file.size, payload.length); }
  const empty = await importFile(Readable.from([]), folder, 'Empty.txt');
  assert.equal((await readFile(empty.path)).length, 0);
});

test('invalid names, interrupted uploads and size limits leave no partial copies', async () => {
  const repo = await fixture(), folder = path.join(repo, 'inbox');
  const invalidNames = ['../escape.txt', '..\\escape.txt', '.', '..', 'a/b.txt'];
  if (process.platform === 'win32') invalidNames.push('CON.txt', 'C:secret', 'trailing.', 'trailing ');
  for (const name of invalidNames) {
    await assert.rejects(importFile(Readable.from(['bad']), folder, name), /file name/);
  }
  await assert.rejects(importFile(Readable.from([Buffer.from('123'), Buffer.from('456')]), folder, 'Large.bin', 4), /1 GB/);
  async function* interrupted() { yield Buffer.from('partial'); throw new Error('Transfer interrupted'); }
  await assert.rejects(importFile(interrupted(), folder, 'Interrupted.bin'), /interrupted/);
  assert.deepEqual(await readdir(folder), []);
  await assert.rejects(importFile(Readable.from([]), path.join(repo, 'ui', 'index.html'), 'file.txt'), /folder/);
  assert.deepEqual(await dragFiles([folder]), [await realpath(folder)]);
  await assert.rejects(dragFiles([]), /1 and 100/);
});

test('file import and native drag use authenticated control and a selected folder', async () => {
  const repo = await fixture(), events = [];
  const service = await createService({ repo, uiDir: path.join(repo, 'ui'), native: event => events.push(event) });
  try {
    const folder = path.join(repo, 'inbox');
    const endpoint = `${service.origin}/api/files/import?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent('A space.txt')}`;
    const headers = { Authorization: `Bearer ${service.token}` };
    assert.equal((await fetch(endpoint, { method: 'POST', body: 'blocked' })).status, 401);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: service.contentOrigin }, body: 'blocked' })).status, 403);
    assert.deepEqual(await readdir(folder), []);
    const response = await fetch(endpoint, { method: 'POST', headers, body: 'Copied from Explorer' });
    assert.equal(response.status, 201);
    const file = await response.json();
    assert.equal(await readFile(file.path, 'utf8'), 'Copied from Explorer');
    const listing = await (await fetch(`${service.origin}/api/files?mode=all&path=${encodeURIComponent(folder)}`, { headers })).json();
    assert.deepEqual(listing.entries.map(entry => entry.name), ['A space.txt']);
    const drag = await fetch(`${service.origin}/api/files/drag`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [file.path] }) });
    assert.equal(drag.status, 200);
    assert.deepEqual(events.at(-1), { type: 'drag-files', window: 'workspace', paths: [await realpath(file.path)] });
    assert.equal(await readFile(file.path, 'utf8'), 'Copied from Explorer');
  } finally { await service.close(); }
});

test('coordinator refuses unnamed or generic chats before launching a terminal', async () => {
  const repo = await fixture();
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  try {
    for (const name of ['', 'Conversation 1', 'New chat', 'Session #3', 'Codex', '123', 'Настройки голоса']) {
      await assert.rejects(service.coordinator.execute('open_chat', { agent: 'codex', name }));
    }
    assert.equal(service.sessions.list().length, 0);
    assert.equal(taskTitle('  Dream Game   Combat  '), 'Dream Game Combat');
    assert.equal(taskTitle('Voice Settings'), 'Voice Settings');
  } finally { await service.close(); }
});

test('internal drops move files, same-folder drops do nothing, collisions retain both originals', async () => {
  const repo = await fixture(), folder = path.join(repo, 'inbox');
  const source = path.join(folder, 'Move me.txt');
  await writeFile(source, 'Source bytes');
  assert.deepEqual(await moveFile(source, folder), { path: source, moved: false });
  assert.deepEqual(await readdir(folder), ['Move me.txt']);
  const destination = path.join(repo, 'workspace');
  const target = path.join(destination, 'Move me.txt');
  await writeFile(target, 'Destination bytes');
  await assert.rejects(moveFile(source, destination), /already exists/);
  assert.equal(await readFile(source, 'utf8'), 'Source bytes');
  assert.equal(await readFile(target, 'utf8'), 'Destination bytes');
  const empty = path.join(repo, 'Moved'); await mkdir(empty);
  const result = await moveFile(source, empty);
  assert.equal(result.moved, true);
  assert.equal(await readFile(result.path, 'utf8'), 'Source bytes');
  assert.deepEqual(await readdir(folder), []);
  await assert.rejects(recyclePath(repo, repo), /repository/);
  assert.equal(await recyclePath(result.path, repo), result.path);
});
