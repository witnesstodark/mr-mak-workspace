import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rename, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { MobileGateway } from '../mobile.mjs';
import { Attachments } from '../attachments.mjs';
import { transcriptMessages } from '../mobile-transcript.mjs';
import { TailscaleTransport } from '../mobile-tailscale.mjs';
import { LiveSources } from '../live-sources.mjs';

async function fixture(t) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-mobile-'));
  await mkdir(path.join(repo, 'ui')); await writeFile(path.join(repo, 'ui/index.html'), '<html>Mobile fixture</html>');
  const sessions = new EventEmitter(), id = randomUUID();
  const session = { id, agent: 'codex', name: 'Test chat', status: 'running', cols: 100, rows: 30, process: {}, nativeId: null };
  const writes = [];
  sessions.get = value => { assert.equal(value, id); return session; };
  sessions.list = () => [session]; sessions.input = (_id, value) => writes.push(value);
  sessions.snapshot = async () => ({ session, sequence: 1, data: 'hello' });
  sessions.seen = () => {};
  const transport = { probe: async () => ({ installed: true, ready: true }), enable: async origin => ({ origin }), disable: async () => {} };
  const closed = [];
  const closeChat = async value => { assert.equal(value, id); closed.push(value); session.open = false; session.process = null; session.status = 'closed'; sessions.emit('session', session); return { closed: true, savedInHistory: true }; };
  const gateway = await new MobileGateway({ repo, uiDir: path.join(repo, 'ui'), stateDir: repo, sessions, attachments: new Attachments(repo), closeChat, settings: () => ({ defaultBypass: false }), transport }).init();
  t.after(() => gateway.close()); await gateway.enable();
  const request = async (route, data, cookie, extra = {}) => {
    const response = await fetch(`${gateway.origin}/mobile/api${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { Origin: gateway.origin, 'Content-Type': 'application/json' }), ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  const pair = async () => {
    const qr = await gateway.newPairing(), token = new URL(qr.url).hash.slice(6);
    const pending = (await request('/pair', { token, name: 'Test phone' })).data;
    await gateway.approve(pending.id);
    return { ...(await request('/pair/finish', pending)), pending, token };
  };
  return { gateway, request, pair, repo, writes, id, session, closed };
}

test('terminal navigation sends all four arrows only from a paired same-origin phone', async t => {
  const { request, pair, id, writes, session, gateway } = await fixture(t), device = await pair();
  const route = `/sessions/${id}/key`;
  assert.equal((await request(route, { key: 'left' })).status, 401);
  assert.equal((await request(route, { key: 'right' }, device.cookie, { Origin: 'https://unrelated.example' })).status, 403);
  assert.deepEqual(writes, []);
  for (const key of ['left', 'up', 'down', 'right']) assert.equal((await request(route, { key }, device.cookie)).status, 200);
  assert.deepEqual(writes, ['\x1b[D', '\x1b[A', '\x1b[B', '\x1b[C']);
  assert.equal((await request(route, { key: '\x1b[C' }, device.cookie)).status, 400);
  session.agent = 'shell';
  assert.equal((await request(route, { key: 'left' }, device.cookie)).status, 403);
  session.agent = 'codex'; await gateway.revoke(device.pending.id);
  assert.equal((await request(route, { key: 'right' }, device.cookie)).status, 401);
  assert.equal(writes.length, 4);
});

test('mobile close uses the shared close action, retains history and rejects untrusted requests', async t => {
  const { request, pair, id, session, closed } = await fixture(t), device = await pair();
  const route = `/sessions/${id}/close`;
  assert.equal((await request(route, {})).status, 401);
  assert.equal((await request(route, {}, device.cookie, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await request(route, undefined, device.cookie)).status, 404);
  session.agent = 'shell'; assert.equal((await request(route, {}, device.cookie)).status, 403);
  session.agent = 'codex'; assert.deepEqual(closed, []);
  const response = await request(route, {}, device.cookie);
  assert.equal(response.status, 200); assert.deepEqual(response.data, { closed: true, savedInHistory: true });
  assert.deepEqual(closed, [id]);
  const saved = (await request('/bootstrap', undefined, device.cookie)).data.sessions.find(item => item.id === id);
  assert.equal(saved.open, false); assert.equal(saved.name, 'Test chat');
});

test('pairing needs a one-use QR, matching origin, and explicit desktop approval', async t => {
  const { gateway, request, repo } = await fixture(t);
  assert.equal((await request('/bootstrap')).status, 401);
  assert.equal((await fetch(`${gateway.origin}/mobile/api/transcribe`, { method: 'POST', headers: { Origin: gateway.origin, 'Content-Type': 'audio/webm', 'X-Transcription-Id': randomUUID() }, body: 'not authenticated' })).status, 401);
  const qr = await gateway.newPairing(); assert.ok(qr.qr.startsWith('data:image/png;base64,'));
  const token = new URL(qr.url).hash.slice(6);
  assert.equal((await request('/pair', { token }, null, { Origin: 'https://unrelated.example' })).status, 403);
  const claim = await request('/pair', { token, name: 'My iPhone' }); assert.equal(claim.status, 200);
  assert.equal((await request('/pair', { token })).status, 403);
  assert.equal((await request('/pair/finish', claim.data)).status, 202);
  assert.equal((await request('/pair/finish', { ...claim.data, claim: 'wrong' })).status, 403);
  await gateway.approve(claim.data.id);
  const finish = await request('/pair/finish', claim.data); assert.equal(finish.status, 200);
  assert.equal((await request('/bootstrap', undefined, finish.cookie)).status, 200);
  const saved = await readFile(path.join(repo, 'mobile-access.json'), 'utf8');
  assert.ok(!saved.includes(token)); assert.ok(!saved.includes(claim.data.claim)); assert.ok(!saved.includes(finish.cookie.split('=')[1]));
  assert.ok(!JSON.stringify(gateway.status()).includes('hash'));
  await gateway.revoke(claim.data.id);
  assert.equal((await request('/bootstrap', undefined, finish.cookie)).status, 401);
});

test('QR navigation opens only the app shell; cross-site APIs, frames and sockets remain blocked', async t => {
  const { gateway, pair, request } = await fixture(t);
  const device = await pair();
  const navigation = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  const get = (pathname, headers = navigation, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request(gateway.origin + pathname, { method, headers }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
  for (const pathname of ['/mobile/', '/mobile', '/mobile/?source=qr']) {
    const shell = await get(pathname);
    assert.equal(shell.status, 200); assert.match(shell.body, /Mobile fixture/);
    assert.equal(shell.headers['x-frame-options'], 'DENY');
  }
  for (const headers of [
    { ...navigation, 'Sec-Fetch-Dest': 'iframe' },
    { ...navigation, 'Sec-Fetch-Mode': 'cors' },
    { ...navigation, Origin: 'https://unrelated.example' },
    { ...navigation, Host: 'unrelated.example' },
  ]) assert.equal((await get('/mobile/', headers)).status, 403);
  assert.equal((await get('/mobile/', { ...navigation, Origin: gateway.origin }, 'POST')).status, 403);
  // Even a paired phone's cookie cannot turn cross-site requests into API access.
  for (const pathname of ['/mobile/api/bootstrap', '/mobile/events', '/mobile/manifest.webmanifest', '/assets/app.js']) {
    assert.equal((await get(pathname, { ...navigation, Cookie: device.cookie })).status, 403);
  }
  const qr = await gateway.newPairing();
  assert.equal((await request('/pair', { token: qr.code }, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/pair', { token: qr.code })).status, 200);
  const ws = new WebSocket(`${gateway.origin.replace('http:', 'ws:')}/mobile/events`, { headers: { Origin: gateway.origin, Cookie: device.cookie, ...navigation } });
  await new Promise((resolve, reject) => { ws.once('error', resolve); ws.once('open', () => { ws.terminate(); reject(new Error('Cross-site socket was accepted')); }); });
});

test('retries and parallel requests write one prompt; changed payload cannot reuse an ID', async t => {
  const { request, pair, id, writes, gateway, repo } = await fixture(t), device = await pair();
  const data = { requestId: randomUUID(), text: 'First line\nSecond line' };
  const results = await Promise.all([request(`/sessions/${id}/send`, data, device.cookie), request(`/sessions/${id}/send`, data, device.cookie)]);
  assert.ok(results.every(result => result.data.status === 'delivered'));
  assert.deepEqual(writes, ['\x1b[200~First line\nSecond line\x1b[201~', '\r']);
  assert.equal((await request(`/sessions/${id}/send`, data, device.cookie)).data.status, 'delivered');
  assert.equal(writes.length, 2);
  assert.equal((await request(`/sessions/${id}/send`, { ...data, text: 'Different task' }, device.cookie)).status, 409);
  assert.equal((await request(`/sessions/${id}/send`, { ...data, requestId: randomUUID() }, device.cookie, { Origin: 'null' })).status, 403);
  assert.equal((await request('/settings', {}, device.cookie)).status, 404);
  assert.equal((await request('/files', undefined, device.cookie)).status, 404);
  assert.equal(gateway.state.receipts.length, 1);
  assert.ok(!(await readFile(path.join(repo, 'mobile-access.json'), 'utf8')).includes('First line'));
});

test('uncertain terminal delivery is retained and never automatically repeated', async t => {
  const { request, pair, id, writes, session } = await fixture(t), device = await pair();
  const original = session.process, data = { requestId: randomUUID(), text: 'Do this once' };
  const pending = request(`/sessions/${id}/send`, data, device.cookie);
  const timer = setTimeout(() => { session.process = {}; }, 100);
  const first = await pending; clearTimeout(timer);
  assert.equal(first.data.status, 'uncertain'); assert.equal(writes.length, 1);
  session.process = original;
  assert.equal((await request(`/sessions/${id}/send`, data, device.cookie)).data.status, 'uncertain');
  assert.equal(writes.length, 1);
});

test('mobile websocket observes a terminal without changing desktop selection or geometry; revocation closes it', async t => {
  const { gateway, pair, session, id } = await fixture(t), device = await pair();
  const ws = new WebSocket(`${gateway.origin.replace('http:', 'ws:')}/mobile/events`, { headers: { Origin: gateway.origin, Cookie: device.cookie } });
  t.after(() => ws.terminate());
  const events = []; ws.on('message', raw => events.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'subscribe', id })); ws.send(JSON.stringify({ type: 'resize', id, cols: 25, rows: 10 })); ws.send(JSON.stringify({ type: 'selected', id }));
  await new Promise(resolve => setTimeout(resolve, 75));
  assert.ok(events.some(event => event.type === 'snapshot')); assert.equal(events.filter(event => event.type === 'error').length, 2);
  assert.equal(session.cols, 100); assert.equal(session.rows, 30); assert.equal(gateway.status().devices[0].connected, true);
  const closed = new Promise(resolve => ws.once('close', resolve)); await gateway.revoke(device.pending.id); await closed;
  assert.equal(gateway.status().devices.length, 0);
});

test('turning mobile access off closes the surface and keeps agent sessions alive', async t => {
  const { gateway, pair, request, session } = await fixture(t), device = await pair(), process = session.process;
  await gateway.disable();
  assert.equal((await request('/bootstrap', undefined, device.cookie)).status, 503);
  assert.equal(session.process, process);
});

test('report grants are limited to the selected folder, sandboxed and revoked with the phone', async t => {
  const { gateway, pair, request, repo } = await fixture(t), device = await pair();
  await mkdir(path.join(repo, 'workspace/example'), { recursive: true });
  await mkdir(path.join(repo, 'workspace/other'));
  await writeFile(path.join(repo, 'workspace/example/report.html'), '<h1>Example</h1>');
  await writeFile(path.join(repo, 'workspace/example/picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(repo, 'workspace/other/private.html'), 'Unrelated document');
  await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'example', title: 'Example', folder: 'example', steps: [{ name: 'Report', path: 'report.html' }] }] }));
  const opened = await request('/reports/open', { entityId: 'example', step: 0 }, device.cookie); assert.equal(opened.status, 200);
  const url = `${gateway.origin}${opened.data.url}`;
  const response = await fetch(url, { headers: { Origin: 'null' } }); assert.equal(response.status, 200);
  const policy = response.headers.get('content-security-policy');
  assert.match(policy, /sandbox allow-scripts/); assert.ok(!policy.includes('allow-same-origin'));
  assert.equal((await fetch(url.replace('/example/report.html', '/other/private.html'))).status, 403);
  assert.equal((await fetch(url.replace('report.html', '%2eenv'))).status, 403);
  const download = await fetch(url.replace('report.html', 'picture.svg?download=1'));
  assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /^attachment;/);
  await gateway.revoke(device.pending.id); assert.equal((await fetch(url)).status, 401);
});

test('report boundaries resolve a linked repository and still reject external folders', async t => {
  const { gateway, pair, request, repo } = await fixture(t), device = await pair();
  await mkdir(path.join(repo, 'workspace/example'), { recursive: true });
  await writeFile(path.join(repo, 'workspace/example/report.html'), '<h1>Linked workspace</h1>');
  const outside = await mkdtemp(path.join(os.tmpdir(), 'mrmak-mobile-outside-'));
  await writeFile(path.join(outside, 'private.html'), 'Outside the workspace');
  await symlink(outside, path.join(repo, 'workspace/external'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [
    { id: 'example', title: 'Example', folder: 'example', steps: [{ name: 'Report', path: 'report.html' }] },
    { id: 'external', title: 'External', folder: 'external', steps: [{ name: 'Private', path: 'private.html' }] },
  ] }));
  const aliasParent = await mkdtemp(path.join(os.tmpdir(), 'mrmak-mobile-alias-'));
  const alias = path.join(aliasParent, 'workspace');
  await symlink(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  gateway.repo = alias;
  const opened = await request('/reports/open', { entityId: 'example' }, device.cookie);
  assert.equal(opened.status, 200);
  assert.equal((await fetch(`${gateway.origin}${opened.data.url}`)).status, 200);
  assert.equal((await request('/reports/open', { entityId: 'external' }, device.cookie)).status, 403);
});

test('configured live reports outside the repository serve only their granted output and policy', async t => {
  const { gateway, pair, request, repo } = await fixture(t), device = await pair();
  const external = await mkdtemp(path.join(os.tmpdir(), 'mrmak-mobile-live-'));
  const project = path.join(external, 'project'), stateDir = path.join(external, 'state');
  await mkdir(project); await mkdir(stateDir);
  await writeFile(path.join(project, 'private.html'), 'private project file');
  await writeFile(path.join(project, 'builder.mjs'), `
    import { mkdir, writeFile } from 'node:fs/promises'; import path from 'node:path';
    if (process.argv.includes('--list-inputs')) console.log(JSON.stringify({ dirs: [], files: [] }));
    else {
      const out = process.argv[process.argv.indexOf('--out') + 1]; await mkdir(path.join(out, 'assets'));
      for (const [file, content] of [['index.html', '<h1>Configured live reader</h1>'], ['assets/style.css', 'body { color: green; }'], ['assets/app.js', 'window.reader = true;'], ['assets/picture.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'], ['assets/data.json', '{"reader":true}'], ['assets/preview.html', '<h1>Preview</h1>'], ['guide.md', '# Live guide']]) await writeFile(path.join(out, file), content);
    }
  `);
  const resources = { scripts: ['https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js'], styles: ['https://fonts.googleapis.com/css2'], fonts: ['https://fonts.gstatic.com'] };
  await writeFile(path.join(stateDir, 'live-sources.json'), JSON.stringify([{ id: 'reader', label: 'Reader', project, python: process.execPath, args: ['builder.mjs'], mobileResources: resources }]));
  const manager = new LiveSources({ stateDir, files: { origin: 'http://127.0.0.1:1234', grant: () => 'desktop-grant' } });
  gateway.liveSources = await manager.init();
  t.after(async () => {
    await manager.close();
    assert.ok(!path.relative(os.tmpdir(), external).startsWith('..') && path.basename(external).startsWith('mrmak-mobile-live-'));
    await rm(external, { recursive: true, force: true });
  });
  const end = Date.now() + 8000;
  while (manager.list()[0].state === 'building' && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(manager.list()[0].state, 'ready');
  const root = (await manager.reportRoot('reader')).root;
  assert.equal(root, await realpath(path.join(stateDir, 'live/reader')));
  assert.ok(path.relative(repo, root).startsWith('..'));
  await mkdir(path.join(repo, 'workspace/local'), { recursive: true });
  await writeFile(path.join(repo, 'workspace/local/index.html'), '<h1>Local decoy</h1>');
  await writeFile(path.join(repo, 'workspace/local/guide.md'), '# Local guide');
  await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [
    { id: 'live', title: 'Live', folder: 'local', steps: [{ name: 'Reader', source: 'reader', path: 'index.html' }, { name: 'Guide', path: 'guide.md' }, { name: 'Live guide', source: 'reader', path: 'guide.md' }, { name: 'Bad path', source: 'reader', path: '../private.html' }] },
    { id: 'missing', title: 'Missing', folder: 'local', steps: [{ name: 'Reader', source: 'missing', path: 'index.html' }] },
    { id: 'source-only', title: 'Source only', steps: [{ name: 'Reader', source: 'reader', path: 'index.html' }] },
    { id: 'absolute', title: 'Absolute', folder: project, steps: [{ name: 'Private', path: 'private.html' }] },
  ] }));
  assert.equal((await request('/reports')).status, 401);
  const list = await request('/reports', undefined, device.cookie);
  assert.ok(list.data.some(item => item.id === 'source-only')); assert.ok(!JSON.stringify(list.data).includes(external));
  const opened = await request('/reports/open', { entityId: 'live', path: path.join(project, 'private.html') }, device.cookie);
  assert.equal(opened.status, 200); assert.match(opened.data.url, /\/live\/reader\/index.html$/);
  const url = gateway.origin + opened.data.url;
  const response = await fetch(url, { headers: { Origin: 'null' } });
  assert.equal(response.status, 200); assert.match(await response.text(), /Configured live reader/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const policy = response.headers.get('content-security-policy');
  for (const entry of Object.values(resources).flat()) assert.ok(policy.includes(entry));
  assert.ok(!policy.includes('allow-same-origin')); assert.match(policy, /frame-src 'none'/); assert.match(policy, /form-action 'none'/);
  for (const asset of ['assets/style.css', 'assets/app.js', 'assets/picture.svg', 'assets/data.json', 'assets/preview.html']) assert.equal((await fetch(url.replace('index.html', asset))).status, 200);
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(url, { method: 'POST' })).status, 403);
  assert.equal((await request('/reports/open', { entityId: 'live', step: 1 }, device.cookie)).data.text, '# Local guide');
  assert.equal((await request('/reports/open', { entityId: 'live', step: 2 }, device.cookie)).data.text, '# Live guide');
  const local = await request('/reports/open', { entityId: 'live', step: 1 }, device.cookie);
  assert.ok(!(await fetch(gateway.origin + local.data.url)).headers.get('content-security-policy').includes('cdnjs.cloudflare.com'));
  assert.equal((await request('/reports/open', { entityId: 'missing' }, device.cookie)).status, 404);
  assert.equal((await request('/reports/open', { entityId: 'absolute' }, device.cookie)).status, 404);
  assert.equal((await request('/reports/open', { entityId: 'live', step: 3 }, device.cookie)).status, 404);
  for (const bad of ['..%5cprivate.html', '%2eenv', 'C%3A%5cprivate.html', '../private.html', 'assets/../../private.html', '../other/index.html']) assert.equal((await fetch(url.replace('index.html', bad))).status, 403);
  await symlink(project, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fetch(url.replace('index.html', 'escape/private.html'))).status, 403);
  await mkdir(path.join(root, '.private')); await writeFile(path.join(root, '.private/private.html'), 'private report file');
  await symlink(path.join(root, '.private'), path.join(root, 'public-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fetch(url.replace('index.html', 'public-alias/private.html'))).status, 403);
  await mkdir(path.join(repo, 'workspace/_shared')); await symlink(project, path.join(repo, 'workspace/_shared/escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fetch(url.replace('live/reader/index.html', 'workspace/_shared/escape/private.html'))).status, 403);
  const token = opened.data.url.split('/')[3]; gateway.reports.grants.get(token).expires = 0;
  assert.equal((await fetch(url)).status, 401);
  const fresh = await request('/reports/open', { entityId: 'source-only' }, device.cookie);
  await rename(root, root + '-original'); await symlink(project, root, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fetch(gateway.origin + fresh.data.url)).status, 403);
  assert.equal((await request('/reports/open', { entityId: 'live' }, device.cookie)).status, 403);
  await gateway.revoke(device.pending.id);
  assert.equal((await fetch(gateway.origin + fresh.data.url)).status, 401);
});

test('delivery receipts and device pairing survive a service restart', async t => {
  const { gateway, request, pair, id, writes, repo } = await fixture(t), device = await pair();
  const message = { requestId: randomUUID(), text: 'Survive a restart' };
  assert.equal((await request(`/sessions/${id}/send`, message, device.cookie)).data.status, 'delivered');
  await gateway.close();
  const next = await new MobileGateway({ repo, stateDir: repo, uiDir: gateway.uiDir, sessions: gateway.sessions, attachments: gateway.attachments, settings: gateway.settings, transport: gateway.transport }).init();
  t.after(() => next.close());
  const result = await fetch(`${next.origin}/mobile/api/sessions/${id}/send`, { method: 'POST', headers: { Origin: next.origin, Cookie: device.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
  assert.equal((await result.json()).status, 'delivered'); assert.equal(writes.length, 2);
});

test('conversation adapters omit tool results and prefer Codex native user/answer events', () => {
  const records = [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Injected instructions' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Actual user request' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Actual reply' } },
  ];
  assert.deepEqual(transcriptMessages(records, 'codex').map(item => item.text), ['Actual user request', 'Actual reply']);
  assert.deepEqual(transcriptMessages([
    { uuid: 'one', type: 'user', message: { content: [{ type: 'text', text: 'User' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'Hidden tool output' }] } },
    { type: 'assistant', message: { id: 'answer', content: [{ type: 'text', text: 'Draft' }] } },
    { type: 'assistant', message: { id: 'answer', content: [{ type: 'text', text: 'Complete' }] } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'Subagent' }] } },
  ], 'claude').map(item => item.text), ['User', 'Complete']);
});

test('Tailscale setup preserves other routes and refuses a public Funnel route', async () => {
  const transport = new TailscaleTransport(), calls = [];
  let config = { TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } }, Web: { 'pc.example.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } };
  transport.probe = async () => ({ ready: true, hostname: 'pc.example.ts.net' });
  transport.config = async () => config;
  transport.command = async args => { calls.push(args); config = { ...config, Web: { ...config.Web, 'pc.example.ts.net:8444': { Handlers: { '/': { Proxy: 'http://127.0.0.1:12345' } } } } }; return { stdout: '' }; };
  const saved = await transport.enable('http://127.0.0.1:12345'); assert.equal(saved.port, 8444);
  assert.ok(!calls.flat().includes('reset')); assert.ok(calls[0].includes('--https=8444'));
  await transport.disable({ hostname: 'pc.example.ts.net', port: 8443, target: 'http://127.0.0.1:12345' }); assert.equal(calls.length, 1);
  config.AllowFunnel = { 'pc.example.ts.net:8444': true };
  await assert.rejects(transport.enable('http://127.0.0.1:12346', saved), /publicly shared/);
});
