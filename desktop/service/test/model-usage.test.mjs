import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('the model routes offer Claude models, refuse other agents and keep a stopped chat unchanged', async t => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const repo = await mkdtemp(path.join(root, '.cache', 'model-routes-'));
  await mkdir(path.join(repo, 'ui'));
  await writeFile(path.join(repo, 'ui', 'index.html'), '<html></html>');
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace', 'workspace.json'), '{"entities":[]}');
  const home = await mkdtemp(path.join(root, '.cache', 'model-routes-home-'));
  const prior = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  t.after(() => { if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prior; });
  const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });
  t.after(() => service.close());
  const add = (id, agent, running) => {
    const session = service.sessions.make({ id, name: id, agent, cwd: repo, status: running ? 'running' : 'stopped', open: true, createdAt: new Date().toISOString(), cols: 90, rows: 30, tabOrder: 0 });
    if (running) session.process = { write() {}, resize() {}, kill() {}, onExit() { return { dispose() {} }; } };
    service.sessions.items.set(id, session);
    return session;
  };
  add('claude-chat', 'claude', false);
  add('codex-chat', 'codex', true);
  const request = (url, data) => fetch(service.origin + '/api' + url, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });

  const claude = await (await request('/sessions/claude-chat/models')).json();
  assert.equal(claude.supported, true);
  assert.deepEqual(claude.models.map(item => item.id), ['opus', 'sonnet', 'haiku']);
  assert.deepEqual(claude.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal((await (await request('/sessions/codex-chat/models')).json()).supported, false);

  const codex = await request('/sessions/codex-chat/model', { model: 'gpt-6' });
  assert.equal(codex.status, 400); assert.match((await codex.json()).error, /own terminal picker/);
  const stopped = await request('/sessions/claude-chat/model', { model: 'sonnet' });
  assert.equal(stopped.status, 400); assert.match((await stopped.json()).error, /Resume it/);
  assert.equal(service.sessions.get('claude-chat').model, undefined);
});
