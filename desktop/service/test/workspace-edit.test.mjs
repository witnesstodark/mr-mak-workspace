import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { localDay } from '../workspace.mjs';
import { saveJson } from '../util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('card edits are authenticated, scoped, persistent and preserve reports and concurrent metadata', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'workspace-edit-test-'));
  await mkdir(path.join(repo, 'workspace', 'sample'), { recursive: true });
  await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html>Fixture</html>');
  const file = path.join(repo, 'workspace', 'workspace.json');
  const report = path.join(repo, 'workspace', 'sample', 'report.html');
  await writeFile(report, '<h1>Keep this report</h1>');
  const first = { id: 'sample', title: 'A sample', category: 'research', status: 'active', type: 'group', folder: 'sample', created: '2026-01-01', steps: [{ name: 'Report', path: 'report.html' }], defaultStep: 0, custom: { keep: true }, cover: 'media/cover.webp', progress: { done: 3, total: 8, label: 'M1' }, phase: 'Alpha' };
  const second = { ...first, id: 'other', title: 'Another card', status: 'done' };
  await writeFile(file, JSON.stringify({ entities: [first, second], unknownRoot: 'keep' }));
  const service = await createService({ repo, uiDir: path.join(repo, 'ui') });
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json', Origin: service.origin };
  const edit = (patch, id = 'sample', extra = {}) => fetch(`${service.origin}/api/workspace/entities/${id}`, { method: 'PATCH', headers: { ...headers, ...extra }, body: JSON.stringify(patch) });
  try {
    assert.equal((await edit({ status: 'archived' }, 'sample', { Authorization: '' })).status, 401);
    assert.equal((await edit({ status: 'archived' }, 'sample', { Origin: service.files.origin })).status, 403);
    assert.equal((await edit({ status: 'archived' }, 'sample', { Origin: 'https://untrusted.example' })).status, 403);
    for (const patch of [{}, [], null, { status: 'deleted' }, { pinned: 'yes' }, { category: '../other' }, { category: '' }, { category: 'x'.repeat(65) }, { folder: 'elsewhere' }, { status: 'done', steps: [] }, { category: 7 }]) {
      assert.equal((await edit(patch)).status, 400, JSON.stringify(patch));
    }
    assert.equal((await edit({ status: 'done' }, 'missing')).status, 404);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).entities[0], first);
    // Independent actions may arrive together, but must patch the latest record.
    const responses = await Promise.all([edit({ status: 'done' }), edit({ category: '3d' }), edit({ pinned: true })]);
    assert.ok(responses.every(response => response.status === 200));
    let state = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(state.entities[0], { ...first, status: 'done', category: '3d', pinned: true, updated: localDay() });
    assert.deepEqual(state.entities[1], second); assert.equal(state.unknownRoot, 'keep');
    assert.equal((await (await edit({ status: 'archived' })).json()).status, 'archived');
    assert.equal((await (await edit({ status: 'active', category: 'dev', pinned: false })).json()).category, 'dev');
    state = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(state.entities[0].status, 'active'); assert.equal(state.entities[0].pinned, false);
    assert.deepEqual(state.entities[0].steps, first.steps);
    assert.equal(await readFile(report, 'utf8'), '<h1>Keep this report</h1>');
    const response = await fetch(`${service.origin}/api/workspace`, { headers });
    assert.deepEqual(await response.json(), state);
    assert.ok((await readdir(path.dirname(file))).every(name => !name.endsWith('.tmp')));
  } finally { await service.close(); }
});

test('failed atomic JSON replacement removes only its temporary file', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const directory = await mkdtemp(path.join(root, '.cache', 'workspace-save-test-'));
  const target = path.join(directory, 'keep-directory');
  await mkdir(target); await writeFile(path.join(target, 'keep.txt'), 'unchanged');
  await assert.rejects(saveJson(target, { value: 'new' }));
  assert.deepEqual(await readdir(directory), ['keep-directory']);
  assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'unchanged');
});
