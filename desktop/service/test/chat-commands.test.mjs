import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { chatCommands } from '../chat-commands.mjs';
import { commandToken, completeCommand, matchingCommands, terminalCommand } from '../../../src/desktop/commandSuggestions.ts';

test('the composer finds the command word at the caret and completes it', () => {
  const list = [
    { trigger: '/', name: 'compact', description: '', source: 'built-in' }, { trigger: '/', name: 'model', description: '', source: 'built-in', terminal: true },
    { trigger: '/', name: 'tools:compare', description: '', source: 'plugin' }, { trigger: '$', name: 'level-pass', description: '', source: 'project' },
  ];
  assert.deepEqual(commandToken('/com', 4, false), { trigger: '/', start: 0, end: 4, query: 'com' });
  assert.equal(commandToken('fix /com', 8, false), null, 'a slash command only opens the message');
  assert.equal(commandToken('/com more', 2, false), null, 'the caret must end the word');
  assert.equal(commandToken('use $lev', 8, false), null, 'skills with $ are Codex only');
  assert.deepEqual(commandToken('use $lev', 8, true), { trigger: '$', start: 4, end: 8, query: 'lev' });
  assert.deepEqual(matchingCommands(list, commandToken('/com', 4, false)).map(item => item.name), ['compact', 'tools:compare']);
  assert.deepEqual(matchingCommands(list, commandToken('/', 1, false)).map(item => item.name), ['compact', 'model', 'tools:compare']);
  assert.deepEqual(completeCommand('use $lev now', commandToken('use $lev now', 8, true), list[3]), { text: 'use $level-pass now', caret: 16 });
  assert.equal(terminalCommand(list, ' /model'), true);
  assert.equal(terminalCommand(list, '/compact keep tests'), false);
});

async function put(file, text) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); }

test('chat commands list built-ins, project and user commands, skills and enabled plugins per CLI', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mrmak-commands-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), repo = path.join(root, 'repo'), cwd = path.join(repo, 'game');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await put(path.join(cwd, '.claude', 'skills', 'balance', 'SKILL.md'), '---\nname: balance-pass\ndescription: >\n  Tune combat\n  numbers\n---\nBody');
  await put(path.join(repo, '.claude', 'commands', 'ship.md'), '# Ship\nPrepare a release build.');
  await put(path.join(repo, '.claude', 'skills', 'balance', 'SKILL.md'), '---\nname: balance-pass\ndescription: Outer copy\n---');
  await put(path.join(home, '.claude', 'skills', 'notes', 'SKILL.md'), '---\ndescription: "Keep notes"\n---');
  await put(path.join(home, '.claude', 'skills', 'empty-folder', 'README.md'), 'not a skill');
  const plugin = path.join(home, 'plugin-a');
  await put(path.join(plugin, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Plugin review\n---');
  await put(path.join(home, 'plugin-b', 'skills', 'hidden', 'SKILL.md'), '---\nname: hidden\n---');
  await put(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'tools@market': [{ installPath: plugin }], 'off@market': [{ installPath: path.join(home, 'plugin-b') }] } }));
  await put(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'tools@market': true, 'off@market': false } }));
  await put(path.join(repo, '.agents', 'skills', 'level', 'SKILL.md'), '---\nname: level-pass\ndescription: Lay out a level\n---');
  await put(path.join(home, '.codex', 'prompts', 'triage.md'), 'Triage the open issues.');

  const claude = (await chatCommands('claude', cwd, { home, env: {} })).commands;
  const find = (list, name) => list.find(item => item.name === name);
  assert.deepEqual(find(claude, 'balance-pass'), { trigger: '/', name: 'balance-pass', description: 'Tune combat numbers', source: 'project' });
  assert.equal(find(claude, 'ship').description, 'Prepare a release build.');
  assert.equal(find(claude, 'notes').description, 'Keep notes');
  assert.equal(find(claude, 'tools:review').source, 'plugin');
  assert.equal(find(claude, 'model').terminal, true);
  assert.equal(find(claude, 'compact').terminal, undefined);
  assert.ok(!find(claude, 'empty-folder') && !find(claude, 'off:hidden') && !find(claude, 'level-pass'));
  assert.equal(claude.filter(item => item.name === 'balance-pass').length, 1);

  const codex = (await chatCommands('codex', cwd, { home, env: {} })).commands;
  assert.deepEqual(find(codex, 'level-pass'), { trigger: '$', name: 'level-pass', description: 'Lay out a level', source: 'project' });
  assert.equal(find(codex, 'prompts:triage').trigger, '/');
  assert.ok(find(codex, 'permissions').terminal && !find(codex, 'approvals') && !find(codex, 'balance-pass'));

  assert.deepEqual(await chatCommands('shell', cwd, { home, env: {} }), { commands: [] });
});
