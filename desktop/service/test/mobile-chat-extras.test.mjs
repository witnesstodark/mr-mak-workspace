import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MobileGateway } from '../mobile.mjs';
import { Attachments } from '../attachments.mjs';

// A paired phone on a gateway whose chat works in `<repo>/project`.
async function fixture(t, chatExtras = null) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-mobile-extras-'));
  await mkdir(path.join(repo, 'ui')); await writeFile(path.join(repo, 'ui/index.html'), '<html>Mobile fixture</html>');
  await mkdir(path.join(repo, 'project'));
  const sessions = new EventEmitter(), id = randomUUID(), writes = [];
  const session = { id, agent: 'claude', name: 'Test chat', status: 'running', cols: 100, rows: 30, process: { write: value => writes.push(value) }, nativeId: null, cwd: path.join(repo, 'project') };
  sessions.get = () => session; sessions.list = () => [session]; sessions.input = (_id, value) => writes.push(value);
  sessions.read = async () => ({ screen: '' }); sessions.snapshot = async () => ({ session, sequence: 1, data: '' }); sessions.seen = () => {};
  const transport = { probe: async () => ({ installed: true, ready: true }), enable: async origin => ({ origin }), disable: async () => {} };
  const gateway = await new MobileGateway({ repo, uiDir: path.join(repo, 'ui'), stateDir: repo, sessions, attachments: new Attachments(repo), closeChat: async () => ({}), settings: () => ({ defaultBypass: false }), transport, chatExtras }).init();
  t.after(() => gateway.close()); await gateway.enable();
  const request = async (route, data, cookie) => {
    const response = await fetch(`${gateway.origin}/mobile/api${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { Origin: gateway.origin, 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  const qr = await gateway.newPairing(), token = new URL(qr.url).hash.slice(6);
  const pending = (await request('/pair', { token, name: 'Test phone' })).data;
  await gateway.approve(pending.id);
  const device = await request('/pair/finish', pending);
  return { gateway, request, repo, id, session, writes, cookie: device.cookie };
}

test('a file linked in a chat opens as its report, in its card folder or on its own, never outside', async t => {
  const { gateway, request, repo, id, cookie } = await fixture(t);
  await mkdir(path.join(repo, 'workspace/example/media'), { recursive: true });
  await writeFile(path.join(repo, 'workspace/example/report.html'), '<h1>Report</h1>');
  await writeFile(path.join(repo, 'workspace/example/media/notes.md'), '# Notes');
  await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'example', title: 'Example', folder: 'example', steps: [{ name: 'Report', path: 'report.html' }] }] }));
  await writeFile(path.join(repo, 'project/page.html'), '<h1>Page</h1>');
  await mkdir(path.join(repo, 'project/.agents')); await writeFile(path.join(repo, 'project/.agents/secret.md'), 'hidden');
  const outside = await mkdtemp(path.join(os.tmpdir(), 'mrmak-mobile-outside-'));
  await writeFile(path.join(outside, 'private.html'), 'Outside');
  const open = target => request(`/sessions/${id}/open`, { path: target }, cookie);

  assert.deepEqual((await open(path.join(repo, 'workspace/example/report.html'))).data, { report: { entityId: 'example', step: 0 } });
  const notes = await open('../workspace/example/media/notes.md');
  assert.equal(notes.status, 200); assert.equal(notes.data.file.kind, 'markdown'); assert.equal(notes.data.file.text, '# Notes');
  assert.match(notes.data.file.url, /^\/mobile\/view\/[\w-]+\/workspace\/example\/media\/notes\.md$/);
  assert.equal((await fetch(`${gateway.origin}${notes.data.file.url}`)).status, 200);
  assert.equal((await fetch(`${gateway.origin}${notes.data.file.url.replace('media/notes.md', 'report.html')}`)).status, 200, 'the card folder serves the page assets');

  const page = await open('page.html');
  assert.equal(page.data.file.kind, 'html'); assert.match(page.data.file.url, /\/files\/page\.html$/);
  assert.equal((await fetch(`${gateway.origin}${page.data.file.url}`)).status, 200);

  assert.equal((await open(path.join(outside, 'private.html'))).status, 403);
  assert.equal((await open('.agents/secret.md')).status, 403);
  assert.equal((await open('.')).status, 400);
  assert.equal((await open('missing.html')).status, 404);
  assert.equal((await request(`/sessions/${id}/open`, { path: 'page.html' })).status, 401, 'an unpaired caller cannot open files');
});

test('the phone reads chat details, saves a rule, reads a diff and gets the cold cache hold once', async t => {
  const calls = [];
  let held = false;
  const chatExtras = {
    details: async session => ({ plan: { request: 'Fix the map', status: 'working', next: 'Run tests', tasks: [] }, usage: null, cache: null, rules: [{ id: 'r1', rule: 'test first', at: '' }], changes: [], changeCount: 0, cwd: session.cwd }),
    resolveRule: async (_session, data) => { calls.push(['rule', data]); return []; },
    diff: async (_session, file) => { calls.push(['diff', file]); return { text: '+a' }; },
    coldCheck: async (_session, text) => { if (!held && !text.startsWith('/')) { held = true; throw Object.assign(new Error('Prompt cache went cold. Send again to go ahead.'), { status: 409 }); } },
  };
  const { request, id, cookie, writes } = await fixture(t, chatExtras);
  const details = await request(`/sessions/${id}/details`, undefined, cookie);
  assert.equal(details.status, 200); assert.equal(details.data.plan.next, 'Run tests');
  assert.equal((await request(`/sessions/${id}/rules`, { id: 'r1', action: 'project' }, cookie)).status, 200);
  assert.equal((await request(`/sessions/${id}/diff`, { path: 'E:/x.js' }, cookie)).data.text, '+a');
  assert.deepEqual(calls, [['rule', { id: 'r1', action: 'project' }], ['diff', 'E:/x.js']]);

  const message = { requestId: randomUUID(), text: 'Continue the review', images: [] };
  const first = await request(`/sessions/${id}/send`, message, cookie);
  assert.equal(first.status, 409); assert.match(first.data.error, /Send again/);
  assert.ok(!writes.some(value => String(value).includes('Continue the review')), 'the held message was not typed');
  const second = await request(`/sessions/${id}/send`, message, cookie);
  assert.equal(second.status, 200, 'the same message goes through when sent again');
});
