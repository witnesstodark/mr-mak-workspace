import http from 'node:http';
import path from 'node:path';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { body, equalSecret, json, publicError, readJson, realFile, saveJson, secret, sleep } from './util.mjs';
import { serveFile } from './files.mjs';
import { MAX_IMAGE_BYTES, attachmentText } from './attachments.mjs';
import { inventory } from './agents.mjs';
import { TailscaleTransport } from './mobile-tailscale.mjs';
import { MobileTranscripts } from './mobile-transcript.mjs';
import { MobileReports } from './mobile-reports.mjs';
import { MobileDictation } from './mobile-dictation.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
const COOKIE = 'mrmak_mobile';
const PAIR_TTL = 5 * 60 * 1000;
const DEVICE_TTL = 180 * 24 * 60 * 60 * 1000;
const send = (ws, value) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };

export class MobileGateway {
  constructor({ repo, uiDir, stateDir, sessions, attachments, settings, changed, closeChat, liveSources, transport = new TailscaleTransport(), dictation = new MobileDictation(repo) }) {
    Object.assign(this, { repo, uiDir, sessions, attachments, settings, changed, closeChat, liveSources, transport });
    this.file = path.join(stateDir, 'mobile-access.json');
    this.saves = Promise.resolve(); this.pending = new Map(); this.clients = new Set(); this.inflight = new Map(); this.uploads = new Map(); this.queues = new Map();
    this.transcripts = new MobileTranscripts(); this.active = false; this.error = ''; this.origin = ''; this.rate = { at: Date.now(), count: 0 };
    this.reports = new MobileReports(this);
    this.dictation = dictation;
  }
  async init() {
    this.state = { enabled: false, devices: [], receipts: [], ...await readJson(this.file, {}) };
    // A process restart cannot prove whether an interrupted write reached the CLI.
    for (const receipt of this.state.receipts) if (receipt.status === 'sending') receipt.status = 'uncertain';
    this.server = http.createServer((request, response) => this.request(request, response));
    this.server.requestTimeout = 30000; this.server.headersTimeout = 15000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.localOrigin = `http://127.0.0.1:${this.server.address().port}`;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
    this.server.on('upgrade', (request, socket, head) => {
      try {
        this.checkRequest(request, true);
        if (new URL(request.url, this.origin).pathname !== '/mobile/events') fail('Not found', 404);
        const device = this.device(request);
        this.wss.handleUpgrade(request, socket, head, ws => this.connect(ws, device));
      } catch { socket.destroy(); }
    });
    this.handlers = {
      session: session => { if (session.agent !== 'shell') this.broadcast({ type: 'session', session }); },
      output: output => { for (const ws of this.clients) if (ws.sessionId === output.id) { if (ws.bufferedAmount > 2 * 1024 * 1024) ws.close(1013, 'Reconnect'); else send(ws, { type: 'output', ...output }); } },
      'screen-cleared': value => this.broadcast({ type: 'screen-cleared', ...value }),
      'terminal-resized': value => this.broadcast({ type: 'terminal-resized', ...value }),
    };
    for (const [event, handler] of Object.entries(this.handlers)) this.sessions.on(event, handler);
    this.timer = setInterval(() => {
      for (const [id, pending] of this.pending) if (pending.expires < Date.now()) this.pending.delete(id);
      if (this.pairing?.expires < Date.now()) this.pairing = null;
      for (const [id, upload] of this.uploads) if (upload.expires < Date.now()) this.uploads.delete(id);
      for (const ws of this.clients) {
        if (!this.state.devices.some(device => device.id === ws.deviceId && device.expires > Date.now()) || ws.alive === false) ws.terminate();
        else { ws.alive = false; ws.ping(); }
      }
    }, 30000); this.timer.unref();
    if (this.state.enabled) await this.enable().catch(error => { this.error = publicError(error); });
    return this;
  }
  save() {
    this.saves = this.saves.catch(() => {}).then(() => saveJson(this.file, this.state));
    return this.saves;
  }
  status() {
    return {
      enabled: this.active, origin: this.active ? this.origin : '', error: this.error,
      devices: this.state.devices.filter(device => device.expires > Date.now()).map(({ hash: _hash, ...device }) => ({ ...device, connected: [...this.clients].some(ws => ws.deviceId === device.id && ws.readyState === WebSocket.OPEN) })),
      pending: [...this.pending.values()].filter(item => item.expires > Date.now() && !item.approved).map(({ id, name, code, expires }) => ({ id, name, code, expires })),
    };
  }
  notify() { this.changed?.(this.status()); }
  async enable() {
    if (this.enabling) return this.enabling;
    this.enabling = (async () => {
      this.error = '';
      try {
        const route = await this.transport.enable(this.localOrigin, this.state.route);
        this.state.route = route; this.origin = route.origin;
        this.state.enabled = true; await this.save(); this.active = true; this.notify(); return this.status();
      } catch (error) { this.active = false; this.error = publicError(error); this.notify(); throw error; }
    })();
    try { return await this.enabling; } finally { this.enabling = null; }
  }
  async disable() {
    if (this.enabling) await this.enabling.catch(() => {});
    this.active = false; this.state.enabled = false; this.pairing = null; this.pending.clear(); this.uploads.clear();
    for (const ws of this.clients) ws.close(1008, 'Mobile access disabled');
    await this.save(); this.notify();
    await this.transport.disable(this.state.route).catch(() => {});
    return this.status();
  }
  async newPairing() {
    if (!this.active) fail('Enable mobile access first.');
    const token = secret(), code = String(randomInt(10000000, 100000000)), expires = Date.now() + PAIR_TTL;
    this.pairing = { hash: digest(token), codeHash: digest(code), expires };
    const url = `${this.origin}/mobile/#pair=${token}`;
    return { url, code, expires, qr: await QRCode.toDataURL(url, { width: 280, margin: 2, errorCorrectionLevel: 'M' }) };
  }
  rateLimit() {
    if (Date.now() - this.rate.at > 60000) this.rate = { at: Date.now(), count: 0 };
    if (++this.rate.count > 60) fail('Too many pairing attempts. Wait a minute and try again.', 429);
  }
  claim(data) {
    this.rateLimit();
    if (typeof data.token !== 'string' || !this.pairing || this.pairing.expires < Date.now() || !(equalSecret(this.pairing.hash, digest(data.token)) || equalSecret(this.pairing.codeHash, digest(data.token)))) fail('This QR code has expired or was already used. Create a new one in Chats.', 403);
    if (this.state.devices.filter(item => item.expires > Date.now()).length >= 8) fail('Disconnect an old device before adding another.');
    this.pairing = null;
    const id = randomUUID(), claim = secret(), code = String(randomInt(100000, 1000000));
    const name = String(data.name || 'My phone').replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, 60) || 'My phone';
    this.pending.set(id, { id, name, code, claimHash: digest(claim), expires: Date.now() + PAIR_TTL });
    this.notify(); return { id, claim, code };
  }
  async approve(id) {
    const item = this.pending.get(id);
    if (!item || item.expires < Date.now()) fail('This connection request has expired.');
    if (!item.approved) {
      const credential = secret();
      this.state.devices.push({ id, name: item.name, hash: digest(credential), createdAt: new Date().toISOString(), lastSeen: null, expires: Date.now() + DEVICE_TTL });
      try { await this.save(); } catch (error) { this.state.devices = this.state.devices.filter(device => device.id !== id); throw error; }
      item.credential = credential; item.approved = true;
    }
    this.notify(); return this.status();
  }
  async revoke(id) {
    this.dictation.revoke(id);
    this.pending.delete(id); this.state.devices = this.state.devices.filter(item => item.id !== id);
    for (const ws of this.clients) if (ws.deviceId === id) ws.close(1008, 'Device disconnected');
    await this.save(); this.notify(); return this.status();
  }
  cookie(value, remove = false) {
    return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/mobile/; Max-Age=${remove ? 0 : DEVICE_TTL / 1000}${this.origin.startsWith('https:') ? '; Secure' : ''}`;
  }
  device(request) {
    const credential = String(request.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!credential || credential.length > 100) fail('Connect this phone from the QR code in Mr. Mak Chats.', 401);
    const hash = digest(credential), device = this.state.devices.find(item => item.expires > Date.now() && equalSecret(item.hash, hash));
    if (!device) fail('This phone is disconnected. Scan a new QR code in Chats.', 401);
    return device;
  }
  checkRequest(request, mutation = false) {
    if (!this.active) fail('Mobile access is off. Enable it in Mr. Mak Chats.', 503);
    if (request.headers.host !== new URL(this.origin).host) fail('Unexpected host', 403);
    if ((mutation || request.headers.origin) && request.headers.origin !== this.origin) fail('Unexpected origin', 403);
    // QR scanners can open the public app shell as a cross-site navigation.
    // This exception never applies to API calls, embedded pages or WebSockets.
    const pathname = new URL(request.url, this.origin).pathname;
    const shellNavigation = !mutation && request.method === 'GET'
      && (pathname === '/mobile/' || pathname === '/mobile')
      && request.headers['sec-fetch-mode'] === 'navigate'
      && request.headers['sec-fetch-dest'] === 'document';
    if (request.headers['sec-fetch-site'] === 'cross-site' && !shellNavigation) fail('Cross-site requests are not allowed', 403);
  }
  session(id) {
    const session = this.sessions.get(id);
    if (session.agent === 'shell') fail('Mobile access supports agent chats.', 403);
    return session;
  }
  list() { return this.sessions.list().filter(item => item.agent !== 'shell'); }
  broadcast(event) { for (const ws of this.clients) send(ws, event); }
  connect(ws, device) {
    ws.deviceId = device.id; ws.alive = true; ws.sessionId = null; this.clients.add(ws);
    device.lastSeen = new Date().toISOString(); this.save().catch(() => {}); this.notify();
    send(ws, { type: 'connected', sessions: this.list() });
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', async raw => {
      try {
        if (!this.active || !this.state.devices.some(item => item.id === device.id && item.expires > Date.now())) return ws.close(1008, 'Disconnected');
        const event = JSON.parse(raw.toString());
        if (event.type === 'subscribe') {
          this.session(event.id); ws.sessionId = event.id;
          const snapshot = await this.sessions.snapshot(event.id);
          if (ws.sessionId === event.id) send(ws, { type: 'snapshot', ...snapshot });
        } else if (event.type === 'seen' && ws.sessionId === event.id) this.sessions.seen(event.id, event.completionVersion);
        else if (event.type === 'ping') send(ws, { type: 'pong' });
        else fail('This mobile action is not available.');
      } catch (error) { send(ws, { type: 'error', error: publicError(error) }); }
    });
    ws.on('close', () => { this.clients.delete(ws); this.notify(); }); ws.on('error', () => {});
  }
  async submit(device, id, data) {
    if (!uuid(data.requestId)) fail('A message ID is required.');
    const text = typeof data.text === 'string' ? data.text : '';
    if (text.length > 60000 || !Array.isArray(data.images || []) || (data.images || []).length > 12) fail('Message is too large.');
    const images = data.images || [];
    const key = `${device.id}:${data.requestId}`, hash = digest(JSON.stringify({ id, text, images }));
    const existing = this.state.receipts.find(item => item.key === key);
    if (existing && existing.hash !== hash) fail('This message ID already belongs to different text.', 409);
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (existing) return existing;
    const session = this.session(id);
    if (!session.process) fail('Resume this chat before sending a message.');
    const paths = images.map(image => {
      const item = this.uploads.get(image);
      if (!item || item.deviceId !== device.id || item.expires < Date.now()) fail('An attachment expired. Attach the image again.');
      return item.path;
    });
    if (!text.trim() && !paths.length) fail('Write a message or attach an image.');
    const receipt = { key, hash, requestId: data.requestId, sessionId: id, status: 'sending', at: new Date().toISOString() };
    const operation = (async () => {
      this.state.receipts.push(receipt);
      // Bound disk usage without dropping a pending operation.
      while (this.state.receipts.length > 2000) {
        const index = this.state.receipts.findIndex(item => item.status !== 'sending');
        if (index < 0) break;
        this.state.receipts.splice(index, 1);
      }
      await this.save(); // Receipt exists durably BEFORE any terminal write.
      const previous = this.queues.get(id) || Promise.resolve();
      const delivery = previous.catch(() => {}).then(async () => {
        const current = this.session(id), process = current.process;
        if (!process) { receipt.status = 'failed'; receipt.error = 'The chat stopped before delivery.'; return; }
        if (!this.active || !this.state.devices.some(item => item.id === device.id)) { receipt.status = 'failed'; receipt.error = 'This phone was disconnected before delivery.'; return; }
        const clean = `${text}${paths.length ? '\n' + attachmentText(paths, current.agent) : ''}`.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replaceAll('\r', '');
        try {
          // A whole prompt is pasted in one write; desktop selection/geometry is untouched.
          this.sessions.input(id, `\x1b[200~${clean}\x1b[201~`);
          await sleep(500);
          if (current.process !== process) throw new Error('The terminal changed during delivery.');
          this.sessions.input(id, '\r'); receipt.status = 'delivered';
        } catch { receipt.status = 'uncertain'; receipt.error = 'Check the terminal before sending again. Delivery could not be confirmed.'; }
      });
      this.queues.set(id, delivery);
      try { await delivery; await this.save(); return receipt; }
      finally { if (this.queues.get(id) === delivery) this.queues.delete(id); }
    })();
    this.inflight.set(key, operation);
    try { return await operation; } finally { this.inflight.delete(key); }
  }
  async request(request, response) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (request.url.startsWith('/mobile/view/')) return await this.reports.serve(request, response, new URL(request.url, this.origin || this.localOrigin));
      const mutation = !['GET', 'HEAD'].includes(request.method);
      this.checkRequest(request, mutation);
      const url = new URL(request.url, this.origin), route = url.pathname, method = request.method;
      if (route.startsWith('/mobile/api/')) {
        const binary = route === '/mobile/api/images' || route === '/mobile/api/transcribe';
        if (mutation && !binary && !String(request.headers['content-type'] || '').startsWith('application/json')) fail('JSON is required', 415);
        const data = mutation && !binary ? await body(request, 256 * 1024) : {};
        if (method === 'POST' && route === '/mobile/api/pair') return json(response, 200, this.claim(data));
        if (method === 'POST' && route === '/mobile/api/pair/finish') {
          this.rateLimit();
          const pending = this.pending.get(data.id);
          if (!pending || pending.expires < Date.now() || typeof data.claim !== 'string' || !equalSecret(pending.claimHash, digest(data.claim))) fail('Connection request expired. Scan a new QR code.', 403);
          if (!pending.approved) return json(response, 202, { status: 'waiting' });
          response.setHeader('Set-Cookie', this.cookie(pending.credential));
          return json(response, 200, { status: 'connected' });
        }
        const device = this.device(request);
        if (method === 'POST' && route === '/mobile/api/transcribe') return json(response, 200, await this.dictation.transcribe(request, device.id, () => this.active && this.state.devices.some(item => item.id === device.id && item.expires > Date.now())));
        if (method === 'GET' && route === '/mobile/api/reports') return json(response, 200, await this.reports.list());
        if (method === 'POST' && route === '/mobile/api/reports/open') return json(response, 200, await this.reports.open(device, data));
        if (method === 'GET' && route === '/mobile/api/bootstrap') return json(response, 200, { sessions: this.list(), agents: inventory().filter(item => item.id !== 'shell'), device: { id: device.id, name: device.name }, defaultAgent: this.settings().defaultAgent, defaultBypass: this.settings().defaultBypass, dictation: await this.dictation.status() });
        if (method === 'POST' && route === '/mobile/api/disconnect') { await this.revoke(device.id); response.setHeader('Set-Cookie', this.cookie('', true)); return json(response, 200, { disconnected: true }); }
        if (method === 'POST' && route === '/mobile/api/images') {
          if (this.uploads.size >= 150) fail('Too many pending images. Try again later.', 429);
          const chunks = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > MAX_IMAGE_BYTES) fail('Choose an image smaller than 25 MB.', 413); chunks.push(chunk); }
          const image = await this.attachments.save(Buffer.concat(chunks), decodeURIComponent(request.headers['x-file-name'] || 'Phone image'));
          const id = randomUUID(); this.uploads.set(id, { ...image, deviceId: device.id, expires: Date.now() + 24 * 60 * 60 * 1000 });
          return json(response, 201, { id, name: image.name });
        }
        if (method === 'POST' && route === '/mobile/api/sessions') {
          if (!inventory().some(item => item.id !== 'shell' && item.id === data.agent && item.available)) fail('Choose an installed agent.');
          return json(response, 201, await this.sessions.create({ agent: data.agent, name: data.name, cwd: this.repo, bypass: this.settings().defaultBypass === true }));
        }
        const match = /^\/mobile\/api\/sessions\/([a-f0-9-]{36})\/(messages|send|resume|close|key)$/.exec(route);
        if (match) {
          const session = this.session(match[1]);
          if (method === 'GET' && match[2] === 'messages') return json(response, 200, await this.transcripts.read(session));
          if (method === 'POST' && match[2] === 'send') return json(response, 200, await this.submit(device, session.id, data));
          if (method === 'POST' && match[2] === 'resume') return json(response, 200, session.process ? this.list().find(item => item.id === session.id) : await this.sessions.resume(session.id));
          if (method === 'POST' && match[2] === 'close') return json(response, 200, await this.closeChat(session.id));
          if (method === 'POST' && match[2] === 'key') {
            const keys = { enter: '\r', escape: '\x1b', up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', tab: '\t', interrupt: '\x03' };
            if (!Object.hasOwn(keys, data.key)) fail('Unknown terminal key.');
            this.sessions.input(session.id, keys[data.key]); return json(response, 200, { delivered: true });
          }
        }
        fail('Mobile action not found', 404);
      }
      if (!['GET', 'HEAD'].includes(method)) fail('Not allowed', 405);
      if (route === '/mobile/manifest.webmanifest') {
        response.writeHead(200, { 'Content-Type': 'application/manifest+json' });
        response.end(JSON.stringify({ id: '/mobile/', name: 'Mr. Mak Mobile', short_name: 'Mr. Mak', start_url: '/mobile/', scope: '/mobile/', display: 'standalone', background_color: '#0d0e12', theme_color: '#0d0e12', icons: [{ src: '/assets/mak-mobile-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/assets/mak-mobile-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] })); return;
      }
      if (route === '/mobile/sw.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript', 'Service-Worker-Allowed': '/mobile/' });
        response.end(await readFile(new URL('./mobile-sw.js', import.meta.url), 'utf8')); return;
      }
      const relative = route === '/mobile/' || route === '/mobile' ? 'index.html' : route.startsWith('/assets/') ? decodeURIComponent(route.slice(1)) : null;
      if (!relative) fail('Not found', 404);
      const { file, info } = await realFile(this.uiDir, relative);
      if (!info.isFile()) fail('Not found', 404);
      await serveFile(request, response, file, info, {
        'Cache-Control': route.startsWith('/assets/') ? 'private, max-age=3600' : 'no-store', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ${this.origin.replace(/^http/, 'ws')}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      });
    } catch (error) { if (!response.headersSent) json(response, error.status || 400, { error: publicError(error) }); else response.destroy(); }
  }
  async close() {
    if (this.closed) return; this.closed = true;
    this.dictation.close();
    this.active = false; clearInterval(this.timer);
    for (const [event, handler] of Object.entries(this.handlers)) this.sessions.off(event, handler);
    for (const ws of this.clients) ws.terminate(); this.wss.close();
    await Promise.allSettled([...this.inflight.values()]); await this.saves.catch(() => {});
    await this.transport.disable(this.state.route).catch(() => {});
    this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve));
  }
}
