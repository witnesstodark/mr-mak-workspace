import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnvironment, terminalCommand } from '../agents.mjs';
import { createCursorChat, cursorResumeId } from '../cursor.mjs';
import { Sessions } from '../sessions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const id = '11111111-1111-4111-8111-111111111111';

test('Cursor launch flags resume one conversation and keep reasoning effort off the command line', async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const bin = await mkdtemp(path.join(root, '.cache', 'cursor-bin-'));
  await writeFile(path.join(bin, process.platform === 'win32' ? 'agent.cmd' : 'agent'), '', { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = bin + path.delimiter + (previous || '');
  try {
    for (const bypass of [false, true]) {
      const command = terminalCommand('cursor', { bypass, resumeId: id, effort: 'xhigh' });
      const launch = process.platform === 'win32' ? Buffer.from(command.args.at(-1), 'base64').toString('utf16le') : command.args.join(' ');
      assert.match(launch, /--resume/);
      assert.ok(launch.includes(id));
      assert.equal(launch.includes('--force'), bypass);
      assert.doesNotMatch(launch, /--effort|model_reasoning_effort|xhigh/);
    }
    assert.throws(() => terminalCommand('cursor', { resumeId: '--force' }), /conversation ID/);
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
});

test('a Cursor resume line yields the conversation id, and a parent agent session is not inherited', () => {
  assert.equal(cursorResumeId('To resume this session: agent --resume=11111111-1111-4111-8111-111111111111'), id);
  assert.equal(cursorResumeId('nothing here'), null);
  const previous = process.env.CURSOR_AGENT;
  process.env.CURSOR_AGENT = '1';
  try { assert.equal(childEnvironment(null).CURSOR_AGENT, undefined); }
  finally { if (previous === undefined) delete process.env.CURSOR_AGENT; else process.env.CURSOR_AGENT = previous; }
});

test('Cursor chat creation stores the local id and later resumes that same conversation', { skip: process.platform === 'win32' && 'uses a /bin/sh shim' }, async () => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const sandbox = await mkdtemp(path.join(root, '.cache', 'cursor-chat-'));
  const repo = path.join(sandbox, 'project');
  const stateDir = path.join(sandbox, 'state');
  const bin = path.join(sandbox, 'bin');
  await Promise.all([mkdir(repo), mkdir(stateDir), mkdir(bin)]);
  const log = path.join(sandbox, 'launches.log');
  const executable = path.join(bin, 'agent');
  await writeFile(executable, '#!/bin/sh\nif [ "$1" = "create-chat" ]; then printf "11111111-1111-4111-8111-111111111111\\n"; exit 0; fi\nprintf "%s\\n" "$*" >> "$CURSOR_TEST_LOG"\nsleep 0.15\n');
  await chmod(executable, 0o755);
  const previousPath = process.env.PATH;
  const previousLog = process.env.CURSOR_TEST_LOG;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  process.env.CURSOR_TEST_LOG = log;
  const sessions = await new Sessions(repo, stateDir).init();
  let restored;
  try {
    assert.equal(await createCursorChat(repo), id);
    const created = await sessions.create({ agent: 'cursor', name: 'Cursor Launch', cwd: repo });
    const original = sessions.get(created.id);
    assert.equal(original.nativeId, id);
    assert.equal(original.effort, undefined);
    for (let i = 0; i < 50 && original.process; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(original.process, null);
    await sessions.close();

    restored = await new Sessions(repo, stateDir).init();
    await restored.resume(created.id);
    const resumed = restored.get(created.id);
    assert.equal(resumed.nativeId, id);
    for (let i = 0; i < 50 && resumed.process; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(resumed.process, null);
    const launches = (await readFile(log, 'utf8')).trim().split('\n');
    assert.equal(launches.length, 2);
    for (const launch of launches) assert.match(launch, new RegExp(`--resume ${id}`));
  } finally {
    await sessions.close();
    await restored?.close();
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.CURSOR_TEST_LOG; else process.env.CURSOR_TEST_LOG = previousLog;
  }
});
