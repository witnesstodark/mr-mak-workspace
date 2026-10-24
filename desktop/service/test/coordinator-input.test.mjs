import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Attachments, MAX_IMAGE_BYTES } from '../attachments.mjs';
import { createService } from '../server.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvWQAAAAASUVORK5CYII=', 'base64');
async function fixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-coordinator-test-'));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const service = await createService({ repo, uiDir: repo, mcpOptions: { home: repo, env: {} } });
  const request = (route, data) => fetch(service.origin + '/api' + route, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return { repo, service, request };
}

test('coordinator receives image content and paths; retries never replay a completed operation', async () => {
  const { repo, service, request } = await fixture();
  try {
    const image = await new Attachments(repo).save(png, 'Reference.png');
    const turns = [];
    service.coordinator.start = async () => { service.coordinator.threadId = 'fixture'; };
    service.coordinator.rpc = async (method, params) => {
      assert.equal(method, 'turn/start'); turns.push(params);
      service.coordinator.active.resolve('Image reviewed.');
      return { turn: { id: 'fixture-turn' } };
    };
    service.quick.ask = async () => { throw new Error('An image must not take a text-only shortcut.'); };
    const response = await request('/coordinator', { id: 'with-image', text: 'Read this card', images: [image.path] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'completed');
    assert.deepEqual(turns[0].input[1], { type: 'localImage', path: image.path });
    assert.ok(turns[0].input[0].text.includes(JSON.stringify([image.path])));
    assert.deepEqual(service.coordinator.operations.get('with-image').images, [image.path]);
    await request('/coordinator', { id: 'with-image', text: 'Retry this', images: [image.path] });
    assert.equal(turns.length, 1);
    const invalid = await request('/coordinator', { id: 'invalid-image', text: 'Read this', images: [path.join(repo, 'workspace/workspace.json')] });
    assert.equal(invalid.status, 400); assert.equal(turns.length, 1);
  } finally { await service.close(); }
});

test('coordinator images must be actual, bounded images inside the upload folder, including through links', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-image-validation-'));
  const attachments = new Attachments(repo), image = await attachments.save(png, 'Valid.png');
  assert.deepEqual(await attachments.coordinatorImages([image.path, image.path]), [image.path]);
  const text = path.join(path.dirname(image.path), 'pretend.png'); await writeFile(text, 'This is a private text document.');
  for (const files of [null, {}, [text], [path.dirname(image.path)], Array(13).fill(image.path), ['relative.png']]) await assert.rejects(attachments.coordinatorImages(files));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'mrmak-outside-image-'));
  await writeFile(path.join(outside, 'secret.png'), png);
  const alias = path.join(repo, 'inbox/attachments/linked'); await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(attachments.coordinatorImages([path.join(alias, 'secret.png')]), /uploaded through Mr. Mak/);
  const handle = await open(image.path, 'r+'); await handle.truncate(MAX_IMAGE_BYTES + 1); await handle.close();
  await assert.rejects(attachments.coordinatorImages([image.path]), /smaller than 25 MB/);
});

test('coordinator cannot increase the UI-selected default chat permission level', async () => {
  const { service, request, repo } = await fixture();
  const created = [];
  service.sessions.create = async options => {
    created.push(options);
    const session = service.sessions.make({ id: `fixture-${created.length}`, cwd: repo, agent: 'codex', open: false, status: 'closed', ...options });
    service.sessions.items.set(session.id, session); return session;
  };
  const create = bypass => service.coordinator.execute('open_chat', { agent: 'codex', name: 'Review Reference', bypass }, 'fixture');
  try {
    await assert.rejects(create(true), /choose it yourself/); assert.equal(created.length, 0);
    await create(undefined); assert.equal(created.at(-1).bypass, false);
    assert.equal((await request('/settings', { defaultBypass: true })).status, 200);
    await create(undefined); assert.equal(created.at(-1).bypass, true);
    await create(false); assert.equal(created.at(-1).bypass, false);
    await create(true); assert.equal(created.at(-1).bypass, true);
    assert.equal((await request('/settings', { defaultBypass: false })).status, 200);
    await assert.rejects(create(true), /choose it yourself/);
    await assert.rejects(create('true'), /valid chat permission/);
  } finally { await service.close(); }
});

test('coordinator cannot reuse an existing bypass chat or resume a shell to evade the selected permissions', async () => {
  const { service, request, repo } = await fixture();
  const session = service.sessions.make({ id: 'restricted-target', cwd: repo, agent: 'codex', bypass: true, open: false, status: 'stopped' });
  service.sessions.items.set(session.id, session);
  let sends = 0, resumes = 0;
  service.sessions.input = () => { sends++; return { delivered: true }; };
  service.sessions.resume = async () => { resumes++; return session; };
  try {
    for (const name of ['send_to_chat', 'reopen_chat', 'attach_files']) await assert.rejects(service.coordinator.execute(name, { id: session.id, text: 'task', paths: [] }, 'fixture'), /bypass permissions/);
    assert.equal(sends + resumes, 0);
    await request('/settings', { defaultBypass: true });
    await service.coordinator.execute('send_to_chat', { id: session.id, text: 'task' }, 'fixture');
    await service.coordinator.execute('reopen_chat', { id: session.id }, 'fixture');
    assert.equal(sends, 1); assert.equal(resumes, 1);
    session.agent = 'shell';
    for (const name of ['send_to_chat', 'reopen_chat', 'attach_files']) await assert.rejects(service.coordinator.execute(name, { id: session.id, text: 'task', paths: [] }, 'fixture'), /local shell directly/);
    assert.equal(sends, 1); assert.equal(resumes, 1);
  } finally { await service.close(); }
});
