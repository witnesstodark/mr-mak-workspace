import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { GAME_PATH, GameRunner, gameConfig, gameSetupPrompt, readGame, saveGame } from '../game-run.mjs';

test('game settings keep only a command, a project folder and a local preview address', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-game-'));
  assert.equal((await readGame(folder)).config, null);
  const saved = await saveGame(folder, { command: 'npm run dev', cwd: 'web', url: 'http://localhost:5173', extra: 'dropped' });
  assert.deepEqual(saved.config, { command: 'npm run dev', cwd: 'web', url: 'http://localhost:5173' });
  assert.equal(saved.path, path.join(folder, GAME_PATH));
  assert.throws(() => gameConfig({ command: '' }, folder), /command/);
  assert.throws(() => gameConfig({ command: 'x', cwd: '../outside' }, folder), /inside the project/);
  assert.throws(() => gameConfig({ command: 'x', url: 'https://example.com' }, folder), /local http/);
  assert.throws(() => gameConfig({ command: 'a\nb' }, folder), /one line/);
  await writeFile(path.join(folder, GAME_PATH), '{ not json');
  assert.match((await readGame(folder)).error, /not valid JSON/);
  assert.match(gameSetupPrompt(saved.path, folder), /game\.json/);
  assert.ok(gameSetupPrompt(saved.path, folder).includes(folder));
});

test('the runner starts the project command, keeps its output and reports its exit', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-game-'));
  await mkdir(path.join(folder, 'sub'));
  await saveGame(folder, { command: `node -e "console.log('hello from ' + require('path').basename(process.cwd())); process.exit(3)"`, cwd: 'sub' });
  const runner = new GameRunner();
  const finished = new Promise(resolve => runner.on('changed', () => { if (!runner.status(folder).running) resolve(); }));
  assert.equal((await runner.run(folder)).running, true);
  await finished;
  const status = runner.status(folder);
  assert.equal(status.exitCode, 3);
  assert.ok(status.output.includes('hello from sub'), status.output.join('\n'));
});

test('the runner stops a running game and refuses a project without a command', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-game-'));
  const runner = new GameRunner();
  await assert.rejects(runner.run(folder), /no game command/);
  await saveGame(folder, { command: `node -e "setInterval(() => {}, 1000)"` });
  await runner.run(folder);
  assert.equal((await runner.run(folder)).running, true, 'a second run keeps the first');
  const stopped = once(runner, 'changed');
  await runner.stop(folder);
  await stopped;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(runner.status(folder).running, false);
});

test('chats sharing a folder each keep the project whose game they run', async () => {
  const { createService } = await import('../server.mjs');
  await mkdir('.cache', { recursive: true });
  const repo = await mkdtemp(path.resolve('.cache/game-folder-'));
  const game = path.join(repo, 'games', 'blended');
  await mkdir(path.join(repo, 'workspace'), { recursive: true });
  await mkdir(game, { recursive: true });
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  await saveGame(game, { command: 'node blended.js' });
  let service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });
  const call = (route, data, method = data ? 'POST' : 'GET') => fetch(service.origin + route, { method, headers: { Authorization: `Bearer ${service.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }).then(async response => ({ status: response.status, value: await response.json() }));
  try {
    const blended = await service.sessions.create({ agent: 'shell', name: 'Blended', cwd: repo });
    const other = await service.sessions.create({ agent: 'shell', name: 'Channel', cwd: repo });
    const chosen = await call(`/api/sessions/${blended.id}`, { gameFolder: game }, 'PATCH');
    assert.equal(chosen.status, 200);
    assert.equal(path.resolve(chosen.value.gameFolder), path.resolve(await import('node:fs/promises').then(fs => fs.realpath(game))));
    assert.equal(service.sessions.get(other.id).gameFolder, null);
    assert.equal((await call(`/api/sessions/${other.id}`, { gameFolder: path.join(repo, 'missing') }, 'PATCH')).status >= 400, true);
    // The setup request goes to the chosen project, not the shared folder.
    const writes = [];
    service.sessions.input = (id, text) => { writes.push(text); return { sent: true }; };
    await call('/api/game/setup', { id: blended.id });
    assert.ok(writes.join('').includes(path.join('blended', '.agents', 'game.json')), writes.join(''));
    await service.close();
    service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });
    assert.ok(service.sessions.get(blended.id).gameFolder.endsWith('blended'));
    assert.equal(service.sessions.get(other.id).gameFolder, null);
    // Back to the chat's own folder.
    assert.equal((await call(`/api/sessions/${blended.id}`, { gameFolder: null }, 'PATCH')).value.gameFolder, null);
  } finally { await service.close(); }
});
