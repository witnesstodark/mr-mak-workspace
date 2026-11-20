import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import webpush from 'web-push';
import { MobileGateway } from '../mobile.mjs';
import { Attachments } from '../attachments.mjs';

const TAILNET = 'https://desk.tail1234.ts.net';
// A browser subscription's keys, as a real push service hands them to the page.
function subscription(endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) {
  const { publicKey } = webpush.generateVAPIDKeys();
  return { endpoint, keys: { p256dh: publicKey, auth: Buffer.alloc(16, 7).toString('base64url') } };
}
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-push-'));
  await mkdir(path.join(repo, 'ui')); await writeFile(path.join(repo, 'ui/index.html'), '<html>Mobile fixture</html>');
  const sessions = new EventEmitter(), chats = new Map();
  for (const name of ['Map', 'HUD']) { const id = randomUUID(); chats.set(id, { id, agent: 'codex', name, status: 'running', activity: 'idle', process: {}, cols: 100, rows: 30 }); }
  sessions.get = id => { const session = chats.get(id); if (!session) throw Object.assign(new Error('Chat not found'), { status: 404 }); return session; };
  sessions.list = () => [...chats.values()];
  sessions.snapshot = async id => ({ session: chats.get(id), sequence: 1, data: '' });
  sessions.seen = () => {};
  const transport = { probe: async () => ({ installed: true, ready: true }), enable: async origin => ({ origin }), disable: async () => {} };
  const gateway = await new MobileGateway({ repo, uiDir: path.join(repo, 'ui'), stateDir: repo, sessions, attachments: new Attachments(repo), closeChat: async () => ({}), settings: () => ({}), transport }).init();
  t.after(() => gateway.close()); await gateway.enable();
  const local = gateway.origin, sent = [];
  gateway.push.send = async (target, payload, options) => { sent.push({ target, payload: JSON.parse(payload), options }); };
  const request = async (route, data, cookie, extra = {}) => {
    const response = await fetch(`${local}/mobile/api${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { Origin: local, 'Content-Type': 'application/json' }), ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  const pair = async name => {
    const qr = await gateway.newPairing(), token = new URL(qr.url).hash.slice(6);
    const pending = (await request('/pair', { token, name })).data;
    await gateway.approve(pending.id);
    const finished = await request('/pair/finish', pending);
    return { cookie: finished.cookie, device: gateway.state.devices.find(item => item.id === pending.id) };
  };
  const socket = async cookie => {
    const ws = new WebSocket(`${local.replace('http:', 'ws:')}/mobile/events`, { headers: { Origin: local, Cookie: cookie } });
    t.after(() => ws.terminate());
    const events = []; ws.on('message', raw => events.push(JSON.parse(raw.toString())));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return { ws, events };
  };
  // The phone's push service accepts only an https contact: Tailscale Serve gives one.
  const wait = async (chat, activity = 'waiting') => {
    gateway.origin = TAILNET;
    try { chat.activity = activity; sessions.emit('session', chat); await pause(); } finally { gateway.origin = local; }
  };
  const [map, hud] = chats.values();
  return { gateway, sessions, repo, request, pair, socket, wait, sent, map, hud };
}

test('a subscribed phone is notified once when a chat starts waiting, with only its name and id', async t => {
  const { request, pair, wait, sent, map, hud } = await fixture(t), phone = await pair('Pixel');
  const status = await request('/push', { subscription: subscription() }, phone.cookie);
  assert.equal(status.status, 200); assert.equal(status.data.enabled, true);
  await wait(map); await wait(map); await wait(hud, 'working');
  assert.deepEqual(sent.map(item => item.payload), [{ title: 'Map', body: 'Waiting for you', chat: map.id }]);
  // The real library accepts the request it would send: VAPID header, encrypted body and a topic per chat.
  const details = webpush.generateRequestDetails(sent[0].target, JSON.stringify(sent[0].payload), sent[0].options);
  assert.match(details.headers.Authorization, /^vapid t=.+, k=/);
  assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(details.headers.Topic, map.id.replaceAll('-', ''));
  assert.equal(details.headers.Urgency, 'high');
  await wait(map, 'idle'); await wait(map);
  assert.equal(sent.length, 2, 'a chat that waits again is announced again');
});

test('a phone idle for 31 days or past its expiry gets no notification and its subscription is dropped', async t => {
  const { gateway, request, pair, wait, sent, map, repo } = await fixture(t);
  const active = await pair('Active'), idle = await pair('Idle'), expired = await pair('Expired'), revoked = await pair('Revoked');
  for (const phone of [active, idle, expired, revoked]) assert.equal((await request('/push', { subscription: subscription() }, phone.cookie)).status, 200);
  idle.device.lastSeen = new Date(Date.now() - 31 * 86400000).toISOString();
  expired.device.expires = Date.now() - 1;
  await gateway.revoke(revoked.device.id);
  // The same rule that signs a phone in decides who is notified.
  assert.deepEqual([active, idle, expired].map(phone => gateway.validDevice(phone.device)), [true, false, false]);
  await wait(map);
  assert.deepEqual(sent.map(item => item.target.endpoint), [active.device.push.endpoint]);
  assert.equal(idle.device.push, undefined); assert.equal(expired.device.push, undefined);
  await gateway.saves;
  const saved = JSON.parse(await readFile(path.join(repo, 'mobile-access.json'), 'utf8'));
  assert.deepEqual(saved.devices.filter(device => device.push).map(device => device.name), ['Active']);
  assert.equal((await request('/push', undefined, idle.cookie)).status, 401, 'an idle phone cannot subscribe again either');
});

test('a chat open on a visible phone is not notified; another chat or a hidden phone is', async t => {
  const { request, pair, socket, wait, sent, map, hud } = await fixture(t), phone = await pair('Pixel');
  await request('/push', { subscription: subscription() }, phone.cookie);
  const { ws, events } = await socket(phone.cookie);
  ws.send(JSON.stringify({ type: 'viewing', id: map.id })); await pause(30);
  await wait(map); await wait(hud);
  assert.deepEqual(sent.map(item => item.payload.chat), [hud.id]);
  // The phone reports null when it hides the chat or the app.
  ws.send(JSON.stringify({ type: 'viewing', id: null })); await pause(30);
  await wait(map, 'idle'); await wait(map);
  assert.deepEqual(sent.map(item => item.payload.chat), [hud.id, map.id]);
  ws.send(JSON.stringify({ type: 'viewing', id: map.id })); await pause(30);
  ws.terminate(); await pause(30);
  await wait(map, 'idle'); await wait(map);
  assert.equal(sent.length, 3, 'a closed socket no longer counts as watching');
  ws.terminate();
  const other = await socket(phone.cookie);
  other.ws.send(JSON.stringify({ type: 'viewing', id: 'not-a-chat' })); other.ws.send(JSON.stringify({ type: 'viewing', id: randomUUID() })); await pause(30);
  assert.equal(other.events.filter(event => event.type === 'error').length, 2);
});

test('a muted chat notifies no phone; the choice survives a restart and needs a paired same-origin phone', async t => {
  const { gateway, request, pair, wait, sent, map, hud, repo, sessions } = await fixture(t), phone = await pair('Pixel'), second = await pair('Tablet');
  await request('/push', { subscription: subscription() }, phone.cookie);
  await request('/push', { subscription: subscription() }, second.cookie);
  assert.equal((await request(`/sessions/${map.id}/mute`, { muted: true })).status, 401);
  assert.equal((await request(`/sessions/${map.id}/mute`, { muted: true }, phone.cookie, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await request(`/sessions/${map.id}/mute`, { muted: 'yes' }, phone.cookie)).status, 400);
  assert.equal((await request(`/sessions/${randomUUID()}/mute`, { muted: true }, phone.cookie)).status, 404);
  assert.deepEqual((await request(`/sessions/${map.id}/mute`, { muted: true }, phone.cookie)).data, { mutedChats: [map.id] });
  assert.deepEqual((await request('/bootstrap', undefined, second.cookie)).data.mutedChats, [map.id]);
  await wait(map); await wait(hud);
  assert.deepEqual(sent.map(item => item.payload.chat), [hud.id, hud.id], 'both phones hear the other chat only');
  await gateway.close();
  const next = await new MobileGateway({ repo, stateDir: repo, uiDir: path.join(repo, 'ui'), sessions, attachments: gateway.attachments, settings: () => ({}), transport: gateway.transport }).init();
  t.after(() => next.close());
  assert.deepEqual(next.push.muted(), [map.id]);
  assert.deepEqual(await next.push.mute(map.id, false), []);
});

test('subscriptions are validated, kept one per device, dropped on 404/410 and never shown to the desktop', async t => {
  const { gateway, request, pair, wait, map, hud } = await fixture(t), phone = await pair('Pixel'), tablet = await pair('Tablet');
  assert.equal((await request('/push')).status, 401);
  assert.equal((await request('/push', { subscription: subscription() }, phone.cookie, { Origin: 'https://unrelated.example' })).status, 403);
  const good = subscription();
  for (const bad of [undefined, {}, { ...good, endpoint: 'http://fcm.googleapis.com/fcm/send/x' }, { ...good, endpoint: 'https://push.example/x' }, { ...good, endpoint: 'https://fcm.googleapis.com.evil.example/x' }, { ...good, endpoint: 'https://fcm.googleapis.com:8443/x' }, { ...good, endpoint: 'https://user:pass@fcm.googleapis.com/x' }, { ...good, endpoint: `https://fcm.googleapis.com/${'x'.repeat(2001)}` }, { endpoint: good.endpoint, keys: { p256dh: good.keys.p256dh } }, { endpoint: good.endpoint, keys: { p256dh: 'not base64!', auth: good.keys.auth } }, { endpoint: good.endpoint, keys: { p256dh: 'a'.repeat(201), auth: good.keys.auth } }]) {
    const result = await request('/push', { subscription: bad }, phone.cookie);
    assert.equal(result.status, 400); assert.match(result.data.error, /invalid notification subscription/);
  }
  for (const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.equal((await request('/push', { subscription: subscription(endpoint) }, phone.cookie)).status, 200);
  const status = (await request('/push', { subscription: good }, phone.cookie)).data;
  assert.equal(status.publicKey, gateway.state.vapid.publicKey);
  assert.equal(JSON.stringify(status).includes(gateway.state.vapid.privateKey), false, 'the private key never leaves the computer');
  // The same browser paired again keeps a single subscription.
  await request('/push', { subscription: good }, tablet.cookie);
  assert.equal(phone.device.push, undefined); assert.equal(tablet.device.push.endpoint, good.endpoint);
  assert.equal(JSON.stringify(gateway.status()).includes(good.endpoint), false, 'the desktop list carries no endpoint');
  await request('/push', { subscription: subscription() }, phone.cookie);
  gateway.push.send = async target => { throw Object.assign(new Error('Gone'), { statusCode: target === tablet.device.push ? 410 : 500 }); };
  const logged = []; t.mock.method(console, 'error', message => logged.push(message));
  await wait(map);
  assert.equal(tablet.device.push, undefined); assert.ok(phone.device.push, 'another failure keeps the subscription');
  assert.match(logged.join('\n'), /Phone notification to Pixel failed: 500/);
  assert.equal((await request('/push', { subscription: null }, phone.cookie)).data.enabled, false);
  // Nothing is sent while mobile access is off.
  await request('/push', { subscription: subscription() }, phone.cookie);
  let sends = 0; gateway.push.send = async () => { sends++; };
  gateway.active = false; await wait(hud); gateway.active = true;
  assert.equal(sends, 0);
});

test('two first requests create one VAPID key pair', async t => {
  const { gateway } = await fixture(t);
  const [first, second] = await Promise.all([gateway.push.keys(), gateway.push.keys()]);
  assert.equal(first.publicKey, second.publicKey);
});
