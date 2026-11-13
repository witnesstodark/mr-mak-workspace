import webpush from 'web-push';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
// The push services of Chrome and Android browsers, Firefox, Safari and Edge. The
// service posts to the endpoint a phone sends, so it never contacts another host.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const MAX_MUTED = 500;
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);

function pushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && PUSH_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
}
const base64url = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+={0,2}$/.test(value);

// Web Push to paired phones when a chat starts waiting for the person. The
// notification carries the chat's name and id only; its messages never leave
// this computer. One subscription per paired device; the VAPID key pair lives in
// mobile-access.json beside the device hashes and only its public half leaves it.
export class MobilePush {
  constructor(gateway, send = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options)) {
    Object.assign(this, { gateway, send });
    this.waiting = new Map(); this.generating = null;
  }
  // Chats already waiting when the service starts were announced before.
  watch(sessions) { for (const session of sessions) this.waiting.set(session.id, session.activity === 'waiting'); }
  async keys() {
    if (this.gateway.state.vapid) return this.gateway.state.vapid;
    // Two first requests at once must not create two key pairs.
    this.generating ||= (async () => { this.gateway.state.vapid = webpush.generateVAPIDKeys(); await this.gateway.save(); return this.gateway.state.vapid; })().finally(() => { this.generating = null; });
    return this.generating;
  }
  muted() { return [...(this.gateway.state.mutedChats || [])]; }
  async status(device) { return { publicKey: (await this.keys()).publicKey, enabled: !!device.push }; }
  async subscribe(device, subscription) {
    if (subscription === null) delete device.push;
    else {
      const { endpoint, keys } = subscription || {};
      if (!pushEndpoint(endpoint) || !base64url(keys?.p256dh, 200) || !base64url(keys?.auth, 100)) fail('This browser returned an invalid notification subscription.');
      // A phone paired again in the same browser keeps one subscription, not two.
      for (const other of this.gateway.state.devices) if (other !== device && other.push?.endpoint === endpoint) delete other.push;
      device.push = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
    }
    await this.gateway.save();
    return this.status(device);
  }
  // Muting belongs to the chat, so every paired phone stays quiet for it.
  async mute(id, muted) {
    if (!uuid(id) || typeof muted !== 'boolean') fail('Choose whether to mute this chat.');
    const known = new Set(this.gateway.sessions.list().map(item => item.id));
    const list = this.muted().filter(item => item !== id && known.has(item));
    if (muted) list.push(id);
    this.gateway.state.mutedChats = list.slice(-MAX_MUTED);
    await this.gateway.save();
    return this.muted();
  }
  session(session) {
    const waiting = session.activity === 'waiting', was = this.waiting.get(session.id);
    this.waiting.set(session.id, waiting);
    if (!waiting || was || !this.gateway.active) return;
    if (this.muted().includes(session.id)) return;
    // Someone already has this chat open on a phone in front of them.
    if (this.gateway.watching(session.id)) return;
    this.notify(session).catch(error => console.error(`Phone notification failed: ${error.message}`));
  }
  // The phones allowed to sign in now. A subscription left by an expired or idle
  // device is dropped instead of kept for a phone that can no longer open the chat.
  recipients() {
    const devices = [];
    let dropped = false;
    for (const device of this.gateway.state.devices) {
      if (!device.push) continue;
      if (this.gateway.validDevice(device)) devices.push(device);
      else { delete device.push; dropped = true; }
    }
    return { devices, dropped };
  }
  async notify(session) {
    const { devices, dropped } = this.recipients();
    let changed = dropped;
    // Web Push requires an https: or mailto: contact; the tailnet address identifies this app.
    if (devices.length && this.gateway.origin.startsWith('https://')) {
      const { publicKey, privateKey } = await this.keys();
      const title = String(session.name || 'Mr. Mak').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 80) || 'Mr. Mak';
      const payload = JSON.stringify({ title, body: 'Waiting for you', chat: session.id });
      // A newer notice for the same chat replaces one the push service still holds.
      const options = { TTL: 3600, urgency: 'high', timeout: 15000, vapidDetails: { subject: this.gateway.origin, publicKey, privateKey }, ...(uuid(session.id) ? { topic: session.id.replaceAll('-', '') } : {}) };
      await Promise.all(devices.map(async device => {
        try { await this.send(device.push, payload, options); }
        catch (error) {
          // The browser dropped this subscription; the phone can turn notifications on again.
          if ([404, 410].includes(error.statusCode)) { delete device.push; changed = true; }
          else console.error(`Phone notification to ${device.name} failed: ${error.statusCode || error.message}`);
        }
      }));
    }
    if (changed) await this.gateway.save();
  }
}
