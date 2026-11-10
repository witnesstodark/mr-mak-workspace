// The Files tab in the real Workspace UI: folder hierarchy at depth, Git state,
// the selected chat's reads and writes, following the agent, diff and size map.
// A temporary Git repository and a synthetic Claude Code transcript; no CLI runs.
// MRMAK_UI_DIR points at a built UI other than dist; MRMAK_UI_SHOTS saves screenshots.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/files-ui-'));
const config = path.join(repo, 'claude-home');
process.env.CLAUDE_CONFIG_DIR = config;
const { createService } = await import('../server.mjs');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
await mkdir(path.join(repo, 'workspace')); await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await writeFile(path.join(repo, '.gitignore'), 'claude-home/\n.mrmak/\n');
// Fourteen nested folders under projects/, a file at each end.
const levels = Array.from({ length: 14 }, (_, index) => `level-${String(index + 1).padStart(2, '0')}`);
const deep = path.join(repo, 'projects', ...levels);
await mkdir(deep, { recursive: true });
await writeFile(path.join(deep, 'bottom.txt'), 'deep\n');
await writeFile(path.join(repo, 'projects/game.js'), 'const speed = 1;\n');
await writeFile(path.join(repo, 'projects/big.bin'), Buffer.alloc(200000));
git('init', '-q'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'start');
await writeFile(path.join(repo, 'projects/game.js'), 'const speed = 2;\nconst jump = 3;\n');
await mkdir(path.join(repo, 'projects/new-art')); await writeFile(path.join(repo, 'projects/new-art/hero.txt'), 'hero\n');

const nativeId = 'eeeeeeee-0000-4000-8000-000000000003';
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify([{ id: 'files-chat', tabOrder: 0, name: 'Files review', agent: 'claude', nativeId, cwd: repo, open: true, status: 'stopped', pinned: false, hasConversation: true, cols: 100, rows: 32, createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T08:00:00Z' }]));
const project = path.join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
await mkdir(project, { recursive: true });
const transcript = path.join(project, `${nativeId}.jsonl`);
const tool = (id, name, input) => JSON.stringify({ type: 'assistant', uuid: `t-${id}`, timestamp: new Date().toISOString(), message: { id: `m-${id}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] } }) + '\n';
await writeFile(transcript, JSON.stringify({ type: 'user', uuid: 'u1', timestamp: new Date().toISOString(), message: { content: 'Tune the game' } }) + '\n' + tool('a', 'Read', { file_path: path.join(repo, 'projects/game.js') }) + tool('b', 'Edit', { file_path: path.join(repo, 'projects/game.js'), old_string: '1', new_string: '2' }));

const shots = process.env.MRMAK_UI_SHOTS;
let service, browser;
const errors = [];
try {
  service = await createService({ repo, uiDir: process.env.MRMAK_UI_DIR || path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => { session.status = 'running'; session.startedAt = Date.now(); session.process = { resize() {}, kill() {}, onExit() { return { dispose() {} }; }, write() {} }; service.sessions.changed(session); };
  for (const session of service.sessions.items.values()) { await service.sessions.hydrate(session); service.sessions.launch(session); }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.workspace);
  await page.getByRole('button', { name: 'Toggle files' }).click();
  const tree = page.getByRole('tree', { name: 'Folder tree' });
  const row = name => tree.getByRole('treeitem', { name: new RegExp(`^${name}\\b`) });

  // Git: the branch, a modified file with its lines, an untracked folder, a changed folder.
  await expect(page.locator('.file-branch')).toContainText('2 changed');
  await row('projects').click();
  await expect(row('game.js')).toHaveClass(/git-modified/);
  await expect(row('game.js').locator('.file-git-mark')).toHaveText('M');
  await expect(row('game.js').locator('.file-lines')).toHaveText('+2 −1');
  await expect(row('new-art')).toHaveClass(/git-untracked|git-folder/);
  await expect(row('projects').locator('.file-git-dot')).toBeVisible();
  // The agent read and wrote game.js.
  await expect(row('game.js')).toHaveClass(/agent-write/);
  await expect(row('game.js')).toHaveClass(/agent-recent/);

  // Hierarchy: every level indents further than its parent and keeps its name readable.
  for (const name of levels) await row(name).click();
  await page.mouse.move(0, 0);
  await expect(row('bottom.txt')).toBeVisible();
  const lefts = [];
  for (const name of ['projects', ...levels, 'bottom.txt']) {
    const box = await row(name).locator('span').first().boundingBox();
    lefts.push(box.x);
    const cut = await row(name).locator('span').first().evaluate(node => node.scrollWidth > node.clientWidth);
    assert.ok(!cut, `${name} shows its whole name at depth`);
  }
  for (let index = 1; index < lefts.length; index++) assert.ok(lefts[index] > lefts[index - 1], `level ${index} is indented past its parent (${lefts[index - 1]} → ${lefts[index]})`);
  assert.ok(await page.locator('.file-group').count() >= 15, 'each open folder draws its guide');
  if (shots) await page.screenshot({ path: path.join(shots, 'files-deep.png') });

  // Following the agent: a new write deep in a closed folder opens the way to it.
  await row('level-01').click();
  await expect(row('level-02')).toHaveCount(0);
  await appendFile(transcript, tool('c', 'Write', { file_path: path.join(deep, 'bottom.txt'), content: 'deeper' }));
  await expect(row('bottom.txt')).toBeVisible({ timeout: 15000 });
  await expect(row('bottom.txt')).toHaveClass(/agent-write/);
  await expect(row('bottom.txt')).toBeInViewport();
  if (shots) await page.screenshot({ path: path.join(shots, 'files-follow.png') });

  // Diff of the changed file, and the size map of a folder.
  await row('game.js').hover();
  await page.getByRole('button', { name: 'Diff of game.js' }).click();
  await expect(page.locator('.diff-line.add')).toHaveText(['+const speed = 2;', '+const jump = 3;']);
  await expect(page.locator('.diff-line.remove')).toHaveText(['-const speed = 1;']);
  if (shots) await page.screenshot({ path: path.join(shots, 'files-diff.png') });
  await row('projects').hover();
  await page.getByRole('button', { name: 'Size map of projects' }).click();
  const boxes = page.locator('.folder-map-box');
  await expect(boxes.first()).toBeVisible();
  await expect(page.locator('.folder-map-box[title^="big.bin"]')).toBeVisible();
  await expect(page.locator('.folder-map-box.changed[title^="game.js"]')).toBeVisible();
  const big = await page.locator('.folder-map-box[title^="big.bin"]').boundingBox(), small = await page.locator('.folder-map-box[title^="game.js"]').boundingBox();
  assert.ok(big.width * big.height > small.width * small.height * 20, 'the map sizes boxes by bytes');
  if (shots) await page.screenshot({ path: path.join(shots, 'files-map.png') });
  await page.locator('.folder-map-box.directory[title^="new-art"]').click();
  await expect(page.locator('.folder-map-box[title^="hero.txt"]')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('Files UI check passed.');
} finally {
  await browser?.close();
  await service?.close();
}
