import webpush from 'web-push';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

// Web Push to paired phones when a chat starts waiting for the person. The
// notification names the chat only; its messages never leave this computer.
export class MobilePush {
  constructor(gateway, send = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options)) {
    Object.assign(this, { gateway, send });
    this.waiting = new Map();
  }
  // Chats already waiting when the service starts were announced before.
  watch(sessions) { for (const session of sessions) this.waiting.set(session.id, session.activity === 'waiting'); }
  async keys() {
    if (!this.gateway.state.vapid) { this.gateway.state.vapid = webpush.generateVAPIDKeys(); await this.gateway.save(); }
    return this.gateway.state.vapid;
  }
  async status(device) { return { publicKey: (await this.keys()).publicKey, enabled: !!device.push }; }
  async subscribe(device, subscription) {
    if (subscription === null) delete device.push;
    else {
      const { endpoint, keys } = subscription || {};
      if (typeof endpoint !== 'string' || endpoint.length > 2000 || !endpoint.startsWith('https://')
        || typeof keys?.p256dh !== 'string' || keys.p256dh.length > 200 || typeof keys?.auth !== 'string' || keys.auth.length > 100) fail('This browser returned an invalid notification subscription.');
      device.push = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
    }
    await this.gateway.save();
    return this.status(device);
  }
  session(session) {
    const waiting = session.activity === 'waiting', was = this.waiting.get(session.id);
    this.waiting.set(session.id, waiting);
    if (waiting && !was && this.gateway.active) this.notify(session).catch(error => console.error(`Phone notification failed: ${error.message}`));
  }
  async notify(session) {
    const devices = this.gateway.state.devices.filter(device => device.push && device.expires > Date.now());
    if (!devices.length) return;
    const { publicKey, privateKey } = await this.keys();
    const payload = JSON.stringify({ title: session.name, body: 'Waiting for you', chat: session.id });
    // The push service requires a contact; the private tailnet address identifies this app.
    const options = { TTL: 3600, urgency: 'high', vapidDetails: { subject: this.gateway.origin, publicKey, privateKey } };
    let expired = false;
    await Promise.all(devices.map(async device => {
      try { await this.send(device.push, payload, options); }
      catch (error) {
        // The browser dropped this subscription; the phone can turn notifications on again.
        if ([404, 410].includes(error.statusCode)) { delete device.push; expired = true; }
        else console.error(`Phone notification to ${device.name} failed: ${error.statusCode || error.message}`);
      }
    }));
    if (expired) await this.gateway.save();
  }
}
