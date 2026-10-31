import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { MobilePush } from '../mobile-push.mjs';

// A browser subscription's keys, as a real push service hands them to the page.
function subscription() {
  const { publicKey } = webpush.generateVAPIDKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: publicKey, auth: Buffer.alloc(16, 7).toString('base64url') } };
}
function fixture(send) {
  const gateway = { active: true, origin: 'https://desk.tail1234.ts.net', saves: 0, state: { devices: [{ id: 'phone', name: 'Pixel', expires: Date.now() + 60000 }, { id: 'old', name: 'Old', expires: Date.now() - 1, push: subscription() }] }, save: async () => { gateway.saves++; } };
  return { gateway, push: new MobilePush(gateway, send) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a phone is notified once when a chat starts waiting, with only the chat name', async () => {
  const sent = [];
  const { gateway, push } = fixture(async (target, payload, options) => { sent.push({ target, payload: JSON.parse(payload), options }); });
  push.watch([{ id: 'a', activity: 'waiting' }]);
  await push.subscribe(gateway.state.devices[0], subscription());
  push.session({ id: 'a', name: 'Map', activity: 'waiting' });
  push.session({ id: 'b', name: 'HUD', activity: 'working' });
  push.session({ id: 'b', name: 'HUD', activity: 'waiting' });
  push.session({ id: 'b', name: 'HUD', activity: 'waiting' });
  await settle();
  assert.deepEqual(sent.map(item => item.payload), [{ title: 'HUD', body: 'Waiting for you', chat: 'b' }]);
  assert.equal(sent[0].target.endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
  // The real library accepts the request it would send: VAPID header and encrypted body.
  const request = webpush.generateRequestDetails(sent[0].target, JSON.stringify(sent[0].payload), sent[0].options);
  assert.match(request.headers.Authorization, /^vapid t=.+, k=/);
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  push.session({ id: 'b', name: 'HUD', activity: 'idle' });
  push.session({ id: 'b', name: 'HUD', activity: 'waiting' });
  await settle();
  assert.equal(sent.length, 2);
});

test('a subscription the push service dropped is forgotten; others are kept', async () => {
  const { gateway, push } = fixture(async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); });
  const phone = gateway.state.devices[0];
  await push.subscribe(phone, subscription());
  await push.notify({ id: 'a', name: 'Map' });
  assert.equal(phone.push, undefined);
  assert.ok(gateway.state.devices[1].push, 'an expired device is not contacted or changed');
});

test('notifications need a valid https subscription and can be turned off', async () => {
  const { gateway, push } = fixture(async () => {});
  const phone = gateway.state.devices[0];
  for (const bad of [undefined, {}, { endpoint: 'http://push.example/x', keys: { p256dh: 'a', auth: 'b' } }, { endpoint: 'https://push.example/x', keys: { p256dh: 'a' } }]) await assert.rejects(push.subscribe(phone, bad), /invalid notification subscription/);
  const status = await push.subscribe(phone, subscription());
  assert.equal(status.enabled, true);
  assert.equal(status.publicKey, gateway.state.vapid.publicKey);
  assert.equal((await push.subscribe(phone, null)).enabled, false);
  gateway.active = false;
  let sent = 0; push.send = async () => { sent++; };
  await push.subscribe(phone, subscription());
  push.session({ id: 'z', name: 'Z', activity: 'waiting' }); await settle();
  assert.equal(sent, 0, 'nothing is sent while mobile access is off');
});
