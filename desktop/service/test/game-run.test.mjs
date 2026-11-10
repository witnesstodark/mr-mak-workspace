import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { GAME_PATH, GameApprovals, GameRunner, commandWords, describeGame, gameConfig, gameDigest, gamePlan, gameSetupPrompt, readGame, saveGame } from '../game-run.mjs';
import { sleep } from '../util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const project = async () => realpath(await mkdtemp(path.join(os.tmpdir(), 'mrmak-game-')));
const text = file => { try { return String(readFileSync(file)); } catch { return ''; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check, ms = 8000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('Timed out'); await sleep(50); } };
// A runner whose approvals live in a fresh Mr. Mak state folder.
const runner = async (options = {}) => new GameRunner({ approvals: new GameApprovals(path.join(await project(), 'game-approvals.json')), ...options });
const approved = async (games, folder, options = {}) => {
  const { launch } = await describeGame(folder, games.approvals);
  return games.run(folder, { approve: launch.digest, ...options });
};

test('game settings keep only a command, a project folder and a local preview address', async () => {
  const folder = await project();
  assert.equal((await readGame(folder)).config, null);
  const saved = await saveGame(folder, { command: 'npm run dev', cwd: 'web', url: 'http://localhost:5173', extra: 'dropped' });
  assert.deepEqual(saved.config, { command: 'npm run dev', cwd: 'web', url: 'http://localhost:5173' });
  assert.equal(saved.path, path.join(folder, GAME_PATH));
  assert.throws(() => gameConfig({ command: '' }, folder), /command/);
  assert.throws(() => gameConfig([], folder), /JSON object/);
  assert.throws(() => gameConfig({ command: 42 }, folder), /one line/);
  assert.throws(() => gameConfig({ command: 'x', cwd: ['web'] }, folder), /one line/);
  assert.throws(() => gameConfig({ command: 'x'.repeat(2001) }, folder), /2000 characters/);
  assert.throws(() => gameConfig({ command: 'x', cwd: '../outside' }, folder), /inside the project/);
  assert.throws(() => gameConfig({ command: 'x', cwd: path.join(folder, 'web') }, folder), /inside the project/);
  assert.throws(() => gameConfig({ command: 'x', url: 'https://example.com' }, folder), /local http/);
  assert.throws(() => gameConfig({ command: 'x', url: 'http://localhost.example.com' }, folder), /local http/);
  assert.throws(() => gameConfig({ command: 'a\nb' }, folder), /one line/);
  await writeFile(path.join(folder, GAME_PATH), '{ not json');
  assert.match((await readGame(folder)).error, /not valid JSON/);
  await writeFile(path.join(folder, GAME_PATH), '\uFEFF{"command":"godot --path ."}');
  assert.deepEqual((await readGame(folder)).config, { command: 'godot --path .' });
  await writeFile(path.join(folder, GAME_PATH), JSON.stringify({ command: 'x', padding: 'x'.repeat(17000) }));
  assert.match((await readGame(folder)).error, /small JSON/);
  const prompt = gameSetupPrompt(saved.path, folder, '/mrmak/game-run.md');
  assert.ok(prompt.includes(path.join(folder, GAME_PATH)) && prompt.includes('/mrmak/game-run.md'));
  assert.match(prompt, /Do not start the game yourself/);
});

test('the command is split into a program and arguments and shell operators are refused', () => {
  assert.deepEqual(commandWords('godot --path . res://main.tscn'), ['godot', '--path', '.', 'res://main.tscn']);
  assert.deepEqual(commandWords('"C:\\Program Files\\Godot\\godot.exe" --path "my game"'), ['C:\\Program Files\\Godot\\godot.exe', '--path', 'my game']);
  assert.deepEqual(commandWords(`node -e "console.log('a & b; c')" ''`), ['node', '-e', "console.log('a & b; c')", '']);
  for (const command of ['npm run build && npm run dev', 'game.exe | tee log', 'game.exe > log.txt', 'a; b', 'echo `id`']) assert.throws(() => commandWords(command), /without a shell/, command);
  assert.throws(() => commandWords('"unclosed'), /unclosed quote/);
});

test('the launch runs a program from PATH directly inside the project folder', async () => {
  const folder = await project();
  await mkdir(path.join(folder, 'sub'));
  const plan = await gamePlan(folder, { command: 'node --version', cwd: 'sub' });
  assert.equal(plan.shell, false);
  assert.equal(path.basename(plan.program).toLowerCase().replace(/\.exe$/, ''), 'node');
  assert.deepEqual(plan.argv, ['--version']);
  assert.equal(plan.folder, path.join(folder, 'sub'));
  await assert.rejects(gamePlan(folder, { command: 'node', cwd: 'missing' }), /does not exist inside the project/);
  await assert.rejects(gamePlan(folder, { command: 'surely-not-a-program-mrmak' }), /cannot find the program/);
  // A link inside the project that leads out of it is not a game folder.
  const outside = await project();
  await symlink(outside, path.join(folder, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(gamePlan(folder, { command: 'node', cwd: 'escape' }), /inside the project/);
});

test('a Windows batch script runs through cmd.exe with quoted arguments', { skip: process.platform !== 'win32' }, async () => {
  const folder = await project();
  await writeFile(path.join(folder, 'start.cmd'), '@echo off\r\necho batch says %~1\r\n');
  const plan = await gamePlan(folder, { command: 'start.cmd "two words"' });
  assert.equal(plan.shell, true);
  assert.deepEqual(plan.argv.slice(0, 4), ['/d', '/v:off', '/s', '/c']);
  assert.equal(plan.argv[4], `""${path.join(folder, 'start.cmd')}" "two words""`);
  await assert.rejects(gamePlan(folder, { command: 'start.cmd %PATH%' }), /cannot contain/);
  await saveGame(folder, { command: 'start.cmd "two words"' });
  const games = await runner();
  await approved(games, folder);
  await until(() => !games.status(folder).running);
  assert.ok(games.status(folder).output.includes('batch says two words'), games.status(folder).output.join('\n'));
});

test('nothing runs until the owner confirms the exact command, and a changed file asks again', async () => {
  const folder = await project(), state = path.join(await project(), 'game-approvals.json');
  await saveGame(folder, { command: `node -e "require('fs').writeFileSync('ran.txt', 'yes')"` });
  const games = new GameRunner({ approvals: new GameApprovals(state) });
  const first = await describeGame(folder, games.approvals);
  assert.equal(first.launch.approved, false);
  assert.equal(first.launch.changed, false);
  assert.equal(first.launch.shell, false);
  assert.deepEqual(first.launch.args, ['-e', "require('fs').writeFileSync('ran.txt', 'yes')"]);
  await assert.rejects(games.run(folder), error => error.status === 409 && error.confirm === true);
  await assert.rejects(games.run(folder, { approve: 'not-the-digest' }), /changed after you saw it/);
  await sleep(300);
  await assert.rejects(readFile(path.join(folder, 'ran.txt')), 'nothing ran without a confirmation');
  await games.run(folder, { approve: first.launch.digest });
  await until(() => !games.status(folder).running);
  assert.equal(await readFile(path.join(folder, 'ran.txt'), 'utf8'), 'yes');
  // The confirmation is kept in Mr. Mak's state, not in the repository.
  assert.match(await readFile(state, 'utf8'), new RegExp(first.launch.digest));
  const later = new GameRunner({ approvals: new GameApprovals(state) });
  assert.equal((await describeGame(folder, later.approvals)).launch.approved, true);
  await later.run(folder);
  await until(() => !later.status(folder).running);
  // An agent or a pull changes the file: the new command needs its own confirmation.
  await saveGame(folder, { command: `node -e "require('fs').writeFileSync('ran.txt', 'changed')"` });
  const changed = await describeGame(folder, later.approvals);
  assert.deepEqual([changed.launch.approved, changed.launch.changed], [false, true]);
  await assert.rejects(later.run(folder, { approve: first.launch.digest }), /changed after you saw it/);
  // The same file in another project is not confirmed by this one.
  const clone = await project();
  await saveGame(clone, { command: `node -e "require('fs').writeFileSync('ran.txt', 'yes')"` });
  assert.notEqual(gameDigest(clone, (await readGame(clone)).config), first.launch.digest);
  assert.equal((await describeGame(clone, later.approvals)).launch.approved, false);
});

test('the runner keeps its output, reports its exit and limits lines', async () => {
  const folder = await project();
  await mkdir(path.join(folder, 'sub'));
  await writeFile(path.join(folder, 'sub', 'noisy.js'), "console.log('hello from ' + require('path').basename(process.cwd())); console.log('x'.repeat(3000)); for (let i = 0; i < 500; i++) console.log('line ' + i); process.exit(3);");
  await saveGame(folder, { command: 'node noisy.js', cwd: 'sub' });
  const games = await runner();
  assert.equal((await approved(games, folder)).running, true);
  await until(() => !games.status(folder).running);
  const status = games.status(folder);
  assert.equal(status.exitCode, 3);
  assert.equal(status.output.length, 200);
  assert.equal(status.output.at(-1), 'line 499');
  assert.ok(status.output.every(line => line.length <= 1001));
});

test('Stop ends the whole process tree and a closed service leaves no game behind', async () => {
  const folder = await project();
  await writeFile(path.join(folder, 'tree.js'), "const { spawn } = require('child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('fs').writeFileSync('child.pid', String(child.pid)); setInterval(() => {}, 1000);");
  await saveGame(folder, { command: 'node tree.js' });
  const games = await runner();
  await assert.rejects(games.run(await project()), /no game command/);
  const started = await approved(games, folder, { sessionId: 'chat-1' });
  assert.equal((await games.run(folder)).pid, started.pid, 'a second run keeps the first');
  const childPid = () => Number(text(path.join(folder, 'child.pid')));
  await until(() => childPid() > 0);
  const child = childPid();
  assert.ok(alive(child));
  await games.stopSession('another-chat');
  assert.equal(games.status(folder).running, true, 'another chat closing leaves the game running');
  await games.stopSession('chat-1');
  assert.equal(games.status(folder).running, false);
  await until(() => !alive(child) && !alive(started.pid));

  await games.run(folder);
  await until(() => childPid() > 0 && childPid() !== child);
  const second = childPid();
  await games.close();
  await until(() => !alive(second));
  await assert.rejects(games.run(folder), /closing/);
});

test('a game is stopped when it runs past its time limit', async () => {
  const folder = await project();
  await saveGame(folder, { command: `node -e "setInterval(() => {}, 1000)"` });
  const games = await runner({ maxRunMs: 400 });
  await approved(games, folder);
  await until(() => !games.status(folder).running);
  assert.match(games.status(folder).output.join('\n'), /Stopped after/);
});

test('chats keep their game project, routes need the token and only a confirmed Run starts a game', async () => {
  const { createService } = await import('../server.mjs');
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'game-folder-'));
  const game = path.join(repo, 'games', 'blended');
  await mkdir(path.join(repo, 'workspace'), { recursive: true });
  await mkdir(game, { recursive: true });
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  await writeFile(path.join(game, 'game.cjs'), "require('fs').writeFileSync('started.txt', 'yes'); setInterval(() => {}, 1000);");
  await saveGame(game, { command: 'node game.cjs' });
  const start = () => createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } }).then(value => {
    // Fake terminals: nothing but the game is started.
    value.sessions.launch = async session => {
      let exited;
      session.status = 'running';
      session.process = { resize() {}, write() {}, onExit(callback) { exited = callback; return { dispose() {} }; }, kill() { session.process = null; session.status = 'stopped'; exited?.(); } };
      value.sessions.changed(session);
    };
    value.sessions.requestStop = session => session.process?.kill();
    return value;
  });
  let service = await start();
  const call = (route, data, method = data ? 'POST' : 'GET', token = service.token) => fetch(service.origin + route, { method, headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }).then(async response => ({ status: response.status, value: await response.json() }));
  try {
    const blended = await service.sessions.create({ agent: 'codex', name: 'Blended', cwd: repo });
    const other = await service.sessions.create({ agent: 'shell', name: 'Channel', cwd: repo });
    assert.equal((await call(`/api/game?id=${blended.id}`, undefined, 'GET', 'wrong')).status, 401);
    assert.equal((await call('/api/game/run', { id: blended.id }, 'POST', 'wrong')).status, 401);
    const chosen = await call(`/api/sessions/${blended.id}`, { gameFolder: game }, 'PATCH');
    assert.equal(chosen.status, 200);
    assert.equal(path.resolve(chosen.value.gameFolder), await realpath(game));
    assert.equal(service.sessions.get(other.id).gameFolder, null);
    assert.ok((await call(`/api/sessions/${other.id}`, { gameFolder: path.join(repo, 'missing') }, 'PATCH')).status >= 400);
    // Reading the panel never starts the game.
    const shown = await call(`/api/game?id=${blended.id}`);
    assert.equal(shown.value.config.command, 'node game.cjs');
    assert.equal(shown.value.launch.approved, false);
    assert.equal(shown.value.status.running, false);
    assert.equal((await call(`/api/game?id=${other.id}`)).value.config, null);
    const refused = await call('/api/game/run', { id: blended.id });
    assert.equal(refused.status, 409);
    await sleep(300);
    await assert.rejects(readFile(path.join(game, 'started.txt')));
    // The setup request goes to the chosen project, and never to a shell.
    const writes = [];
    const input = service.sessions.input.bind(service.sessions);
    service.sessions.input = (id, text, options) => { writes.push(text); return id === blended.id ? { sent: true } : input(id, text, options); };
    assert.equal((await call('/api/game/setup', { id: blended.id })).status, 200);
    assert.ok(writes.join('').includes(path.join('blended', '.agents', 'game.json')), writes.join(''));
    assert.ok(writes.join('').includes(path.join('mrmak-chat-features', 'references', 'game-run.md')));
    assert.equal((await call('/api/game/setup', { id: other.id })).status, 400);
    const ran = await call('/api/game/run', { id: blended.id, approve: shown.value.launch.digest });
    assert.equal(ran.status, 200);
    assert.equal(ran.value.status.running, true);
    await until(() => text(path.join(game, 'started.txt')) === 'yes');
    const pid = ran.value.status.pid;
    // Closing the chat that started the game stops it.
    assert.equal((await call(`/api/sessions/${blended.id}`, {}, 'DELETE')).status, 200);
    await until(() => !alive(pid));
    // A command the owner writes in the panel is confirmed by saving it.
    const saved = await call('/api/game', { id: other.id, config: { command: 'node --version' } });
    assert.equal(saved.status, 200);
    assert.equal(saved.value.launch.approved, true);
    assert.equal((await call('/api/game', { id: other.id, config: { command: 'a && b' } })).status, 400);
    await service.close();
    service = await start();
    assert.ok(service.sessions.get(blended.id).gameFolder.endsWith('blended'));
    assert.equal(service.sessions.get(other.id).gameFolder, null);
    assert.equal((await call(`/api/sessions/${blended.id}`, { gameFolder: null }, 'PATCH')).value.gameFolder, null);
  } finally { await service.close(); }
});
