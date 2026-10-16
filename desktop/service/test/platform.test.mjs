import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { commandSearchRoots, invalidFilename, macLocale, ptyOptions, resolveCommand, shellCommand, shellLabel, terminateProcessTree } from '../platform.mjs';
import { expandHome } from '../util.mjs';

test('platform policy preserves POSIX names while retaining Windows-safe validation', () => {
  assert.equal(invalidFilename('notes:linux.md'), process.platform === 'win32');
  assert.equal(invalidFilename('notes.md'), false);
  assert.equal(invalidFilename('../escape.md'), true);
  assert.equal(shellLabel(), process.platform === 'win32' ? 'PowerShell' : 'Shell');
  assert.ok(shellCommand().file);
  // Agent chats start through PowerShell even when its folder is missing from PATH.
  if (process.platform === 'win32') assert.equal(shellCommand({ SystemRoot: 'D:\\Windows' }).file, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal('useConpty' in ptyOptions({ cwd: process.cwd(), env: process.env, cols: 80, rows: 24 }), process.platform === 'win32');
  // The macOS Shell tab is a login shell, like Terminal.app.
  if (process.platform !== 'win32') assert.deepEqual(shellCommand({ SHELL: '/bin/zsh' }), { file: '/bin/zsh', args: process.platform === 'darwin' ? ['-l'] : [] });
});

test('Mac children get a UTF-8 locale only when none is set', () => {
  assert.deepEqual(macLocale({}), process.platform === 'darwin' ? { LANG: 'en_US.UTF-8' } : {});
  assert.deepEqual(macLocale({ LC_CTYPE: 'tr_TR.UTF-8' }), process.platform === 'darwin' ? { LC_CTYPE: 'tr_TR.UTF-8' } : {});
});

test('typed home folders expand without changing other tildes', () => {
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('~/Projects/game'), path.join(os.homedir(), 'Projects', 'game'));
  assert.equal(expandHome('~other/Projects'), '~other/Projects');
  assert.equal(expandHome('notes/~/draft'), 'notes/~/draft');
  assert.equal(expandHome(undefined), undefined);
});

test('OpenCode install directory is included in command lookup roots', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mrmak-command-home-'));
  const bin = path.join(home, '.opencode', 'bin');
  await mkdir(bin, { recursive: true });
  const executable = path.join(bin, 'opencode');
  await writeFile(executable, '', { mode: 0o755 });

  assert.ok(commandSearchRoots({}, home).includes(bin));
  assert.equal(resolveCommand('opencode', { PATH: '' }, home), executable);
});

test('command lookup never resolves empty PATH entries, folders or non-executables against the current folder', { skip: process.platform === 'win32' && 'uses the POSIX execute bit' }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mrmak-command-cwd-'));
  const bin = path.join(home, '.opencode', 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'opencode'), '', { mode: 0o755 });
  const shadow = path.join(home, 'shadow');
  await mkdir(path.join(shadow, 'opencode'), { recursive: true });
  await writeFile(path.join(shadow, 'codex'), '', { mode: 0o644 });
  const previous = process.cwd();
  process.chdir(shadow);
  try {
    assert.equal(resolveCommand('opencode', { PATH: ':' }, home), path.join(bin, 'opencode'));
    assert.equal(resolveCommand('codex', { PATH: `:${shadow}` }, home), null);
    assert.equal(resolveCommand(path.join(shadow, 'codex'), {}, home), null);
  } finally { process.chdir(previous); }
});

test('POSIX process-tree termination also stops children of a non-leader launcher', { skip: process.platform === 'win32' && 'Windows uses taskkill /T' }, async () => {
  // Like the MCP SDK, spawn without `detached`: the launcher shares this process group.
  const launcher = spawn('/bin/sh', ['-c', 'sleep 377 & echo $!; wait'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const grandchild = Number(await new Promise(resolve => launcher.stdout.once('data', resolve)));
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    assert.ok(alive(grandchild));
    await terminateProcessTree(launcher.pid, { force: true });
    for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(alive(grandchild), false, 'The launcher\'s child is stopped too');
  } finally { try { process.kill(grandchild, 'SIGKILL'); } catch { /* Already stopped. */ } }
});
