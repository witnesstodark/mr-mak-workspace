import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, open, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { Attachments } from '../attachments.mjs';
import { sleep } from '../util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
async function fixture() {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'path-attachments-'));
  for (const folder of ['workspace', 'inbox', 'ui', 'First folder', 'Вторая папка']) await mkdir(path.join(repo, folder));
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), '{"entities":[]}');
  await writeFile(path.join(repo, 'First folder', 'Nested.txt'), 'Do not enumerate or copy this file.');
  const document = path.join(repo, "Bob's $notes`draft.md");
  await writeFile(document, 'Keep the original file.');
  const largeImage = path.join(repo, 'Original large image.png');
  const file = await open(largeImage, 'w');
  try { await file.truncate(30 * 1024 * 1024); } finally { await file.close(); }
  const paths = [path.join(repo, 'First folder'), path.join(repo, 'Вторая папка'), document, largeImage];
  return { repo, paths };
}

test('multiple folder, document and image paths reach a real terminal once without copying or submitting', { timeout: 20000 }, async () => {
  const { repo, paths } = await fixture();
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  try {
    const shell = await service.sessions.create({ agent: 'shell', name: 'Path drop check', cwd: repo });
    await sleep(500);
    const terminal = service.sessions.get(shell.id).process;
    const nativeWrite = terminal.write.bind(terminal), writes = [];
    terminal.write = text => { writes.push(text); nativeWrite(text); };
    const attach = paths => fetch(`${service.origin}/api/sessions/${shell.id}/attach`, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }) });
    const response = await attach(paths);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { attached: paths, submitted: false });
    assert.equal(writes.length, 1);
    assert.ok(writes[0].includes("Bob''s $notes`draft.md"));
    assert.ok(writes[0].includes("First folder' '"));
    assert.ok(writes[0].includes('Вторая папка'));
    assert.equal(/[\r\n\x1b]/.test(writes[0]), false);
    assert.equal(service.sessions.get(shell.id).hasConversation, false);
    assert.deepEqual(await readdir(path.join(repo, 'inbox')), []);
    assert.deepEqual(await readdir(paths[0]), ['Nested.txt']);
    assert.equal((await stat(paths[3])).size, 30 * 1024 * 1024);
    const badBatch = await attach([paths[0], path.join(repo, 'Missing folder')]);
    assert.equal(badBatch.status, 400);
    assert.equal(writes.length, 1, 'A failing batch must not insert its first path.');
  } finally { await service.close(); }
});

test('path references preserve folder aliases and reject invalid lists or terminal control characters', async () => {
  const { repo, paths } = await fixture();
  const attachments = new Attachments(repo);
  const alias = path.join(repo, 'Folder alias');
  await symlink(paths[0], alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await attachments.paths([alias]), [alias]);
  for (const invalid of [[], Array(101).fill(paths[0]), [null], ['relative/path'], [paths[0] + '\r\n'], [paths[0] + '\x1b']]) {
    await assert.rejects(attachments.paths(invalid));
  }
  assert.deepEqual(await readdir(path.join(repo, 'inbox')), []);
});

test('native file selection is authenticated and correlated with the requesting window', async () => {
  const { repo } = await fixture(), events = [];
  const service = await createService({ repo, uiDir: path.join(repo, 'ui'), native: event => events.push(event) });
  const requestId = '00000000-0000-4000-8000-000000000001';
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' };
  const pick = (body, extraHeaders = headers) => fetch(service.origin + '/api/files/pick', { method: 'POST', headers: extraHeaders, body: JSON.stringify(body) });
  try {
    assert.equal((await pick({ requestId }, {})).status, 401);
    assert.equal((await pick({ requestId }, { ...headers, Origin: service.contentOrigin })).status, 403);
    assert.equal((await pick({ requestId: 'unbounded event name' })).status, 400);
    assert.deepEqual(events, []);
    assert.equal((await pick({ requestId })).status, 200);
    assert.deepEqual(events, [{ type: 'pick-files', window: 'chats', requestId }]);
  } finally { await service.close(); }
});
