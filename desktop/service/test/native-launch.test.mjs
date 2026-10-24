import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { wrapCommand } from '../agents.mjs';
import { shellCommand } from '../platform.mjs';
import { attachmentText } from '../attachments.mjs';

test('Windows native executables receive literal arguments without a PowerShell wrapper', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mrmak owner's launch-"));
  const exe = path.join(folder, 'agent fixture.exe');
  const script = path.join(folder, 'record arguments.mjs');
  const output = path.join(folder, 'arguments.json');
  await copyFile(process.execPath, exe);
  await writeFile(script, 'import fs from "node:fs"; fs.writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3))); console.log("Arguments recorded"); setTimeout(() => process.exit(0), 200);');
  const literals = ['two words', "owner's folder", 'a"quote', '$(do-not-execute)', 'a&b', 'trailing space\\', '--resume', '019a0000-1111-4222-8333-444455556666'];
  const command = wrapCommand(exe, [script, output, ...literals]);
  assert.equal(command.file, exe);
  assert.ok(!command.args.includes('-EncodedCommand'));
  await promisify(execFile)(command.file, command.args, { cwd: folder, windowsHide: true, timeout: 10000 });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), literals);
});

test('Windows command shims still use the full PowerShell path and quote literal arguments', { skip: process.platform !== 'win32' }, () => {
  for (const extension of ['cmd', 'bat', 'ps1']) {
    const command = wrapCommand(`C:/tools/agent.${extension}`, ["owner's folder", '$(do-not-execute)']);
    assert.equal(command.file, shellCommand().file);
    const script = Buffer.from(command.args.at(-1), 'base64').toString('utf16le');
    assert.ok(script.includes("'owner''s folder'"));
    assert.ok(script.includes("'$(do-not-execute)'"));
  }
});

test('PowerShell shim arguments and pasted paths preserve all apostrophe delimiters without evaluating them', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-smart-quotes-'));
  const shim = path.join(folder, 'record.ps1');
  await writeFile(shim, '[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); ConvertTo-Json -Compress -InputObject @($args)', 'utf8');
  const literals = ["'", '\u2018', '\u2019', '\u201a', '\u201b'].map(quote => `left${quote}; Write-Output EVALUATED; #right`);
  const command = wrapCommand(shim, literals);
  const result = await promisify(execFile)(command.file, command.args, { windowsHide: true, timeout: 10000, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result.stdout), literals);
  const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); function Record { ConvertTo-Json -Compress -InputObject @($args) }; Record ${attachmentText(literals, 'shell')}`;
  const pasted = await promisify(execFile)(shellCommand().file, ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(pasted.stdout), literals);
});
