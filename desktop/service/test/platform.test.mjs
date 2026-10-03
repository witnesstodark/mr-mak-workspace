import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commandSearchRoots, invalidFilename, ptyOptions, resolveCommand, shellCommand, shellLabel } from '../platform.mjs';

test('platform policy preserves POSIX names while retaining Windows-safe validation', () => {
  assert.equal(invalidFilename('notes:linux.md'), process.platform === 'win32');
  assert.equal(invalidFilename('notes.md'), false);
  assert.equal(invalidFilename('../escape.md'), true);
  assert.equal(shellLabel(), process.platform === 'win32' ? 'PowerShell' : 'Shell');
  assert.ok(shellCommand().file);
  assert.equal('useConpty' in ptyOptions({ cwd: process.cwd(), env: process.env, cols: 80, rows: 24 }), process.platform === 'win32');
});

test('OpenCode install directory is included in command lookup roots', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mrmak-command-home-'));
  const bin = path.join(home, '.opencode', 'bin');
  await mkdir(bin, { recursive: true });
  const executable = path.join(bin, 'opencode');
  await writeFile(executable, '');

  assert.ok(commandSearchRoots({}, home).includes(bin));
  assert.equal(resolveCommand('opencode', { PATH: '' }, home), executable);
});
