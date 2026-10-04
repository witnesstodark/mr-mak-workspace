import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  buildManifest, MANIFEST_SCHEMA, PLAN_SCHEMA, validateDocument, verifyManifest,
} from '../manifest.mjs';

const run = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const tool = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const example = join(tool, 'examples');

function plan(path = 'assets/out.txt') {
  return {
    schema: PLAN_SCHEMA,
    card_id: 'my-dream-game',
    step: 'concept-study',
    files: [{ path, kind: 'output', role: 'study-output' }],
  };
}

async function sandbox(t) {
  const base = await mkdtemp(join(tmpdir(), 'mrmak-asset-test-'));
  assert.ok(base.startsWith(resolve(tmpdir()) + sep));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  await mkdir(join(root, 'assets'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, 'assets', 'out.txt'), 'first version');
  await writeFile(join(outside, 'secret.txt'), 'outside');
  return { root, outside };
}

test('the example manifest is generated from files and verifies offline', async () => {
  const source = JSON.parse(await readFile(join(example, 'plan.json'), 'utf8'));
  const expected = JSON.parse(await readFile(join(example, 'manifest.json'), 'utf8'));
  assert.deepEqual(await buildManifest(source, repo), expected);
  assert.deepEqual(await verifyManifest(expected, repo), []);
  assert.equal(expected.schema, MANIFEST_SCHEMA);
});

test('verification detects changed and missing files without writing', async (t) => {
  const { root } = await sandbox(t);
  const manifest = await buildManifest(plan(), root);
  const file = join(root, 'assets', 'out.txt');
  const before = (await stat(file)).mtimeMs;
  const entries = await readdir(join(root, 'assets'));
  assert.deepEqual(await verifyManifest(manifest, root), []);
  assert.equal((await stat(file)).mtimeMs, before);
  assert.deepEqual(await readdir(join(root, 'assets')), entries);
  await writeFile(file, 'other version');
  assert.equal((await stat(file)).size, manifest.files[0].bytes);
  assert.match((await verifyManifest(manifest, root)).join(' '), /content or size changed/);
  await unlink(file);
  assert.match((await verifyManifest(manifest, root)).join(' '), /ENOENT/);
});

test('traversal, absolute paths and injected hash fields are rejected', async (t) => {
  const { root } = await sandbox(t);
  for (const path of ['../outside/secret.txt', '/outside.txt', 'C:/outside.txt', 'assets\\out.txt']) {
    assert.ok(validateDocument(plan(path), 'plan').some((error) => error.includes('path')));
    await assert.rejects(buildManifest(plan(path), root));
  }
  const invalid = plan();
  invalid.files[0].sha256 = 'f'.repeat(64);
  assert.ok(validateDocument(invalid, 'plan').some((error) => error.includes('unexpected field')));
});

test('file symlinks escaping the selected root are rejected for build and verify', async (t) => {
  const { root, outside } = await sandbox(t);
  const manifest = await buildManifest(plan(), root);
  await unlink(join(root, 'assets', 'out.txt'));
  try {
    await symlink(join(outside, 'secret.txt'), join(root, 'assets', 'out.txt'), 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('file symlinks unavailable');
    throw error;
  }
  await assert.rejects(buildManifest(plan(), root), /outside selected root/);
  assert.match((await verifyManifest(manifest, root)).join(' '), /outside selected root/);
});

test('directory junctions escaping the selected root are rejected', async (t) => {
  const { root, outside } = await sandbox(t);
  await writeFile(join(outside, 'out.txt'), 'outside');
  try {
    await symlink(outside, join(root, 'linked'), 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('junctions unavailable');
    throw error;
  }
  await assert.rejects(buildManifest(plan('linked/out.txt'), root), /outside selected root/);
  const manifest = await buildManifest(plan(), root);
  manifest.files[0].path = 'linked/out.txt';
  assert.match((await verifyManifest(manifest, root)).join(' '), /outside selected root/);
});

test('secret-shaped IDs, URLs and raw responses stay out of manifests', () => {
  for (const receipt_id of [
    'https://provider.example/job/1?signature=abc',
    'ghp_abcdefghijklmnopqrstuvwxyz123456',
    'sk-abcdefghijklmnopqrstuv',
  ]) {
    assert.ok(validateDocument({ ...plan(), receipt_id }, 'plan')
      .some((error) => error.includes('receipt_id')));
  }
  const raw = { ...plan(), provider_response: { headers: { authorization: 'Bearer hidden' } } };
  assert.ok(validateDocument(raw, 'plan').some((error) => error.includes('unexpected field')));
  const manifest = { ...plan(), schema: MANIFEST_SCHEMA, files: [
    { ...plan().files[0], sha256: 'a'.repeat(64), bytes: 12 },
  ] };
  assert.deepEqual(validateDocument(manifest, 'manifest'), []);
  assert.ok(validateDocument({ ...manifest, visual_approval: true }, 'manifest')
    .some((error) => error.includes('unexpected field')));
});

test('duplicate paths and deliveries without outputs are rejected', async (t) => {
  const { root } = await sandbox(t);
  const duplicate = plan();
  duplicate.files.push({ ...duplicate.files[0], kind: 'input' });
  await assert.rejects(buildManifest(duplicate, root), /duplicate file path/);
  const inputOnly = plan();
  inputOnly.files[0].kind = 'input';
  await assert.rejects(buildManifest(inputOnly, root), /at least one output/);
});

test('build CLI requires an explicit root and refuses to overwrite a manifest', async (t) => {
  const { root } = await sandbox(t);
  const planPath = join(root, 'plan.json');
  const manifestPath = join(root, 'manifest.json');
  const script = join(tool, 'manifest.mjs');
  await writeFile(planPath, JSON.stringify(plan()));
  await assert.rejects(run(process.execPath,
    [script, 'build', '--plan', planPath]), /--root is required/);
  await run(process.execPath,
    [script, 'build', '--plan', planPath, '--root', root, '--out', manifestPath]);
  const original = await readFile(manifestPath, 'utf8');
  await assert.rejects(run(process.execPath,
    [script, 'build', '--plan', planPath, '--root', root, '--out', manifestPath]), /EEXIST/);
  assert.equal(await readFile(manifestPath, 'utf8'), original);
});

test('verify CLI is read-only and refuses output options', async (t) => {
  const { root } = await sandbox(t);
  const manifest = await buildManifest(plan(), root);
  const path = join(root, 'manifest.json');
  const output = join(root, 'not-written.json');
  await writeFile(path, JSON.stringify(manifest));
  const script = join(tool, 'manifest.mjs');
  const { stdout } = await run(process.execPath, [script, 'verify', '--manifest', path, '--root', root]);
  assert.match(stdout, /File integrity verified/);
  await assert.rejects(run(process.execPath,
    [script, 'verify', '--manifest', path, '--root', root, '--out', output]));
  assert.deepEqual((await readdir(root)).sort(), ['assets', 'manifest.json']);
});
