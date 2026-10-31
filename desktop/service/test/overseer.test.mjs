import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Overseer, stalledChats } from '../overseer.mjs';
import { coordinatorTools } from '../coordinator.mjs';

const minutes = value => new Date(Date.parse('2026-10-29T12:00:00Z') - value * 60_000).toISOString();
const now = Date.parse('2026-10-29T12:00:00Z');
const chat = (id, activity, quiet, extra = {}) => ({ id, name: id, agent: 'claude', status: 'running', activity, lastOutputAt: minutes(quiet), ...extra });

test('Overseer picks chats that stalled, once per stall', async () => {
  const chats = [chat('busy', 'working', 2), chat('hung', 'working', 20), chat('asks', 'waiting', 8), chat('done', 'idle', 60), chat('term', 'working', 60, { agent: 'shell' }), chat('stopped', 'working', 60, { status: 'stopped' })];
  assert.deepEqual(stalledChats(chats, now).map(item => [item.id, item.reason]), [['hung', 'working without output'], ['asks', 'waiting for an answer']]);
  const requests = [];
  let enabled = true;
  const overseer = new Overseer({ chats: () => chats, ask: async request => { requests.push(request); return { status: 'completed' }; }, enabled: () => enabled });
  await overseer.check(now);
  assert.equal(requests.length, 1);
  assert.match(requests[0].text, /"hung"/);
  assert.match(requests[0].text, /do not answer it/);
  assert.equal(await overseer.check(now + 1000), null, 'the same stall is not asked again');
  chats[1].lastOutputAt = minutes(15);
  await overseer.check(now + 2000);
  assert.equal(requests.length, 2, 'new output that stalls again counts as a new stall');
  enabled = false;
  chats[2].lastOutputAt = minutes(30);
  assert.equal(await overseer.check(now + 3000), null, 'off means no checks');
});

test('the coordinator MCP bridge lists the coordinator tools and forwards calls with its secret', async () => {
  const received = [];
  const server = http.createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    received.push({ key: request.headers['x-mrmak-coordinator'], ...JSON.parse(text) });
    response.end(JSON.stringify({ success: true, text: '[]' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../coordinator-mcp.mjs', import.meta.url))], { env: { ...process.env, MRMAK_COORDINATOR_URL: `http://127.0.0.1:${server.address().port}/coordinator/tool`, MRMAK_COORDINATOR_SECRET: 'key' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const answers = new Map();
  createInterface({ input: bridge.stdout }).on('line', line => { const message = JSON.parse(line); answers.get(message.id)?.(message); });
  const rpc = (id, method, params) => new Promise(resolve => { answers.set(id, resolve); bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  try {
    assert.equal((await rpc(1, 'initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name, 'mrmak-coordinator');
    assert.deepEqual((await rpc(2, 'tools/list')).result.tools.map(item => item.name), coordinatorTools.map(item => item.name));
    const called = await rpc(3, 'tools/call', { name: 'list_chats', arguments: {} });
    assert.deepEqual(called.result, { content: [{ type: 'text', text: '[]' }], isError: false });
    assert.deepEqual(received, [{ key: 'key', name: 'list_chats', arguments: {} }]);
    assert.ok((await rpc(4, 'resources/list')).error);
  } finally { bridge.kill(); server.close(); }
});
