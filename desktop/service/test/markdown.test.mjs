import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Files } from '../files.mjs';
import { NativeSettings } from '../native-settings.mjs';

await mkdir(path.resolve('.cache'), { recursive: true });

test('Markdown saves preserve Unicode, keep a recovery copy, and reject stale or concurrent writes', async () => {
  const repo = await mkdtemp(path.resolve('.cache/markdown-'));
  const file = path.join(repo, 'notes.md'), files = new Files(repo);
  await writeFile(file, '# Notes\n\nРусский текст 🐽\n');
  const preview = await files.preview(file);
  const changed = await files.saveMarkdown({ path: file, text: '# New notes\n\n**Текст** 🐽\n', revision: preview.revision });
  assert.match(changed.text, /\*\*Текст\*\* 🐽/);
  assert.notEqual(preview.revision, changed.revision);
  const backups = await readdir(path.join(repo, '.mrmak/markdown-backups'));
  assert.equal(await readFile(path.join(repo, '.mrmak/markdown-backups', backups.find(name => name.endsWith('.md'))), 'utf8'), preview.text);
  await assert.rejects(files.saveMarkdown({ path: file, text: 'stale', revision: preview.revision }), /changed on disk/);
  assert.equal(await readFile(file, 'utf8'), changed.text);
  const racing = await Promise.allSettled(['first', 'second'].map(text => files.saveMarkdown({ path: file, text, revision: changed.revision })));
  assert.equal(racing.filter(value => value.status === 'fulfilled').length, 1);
  await writeFile(path.join(repo, 'script.js'), 'original');
  await assert.rejects(files.saveMarkdown({ path: path.join(repo, 'script.js'), text: 'changed', revision: changed.revision }), /Markdown/);
  await assert.rejects(files.saveMarkdown({ path: file, text: 'a'.repeat(2 * 1024 * 1024 + 1), revision: changed.revision }), /2 MB/);
  assert.equal(await readFile(path.join(repo, 'script.js'), 'utf8'), 'original');
});

test('Main folders expose local Claude and Codex skills alongside knowledge and processes', async () => {
  const repo = await mkdtemp(path.resolve('.cache/skill-folders-'));
  for (const folder of ['.claude/skills', '.agents/skills', 'knowledge', 'processes', 'context', 'inbox', 'projects', 'workspace', 'node_modules']) await mkdir(path.join(repo, folder), { recursive: true });
  const result = await new Files(repo).list();
  assert.deepEqual(result.entries.map(item => item.name).sort(), ['Claude skills', 'Codex skills', 'context', 'inbox', 'knowledge', 'processes', 'projects', 'workspace']);
  assert.ok(result.entries.every(entry => entry.directory && path.isAbsolute(entry.path)));
});

test('Windows preference is confirmed by native host, synchronizes tray changes and reports failure', async () => {
  let request;
  const bridge = new NativeSettings(value => { request = value; }, () => {});
  assert.throws(() => bridge.set(true), /not available/);
  bridge.receive({ type: 'native-settings', available: true, winKey: true });
  const success = bridge.set(false);
  assert.equal(bridge.value.winKey, true);
  assert.throws(() => bridge.set(true), /in progress/);
  bridge.receive({ ...request, available: true, winKey: false });
  assert.deepEqual(await success, { available: true, winKey: false });
  bridge.receive({ type: 'native-settings', available: true, winKey: true });
  assert.equal(bridge.value.winKey, true);
  const failure = bridge.set(false);
  bridge.receive({ ...request, available: true, winKey: true, error: 'Could not save preference' });
  await assert.rejects(failure, /Could not save/);
  assert.equal(bridge.value.winKey, true);
  bridge.close();
});
