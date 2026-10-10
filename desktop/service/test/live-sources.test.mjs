import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { LiveSources, validateLiveSources, validateInputs, matchesInput } from '../live-sources.mjs';
import { createService } from '../server.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await sleep(20); }
  assert.fail('Timed out waiting for live source.');
}
const builder = `
import { readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
const mode = JSON.parse(await readFile('mode.json', 'utf8'));
if (process.argv.includes('--list-inputs')) {
  console.log(await readFile('inputs.json', 'utf8'));
} else {
  const out = process.argv[process.argv.indexOf('--out') + 1];
  await appendFile('runs.jsonl', JSON.stringify({ type: 'start', pid: process.pid, at: Date.now() }) + '\\n');
  if (mode.hold) setInterval(() => {}, 1000);
  else setTimeout(async () => {
    if (mode.fail) {
      process.stderr.write('older diagnostic\\n' + 'x'.repeat(4096) + '\\nDocs/Broken.md:42: missing link target\\n');
      process.exitCode = 1;
    } else {
      await writeFile(path.join(out, 'index.tmp'), '<!doctype html><html><head></head><body>' + mode.text + '</body></html>');
      await rename(path.join(out, 'index.tmp'), path.join(out, 'index.html'));
    }
    await appendFile('runs.jsonl', JSON.stringify({ type: 'end', pid: process.pid, at: Date.now() }) + '\\n');
  }, mode.delay || 0);
}
`;
async function fixture(t, { quietMs = 100, actualWatch = false, ...options } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mrmak-live-test-'));
  const project = path.join(root, 'project'), stateDir = path.join(root, 'state');
  await mkdir(path.join(project, 'Docs'), { recursive: true }); await mkdir(stateDir);
  const inputFile = path.join(project, 'only.json');
  await writeFile(inputFile, '{}');
  const inputs = { dirs: [{ path: path.join(project, 'Docs'), recursive: true, extensions: ['.md', '.html'] }], files: [inputFile] };
  const config = [{ id: 'test-codex', label: 'Test Codex', project, python: process.execPath, args: ['builder.mjs'] }];
  await writeFile(path.join(project, 'builder.mjs'), builder);
  await writeFile(path.join(project, 'inputs.json'), JSON.stringify(inputs));
  const mode = async value => writeFile(path.join(project, 'mode.json'), JSON.stringify({ text: 'good page', ...value }));
  await mode({}); await writeFile(path.join(stateDir, 'live-sources.json'), JSON.stringify(config));
  const watches = [], states = [];
  const watchInput = (directory, settings, callback) => {
    const watcher = new EventEmitter(); Object.assign(watcher, { directory, settings, callback, closed: false });
    watcher.close = () => { watcher.closed = true; }; watches.push(watcher); return watcher;
  };
  const manager = new LiveSources({ stateDir, files: { origin: 'http://127.0.0.1:1234', grant: () => 'grant' }, quietMs, ...options, changed: source => states.push(source), ...(actualWatch ? {} : { watchInput }) });
  const runs = async () => (await readFile(path.join(project, 'runs.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const starts = async () => (await runs()).filter(run => run.type === 'start');
  const trigger = filename => { for (const watcher of watches.filter(item => !item.closed && item.directory === path.dirname(inputFile))) watcher.callback('rename', filename ?? path.basename(inputFile)); };
  const ready = () => until(() => manager.list()[0]?.state === 'ready');
  t.after(async () => { await manager.close(); await rm(root, { recursive: true, force: true }); });
  return { root, project, stateDir, inputFile, inputs, config, manager, mode, runs, starts, trigger, ready, watches, states };
}

test('configuration validates IDs, absolute existing folders, executable and string arguments', async t => {
  const { config, root, stateDir } = await fixture(t);
  assert.deepEqual(await validateLiveSources(config), config);
  for (const bad of [null, {}, [null], [ { ...config[0], id: '../escape' } ], [ { ...config[0], id: 'Upper' } ], [...config, ...config], [{ ...config[0], project: '.' }], [{ ...config[0], project: path.join(root, 'missing') }], [{ ...config[0], project: path.join(stateDir, 'live-sources.json') }], [{ ...config[0], args: ['ok', 2] }], [{ ...config[0], args: 'string' }], [{ ...config[0], args: ['--out=elsewhere'] }], [{ ...config[0], python: '' }], [{ ...config[0], label: '' }]]) await assert.rejects(validateLiveSources(bad));
  const absent = new LiveSources({ stateDir: path.join(root, 'absent'), files: {} });
  await absent.init(); assert.deepEqual(absent.list(), []); await absent.close();
});

test('input filtering respects recursion, extensions and exact files', () => {
  const root = path.resolve('test-inputs');
  const inputs = validateInputs({ dirs: [{ path: root, recursive: false, extensions: ['.md'] }], files: [path.join(root, 'data.json')] });
  assert.equal(matchesInput(inputs, root, 'A.MD'), true);
  assert.equal(matchesInput(inputs, root, 'image.png'), false);
  assert.equal(matchesInput(inputs, root, path.join('nested', 'a.md')), false);
  assert.equal(matchesInput(inputs, root, 'data.json'), true);
  assert.equal(matchesInput(inputs, root, 'other.json'), false);
  assert.equal(matchesInput(inputs, root, '../escape.md'), false);
  inputs.dirs[0].recursive = true;
  assert.equal(matchesInput(inputs, root, path.join('nested', 'a.md')), true);
  assert.equal(matchesInput(inputs, root, null), true);
  assert.throws(() => validateInputs({ dirs: [], files: ['relative'] }));
});

test('waits one second without changes, coalesces saves and filters unrelated events', async t => {
  const f = await fixture(t, { quietMs: 1000 }); await f.manager.init(); await f.ready();
  f.trigger('ignore.txt'); await sleep(1100); assert.equal((await f.starts()).length, 1);
  f.trigger(); await sleep(600); f.trigger(); await sleep(600);
  assert.equal((await f.starts()).length, 1);
  await until(async () => (await f.starts()).length === 2); await f.ready();
  await sleep(1100); assert.equal((await f.starts()).length, 2);
  assert.ok(f.watches.some(item => item.settings.recursive));
  assert.ok(f.watches.some(item => item.directory === f.project && !item.settings.recursive));
  assert.ok(f.watches.some(item => item.closed)); // successful builds refresh input watchers
});

test('changes during a build create one follow-up, with no overlapping processes', async t => {
  const f = await fixture(t); await f.mode({ delay: 450 }); await f.manager.init();
  await until(async () => (await f.starts()).length === 1);
  f.trigger(); f.trigger(); await sleep(180); f.trigger();
  await until(async () => (await f.starts()).length === 2); await f.ready();
  await sleep(300); assert.equal((await f.starts()).length, 2);
  const runs = await f.runs(); assert.deepEqual(runs.map(run => run.type), ['start', 'end', 'start', 'end']);
  assert.ok(runs[2].at >= runs[1].at);
});

test('multiple sources share one process queue and refresh the watch list after a build', async t => {
  const f = await fixture(t); await f.mode({ delay: 100 });
  await writeFile(path.join(f.stateDir, 'live-sources.json'), JSON.stringify([...f.config, { ...f.config[0], id: 'second-codex' }]));
  await f.manager.init(); await until(() => f.manager.list().every(source => source.state === 'ready'));
  assert.deepEqual((await f.runs()).map(run => run.type), ['start', 'end', 'start', 'end']);
  const newFile = path.join(f.project, 'new.json'); await writeFile(newFile, '{}');
  await writeFile(path.join(f.project, 'inputs.json'), JSON.stringify({ dirs: [], files: [newFile] }));
  f.trigger(); await until(async () => (await f.starts()).length === 4);
  await until(() => f.manager.list().every(source => source.state === 'ready'));
  f.trigger(); await sleep(250); assert.equal((await f.starts()).length, 4); // old input no longer matters
  f.trigger('new.json'); await until(async () => (await f.starts()).length === 6);
  await until(() => f.manager.list().every(source => source.state === 'ready'));
});

test('failed rebuild keeps the last good output, timestamp and stderr tail, then recovers', async t => {
  const f = await fixture(t); await f.manager.init(); await f.ready();
  const before = f.manager.list()[0], file = path.join(f.stateDir, 'live', 'test-codex', 'index.html'), page = await readFile(file, 'utf8');
  await f.mode({ fail: true }); f.trigger(); await until(() => f.manager.list()[0].state === 'failed');
  const failed = f.manager.list()[0]; assert.equal(failed.builtAt, before.builtAt); assert.equal(failed.url, before.url);
  assert.equal(await readFile(file, 'utf8'), page);
  assert.ok(Buffer.byteLength(failed.error) <= 2048); assert.ok(!failed.error.includes('older diagnostic'));
  assert.equal(failed.error.split('\n').at(-1), 'Docs/Broken.md:42: missing link target');
  await f.mode({ text: 'repaired' }); f.trigger(); await f.ready();
  assert.match(await readFile(file, 'utf8'), /repaired/); assert.equal(f.manager.list()[0].error, null);
});

test('parent directory watch survives replacing a single input file', async t => {
  const f = await fixture(t, { actualWatch: true }); await f.manager.init(); await f.ready();
  for (let count = 2; count <= 3; count++) {
    await writeFile(f.inputFile + '.tmp', `{"count":${count}}`); await rename(f.inputFile + '.tmp', f.inputFile);
    await until(async () => (await f.starts()).length === count); await f.ready();
  }
});

test('close stops running processes, watchers and pending rebuilds', async t => {
  const f = await fixture(t); await f.mode({ hold: true }); await f.manager.init();
  await until(async () => (await f.starts()).length === 1);
  const [{ pid }] = await f.starts(); f.trigger(); await f.manager.close();
  assert.throws(() => process.kill(pid, 0)); assert.ok(f.watches.every(item => item.closed));
  await sleep(200); assert.equal((await f.starts()).length, 1);
});

test('timeout kills a builder and reports failure', async t => {
  const f = await fixture(t, { timeoutMs: 250 }); await f.mode({ hold: true }); await f.manager.init();
  await until(() => f.manager.list()[0].state === 'failed');
  assert.match(f.manager.list()[0].error, /timed out/);
  const [{ pid }] = await f.starts(); assert.throws(() => process.kill(pid, 0));
});

test('service exposes statuses over authenticated API and events, and output through GET/HEAD grants', async t => {
  const f = await fixture(t); await f.mode({ delay: 400 }); await mkdir(path.join(f.root, 'workspace')); await writeFile(path.join(f.root, 'workspace/workspace.json'), '{"entities":[]}');
  const service = await createService({ repo: f.root, uiDir: f.root, stateDir: f.stateDir, restoreSessions: false });
  const ws = new WebSocket(service.origin.replace('http:', 'ws:') + '/events', { origin: service.origin }), events = [];
  ws.on('message', raw => events.push(JSON.parse(raw.toString())));
  try {
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'auth', token: service.token }));
    await until(() => events.some(event => event.type === 'connected'));
    const get = endpoint => fetch(service.origin + '/api/' + endpoint, { headers: { Authorization: `Bearer ${service.token}` } });
    const bootstrap = await (await get('bootstrap')).json();
    assert.equal(bootstrap.liveSources[0].id, 'test-codex');
    assert.equal((await fetch(service.origin + '/api/live-sources')).status, 401);
    await until(() => service.liveSources.list()[0].state === 'ready');
    const [source] = await (await get('live-sources')).json();
    assert.equal(source.state, 'ready'); assert.equal((await fetch(source.url + 'index.html')).status, 200);
    assert.equal((await fetch(source.url + 'index.html', { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(source.url + 'index.html', { method: 'POST' })).status, 403);
    assert.ok(events.some(event => event.type === 'connected' && event.liveSources[0].id === source.id));
    await until(() => events.some(event => event.type === 'live-source' && event.source.state === 'ready'));
    await writeFile(path.join(f.root, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'test', title: 'Test', steps: [{ name: 'Codex', source: source.id, path: 'index.html' }] }] }));
    assert.match((await service.workspace.read('test')).note, /live reader/);
  } finally { ws.terminate(); await service.close(); }
});
