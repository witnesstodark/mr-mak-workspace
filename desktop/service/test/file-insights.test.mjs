import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileInsights, fileActivity, folderMap, parseBranch, parseNumstat, parseStatus } from '../file-insights.mjs';

test('parses porcelain status, numstat and the branch line', () => {
  assert.deepEqual(parseStatus(' M a.js\0R  new.js\0old.js\0?? art/\0UU c.txt\0'), [
    { path: 'a.js', status: 'modified', staged: false },
    { path: 'new.js', status: 'renamed', staged: true },
    { path: 'art/', status: 'untracked', staged: false },
    { path: 'c.txt', status: 'conflict', staged: true },
  ]);
  const lines = parseNumstat('2\t1\ta.js\n-\t-\tbig.bin\n1\t0\tsrc/{old => new}/x.js\n');
  assert.deepEqual(lines.get('a.js'), { added: 2, removed: 1 });
  assert.deepEqual(lines.get('big.bin'), { added: null, removed: null });
  assert.ok(lines.has('src/new/x.js'));
  assert.deepEqual(parseBranch('## main...origin/main [ahead 1, behind 2]'), { name: 'main', upstream: 'origin/main', ahead: 1, behind: 2 });
});

test('reads Git state and diffs without running repository hooks or changing the index', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'file-insights-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'pipe' });
    await writeFile(path.join(repo, 'a.txt'), 'one\n');
    git('init', '-q'); git('add', '.'); git('commit', '-qm', 'start');
    await writeFile(path.join(repo, 'a.txt'), 'two\n');
    await writeFile(path.join(repo, 'new.txt'), 'fresh\n');
    // A repository config that would run a command on status must stay inert.
    const marker = path.join(repo, 'ran.txt').replace(/\\/g, '/');
    git('config', 'core.fsmonitor', `node -e "require('fs').writeFileSync('${marker}','x')"`);
    const index = await readFile(path.join(repo, '.git/index'));
    const insights = new FileInsights();
    const status = await insights.status(repo);
    assert.ok(status.branch.name);
    const byName = Object.fromEntries(status.files.map(item => [path.basename(item.path), item]));
    assert.equal(byName['a.txt'].status, 'modified');
    assert.equal(byName['a.txt'].added, 1);
    assert.equal(byName['new.txt'].status, 'untracked');
    assert.match((await insights.diff(path.join(repo, 'a.txt'))).text, /^\+two$/m);
    assert.match((await insights.diff(path.join(repo, 'new.txt'))).text, /^\+fresh$/m);
    await assert.rejects(stat(marker));
    assert.deepEqual(await readFile(path.join(repo, '.git/index')), index);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('maps folder sizes within limits', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'folder-map-'));
  try {
    await mkdir(path.join(folder, 'sub'));
    await writeFile(path.join(folder, 'sub/big.bin'), Buffer.alloc(5000));
    await writeFile(path.join(folder, 'small.txt'), 'x');
    const map = await folderMap(folder);
    assert.equal(map.complete, true);
    assert.deepEqual(map.children.map(item => [item.name, item.size]), [['sub', 5000], ['small.txt', 1]]);
    assert.equal((await folderMap(folder, { maxFiles: 0 })).complete, false);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('collects the files an agent read and wrote', () => {
  const cwd = path.resolve('/work');
  const events = fileActivity([
    { timestamp: 't1', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.js' } }] } },
    { isSidechain: true, message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'skip.js' } }] } },
    { timestamp: 't2', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'b.js' } }] } },
  ], 'claude', cwd);
  assert.deepEqual(events, [{ path: path.join(cwd, 'a.js'), kind: 'read', at: 't1' }, { path: path.join(cwd, 'b.js'), kind: 'write', at: 't2' }]);
  const codex = fileActivity([{ type: 'response_item', timestamp: 't3', payload: { type: 'custom_tool_call', input: '*** Update File: src/x.js\n' } }], 'codex', cwd);
  assert.deepEqual(codex.map(item => item.path), [path.join(cwd, 'src/x.js')]);
});
