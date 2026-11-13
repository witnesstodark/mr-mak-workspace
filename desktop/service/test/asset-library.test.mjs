import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, render, safeRelative, validate, FILES } from '../../../workspace/_shared/asset-library/build.mjs';

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const item = (extra = {}) => ({ id: 'hero', name: 'Hero', category: 'characters', family: 'heroes', status: 'current', version: 2, thumbnail: 'media/hero-v02.png', ...extra });

async function card(items, files = { 'media/hero-v02.png': PNG }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asset-library-'));
  const folder = path.join(root, 'workspace', 'game');
  for (const [file, data] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await writeFile(path.join(folder, file), data);
  }
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'assets.json'), JSON.stringify({ title: 'Game assets', items }));
  return { root, folder, done: () => rm(root, { recursive: true, force: true }) };
}

test('file paths stay relative to the card folder', () => {
  for (const good of ['media/hero.webp', 'media/a b/hero-v01.png', 'hero.png']) assert.equal(safeRelative(good), true, good);
  for (const bad of ['../hero.png', 'media/../../hero.png', '/hero.png', 'C:/hero.png', 'media\\hero.png', 'https://example.com/a.png', 'file:///a.png', '.hidden/a.png', 'media/.git/a.png', 'media/a.png?x=1', 'media/a.png#x', 'media/%2e%2e/a.png', 'media//a.png', 'media/a\u0000.png', '', 42, null]) {
    assert.equal(safeRelative(bad), false, String(bad));
  }
});

test('a valid library builds a page that escapes its text and loads only report.css and report.js from _shared', async () => {
  const { folder, done } = await card([item({ name: 'Hero <script>alert(1)</script>', note: 'Use `x` "quoted"', views: [{ label: 'Back', file: 'media/hero-v02-back.png' }], generation: { provider: 'fal', job: 'job-1', cost: 3 }, history: [{ version: 1, thumbnail: 'media/hero-v01.png', note: 'First pass' }] })], { 'media/hero-v02.png': PNG, 'media/hero-v02-back.png': PNG, 'media/hero-v01.png': PNG });
  try {
    const result = build(folder);
    assert.deepEqual(result.errors, []);
    assert.equal(result.written, true);
    const html = await readFile(path.join(folder, 'assets.html'), 'utf8');
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /Hero &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /data-mak-report="document"/);
    assert.deepEqual([...html.matchAll(/(?:src|href)="(\.\.\/[^"]+)"/g)].map(match => match[1]).sort(), ['../_shared/report.css', '../_shared/report.js']);
    assert.match(html, /data-al-send="send"/);
    assert.match(html, /data-al-compare/);
    assert.match(html, /Earlier versions \(1\)/);
    assert.match(html, /fal · job <code>job-1<\/code> · 3 credits/);
    // The page carries the item id only; what is sent is read by the app from assets.json.
    assert.doesNotMatch(html, /data-ativo|repositorio/);
    assert.equal(build(folder).written, false, 'an unchanged library leaves the page alone');
  } finally { await done(); }
});

test('--check validates without writing', async () => {
  const { folder, done } = await card([item()]);
  try {
    assert.deepEqual(build(folder, { check: true }), { errors: [], warnings: [], written: false });
    assert.equal(existsSync(path.join(folder, 'assets.html')), false);
  } finally { await done(); }
});

test('paths outside the card, wrong types, missing files and oversized files are refused', async () => {
  const big = Buffer.alloc(FILES.image.max + 1);
  const { root, folder, done } = await card([
    item({ thumbnail: '../outside.png' }),
    item({ id: 'icon', thumbnail: 'media/icon.svg' }),
    item({ id: 'ship', thumbnail: 'media/ship.png', model: 'media/ship.exe' }),
    item({ id: 'gone', thumbnail: 'media/gone.png' }),
    item({ id: 'huge', thumbnail: 'media/huge.png' }),
    item({ id: 'linked', thumbnail: 'media/link/secret.png' }),
    item({ id: 'remote', thumbnail: 'https://example.com/a.png' }),
  ], { 'media/hero-v02.png': PNG, 'media/icon.svg': '<svg/>', 'media/ship.png': PNG, 'media/huge.png': big });
  try {
    await mkdir(path.join(root, 'private'), { recursive: true });
    await writeFile(path.join(root, 'private', 'secret.png'), PNG);
    // A junction needs no administrator rights on Windows.
    await symlink(path.join(root, 'private'), path.join(folder, 'media', 'link'), 'junction');
    const { errors } = build(folder);
    const about = id => errors.filter(error => error.startsWith(`item "${id}"`)).join('\n');
    assert.match(about('hero'), /relative to the card folder/);
    assert.match(about('icon'), /must be \.webp/);
    assert.match(about('ship'), /model "media\/ship\.exe" must be \.glb/);
    assert.match(about('gone'), /file not found/);
    assert.match(about('huge'), /over the 1024 KB limit/);
    assert.match(about('linked'), /points outside the card folder/);
    assert.match(about('remote'), /relative to the card folder/);
    assert.equal(existsSync(path.join(folder, 'assets.html')), false, 'nothing is written while there are errors');
  } finally { await done(); }
});

test('fields are checked by type and size', () => {
  const { errors, warnings } = validate({ items: [
    item({ id: 'Bad Id' }),
    item({ id: 'a', status: 'vigente', version: 0, category: 'weapons', family: 'Heroes' }),
    item({ id: 'b', generation: { provider: 'fal', job: 'x', seed: 1 }, history: [{ version: 2, thumbnail: 'media/x.png' }] }),
    item({ id: 'c', note: 'x'.repeat(601), extra: true }),
    item({ id: 'c' }),
    { id: 'd', name: 'Sound', category: 'audio', family: 'ui', status: 'review', version: 1, audio: [{ label: 'Click', file: 'media/click.ogg' }] },
  ] });
  const text = errors.join('\n');
  assert.match(text, /item "Bad Id": "id" must be lowercase/);
  assert.match(text, /item "a": "category" must be one of/);
  assert.match(text, /item "a": "family" must be lowercase/);
  assert.match(text, /item "a": "status" must be one of current, review, discarded/);
  assert.match(text, /item "a": "version" must be a whole number/);
  assert.match(text, /item "b": "generation" keeps only provider, job, model, date and cost \(not seed\)/);
  assert.match(text, /item "b": history 1: "version" must be a whole number below the current version/);
  assert.match(text, /item "c": "note" must be text of up to 600/);
  assert.match(text, /item "c": "id" is used by another item/);
  assert.doesNotMatch(text, /item "d"/, 'an audio item needs no thumbnail');
  assert.match(warnings.join('\n'), /item "c": ignored extra/);
  assert.deepEqual(validate({ categories: [{ id: 'weapons', name: 'Weapons' }], items: [item({ category: 'weapons' })] }).errors, []);
  assert.match(validate([]).errors[0], /must be an object/);
});

test('the inlined script and style cannot close their elements', () => {
  const html = render({ items: [item()] });
  assert.equal(html.match(/<\/script>/g).length, 2, 'report.js and the inlined script');
  assert.equal(html.match(/<\/style>/g).length, 1);
});
