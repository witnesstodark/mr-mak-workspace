import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createService } from '../server.mjs';
import { ANSI_COLOR_KEYS, TERMINAL_COLOR_KEYS, phoneAppNames, phoneName, terminalColors } from '../display-settings.mjs';
import { ansiColorKeys, contrastRatio, effectiveTerminalColor, focusTheme, originalTheme, roleColors, terminalRoleColors, terminalTheme } from '../../../src/desktop/terminalAppearance.ts';

test('terminal colors keep known keys and #rrggbb values only', () => {
  assert.equal(TERMINAL_COLOR_KEYS.length, 24); assert.equal(ANSI_COLOR_KEYS.length, 16);
  assert.deepEqual(terminalColors({ background: '#0A0B0C', attention: '#e0a030', brightCyan: '#00ffee', cursor: null, user: '' }), { background: '#0a0b0c', attention: '#e0a030', brightCyan: '#00ffee' });
  assert.deepEqual(terminalColors(null), {});
  for (const bad of [{ background: 'red' }, { background: '#fff' }, { background: '#12345678' }, { foreground: 12 }, { shadow: '#000000' }, ['#000000'], 'dark'])
    assert.throws(() => terminalColors(bad), error => error.status === 400);
});

test('overrides lie over both appearances; the desktop and the service know the same keys', () => {
  assert.deepEqual([...ansiColorKeys], ANSI_COLOR_KEYS);
  const colors = { background: '#101820', foreground: '#f0e6d2', cursor: '#ffb86c', selection: '#335577', agent: '#ddeeff', attention: '#e0a030', red: '#ff5555' };
  for (const appearance of ['original', 'focus']) {
    const theme = terminalTheme(appearance, colors), base = appearance === 'focus' ? focusTheme : originalTheme;
    assert.equal(theme.background, '#101820'); assert.equal(theme.foreground, '#f0e6d2'); assert.equal(theme.cursor, '#ffb86c');
    assert.equal(theme.selectionBackground, '#33557755', 'Selection stays translucent');
    assert.equal(theme.red, '#ff5555');
    // Attention is a role colour (flagged blocks), not the CLI's yellow.
    assert.equal(theme.yellow, base.yellow); assert.equal(theme.brightYellow, base.brightYellow);
    assert.equal(theme.green, base.green, 'Unset colours keep the appearance');
    assert.deepEqual(terminalTheme(appearance, {}), base);
  }
  // Iaar Focus draws text in the agent role colour unless Text is set too.
  assert.equal(terminalTheme('focus', { agent: '#ddeeff' }).foreground, '#ddeeff');
  assert.equal(terminalTheme('original', { agent: '#ddeeff' }).foreground, originalTheme.foreground);
  assert.deepEqual(terminalRoleColors({ user: '#112233' }), { ...roleColors, user: '#112233' });
  assert.deepEqual(terminalRoleColors({ attention: '#e0a030' }), { ...roleColors, attention: '#e0a030' });
  assert.equal(effectiveTerminalColor('attention', 'original', {}), roleColors.attention);
  assert.equal(effectiveTerminalColor('attention', 'focus', { attention: '#e0a030' }), '#e0a030');
  assert.equal(effectiveTerminalColor('selection', 'original', {}), '#f0a0b0');
  assert.equal(effectiveTerminalColor('brightRed', 'original', {}), '#ef2929', 'xterm fills colours Original leaves unset');
  assert.equal(effectiveTerminalColor('yellow', 'original', { yellow: '#123456', attention: '#e0a030' }), '#123456');
  assert.equal(Math.round(contrastRatio('#ffffff', '#000000')), 21); assert.ok(contrastRatio('#555566', '#0c0d10') < 4.5); assert.ok(contrastRatio(originalTheme.foreground, originalTheme.background) >= 4.5);
});

test('the phone name is short plain text, with Iaar as the default', () => {
  assert.equal(phoneName('  Mobz  '), 'Mobz'); assert.equal(phoneName(''), 'Iaar'); assert.equal(phoneName(undefined), 'Iaar');
  assert.equal(phoneName('Studio\n<PC>'), 'Studio PC');
  assert.equal(phoneName('x'.repeat(30)).length, 30);
  assert.throws(() => phoneName('x'.repeat(31)), /30 characters/); assert.throws(() => phoneName(42), /text/);
  assert.deepEqual(phoneAppNames('Mobz'), { short: 'Mobz', name: 'Mobz · Iaar' });
  assert.deepEqual(phoneAppNames(undefined), { short: 'Iaar', name: 'Iaar Mobile' });
  assert.deepEqual(phoneAppNames('y'.repeat(80)), { short: 'Iaar', name: 'Iaar Mobile' }, 'A hand-edited value never breaks the manifest');
});

test('the service worker never answers the manifest from its cache', () => {
  const listeners = {};
  const source = readFile(new URL('../mobile-sw.js', import.meta.url), 'utf8');
  return source.then(code => {
    vm.runInNewContext(code, { self: { addEventListener: (type, listener) => { listeners[type] = listener; }, location: { origin: 'https://pc.example.ts.net:8443' } }, URL, caches: { open: async () => ({ put() {} }), match: async () => undefined }, fetch: async () => new Response('shell'), Response });
    const handled = pathname => { let used = false; listeners.fetch({ request: { method: 'GET', url: `https://pc.example.ts.net:8443${pathname}` }, respondWith: () => { used = true; } }); return used; };
    assert.equal(handled('/mobile/manifest.webmanifest'), false);
    assert.equal(handled('/mobile/'), true);
  });
});

async function service(t) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'iaar-display-'));
  await mkdir(path.join(repo, 'ui')); await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'ui/index.html'), '<html>Display</html>'); await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const transport = { probe: async () => ({ ready: true }), enable: async origin => ({ origin }), disable: async () => {} };
  const dictation = { status: async () => ({ available: false, provider: null, maxSeconds: 0, maxBytes: 0 }), close() {}, revoke() {} };
  const instance = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport, dictation }, mcpOptions: { home: repo, env: {} } });
  t.after(() => instance.close());
  const desktop = (route, data, method = data === undefined ? 'GET' : 'POST') => fetch(`${instance.origin}/api${route}`, { method, headers: { Authorization: `Bearer ${instance.token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }).then(async response => ({ status: response.status, data: await response.json() }));
  await instance.mobile.enable();
  const phone = async (route, data, cookie, headers = {}) => {
    const response = await fetch(`${instance.mobile.origin}/mobile${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { Origin: instance.mobile.origin, 'Content-Type': 'application/json' }), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  const pair = async () => {
    const qr = await instance.mobile.newPairing(), claim = (await phone('/api/pair', { token: new URL(qr.url).hash.slice(6), name: 'Phone' })).data;
    await instance.mobile.approve(claim.id);
    return (await phone('/api/pair/finish', claim)).cookie;
  };
  const socket = async (url, options) => {
    const ws = new WebSocket(url, options), messages = [];
    ws.on('message', raw => messages.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    t.after(() => ws.terminate());
    return { ws, messages };
  };
  return { repo, instance, desktop, phone, pair, socket };
}
const until = async (check, timeout = 3000) => { const end = Date.now() + timeout; while (!check()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 20)); } };

test('settings validate terminal colors and the phone name, persist them and update paired phones live', async t => {
  const { repo, instance, desktop, phone, pair, socket } = await service(t);
  const cookie = await pair();
  const live = await socket(`${instance.mobile.origin.replace('http', 'ws')}/mobile/events`, { headers: { Origin: instance.mobile.origin, Cookie: cookie } });
  const before = instance.mobile.display();
  assert.deepEqual(before, { terminalColors: {}, appName: 'Iaar' });
  // One invalid value refuses the whole request; nothing else changes.
  const refused = await desktop('/settings', { defaultBypass: true, terminalColors: { background: 'black' } });
  assert.equal(refused.status, 400); assert.match(refused.data.error, /#rrggbb/);
  assert.equal((await desktop('/settings', { terminalColors: { glow: '#ffffff' } })).status, 400);
  assert.equal((await desktop('/settings', { phoneName: 'A name that is far too long for a phone' })).status, 400);
  assert.equal((await desktop('/bootstrap')).data.settings.defaultBypass, false);
  const saved = await desktop('/settings', { terminalColors: { background: '#101820', foreground: '#F0E6D2', attention: '#e0a030' }, phoneName: 'Mobz' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.terminalColors, { background: '#101820', foreground: '#f0e6d2', attention: '#e0a030' });
  assert.equal(saved.data.phoneName, 'Mobz');
  await until(() => live.messages.some(message => message.type === 'display'));
  assert.deepEqual(live.messages.find(message => message.type === 'display'), { type: 'display', terminalColors: saved.data.terminalColors, appName: 'Mobz' });
  const bootstrap = (await phone('/api/bootstrap', undefined, cookie)).data;
  assert.equal(bootstrap.appName, 'Mobz'); assert.deepEqual(bootstrap.terminalColors, saved.data.terminalColors);
  const file = JSON.parse(await readFile(path.join(repo, '.iaar', 'settings.json'), 'utf8'));
  assert.equal(file.phoneName, 'Mobz'); assert.equal(file.terminalColors.foreground, '#f0e6d2');
  // Clearing returns to the appearance colours and the default name.
  const cleared = await desktop('/settings', { terminalColors: {}, phoneName: '' });
  assert.deepEqual(cleared.data.terminalColors, {}); assert.equal(cleared.data.phoneName, 'Iaar');
});

test('the manifest carries the phone name and is never cached', async t => {
  const { desktop, phone } = await service(t);
  const before = await phone('/manifest.webmanifest');
  assert.equal(before.data.short_name, 'Iaar'); assert.equal(before.data.name, 'Iaar Mobile');
  assert.equal(before.headers.get('cache-control'), 'no-store');
  await desktop('/settings', { phoneName: 'Mobz' });
  const after = await phone('/manifest.webmanifest');
  assert.equal(after.data.short_name, 'Mobz'); assert.equal(after.data.name, 'Mobz · Iaar'); assert.equal(after.data.id, '/mobile/');
  assert.equal(after.headers.get('cache-control'), 'no-store');
});

test('a paired phone renames a chat with the desktop rules, and every window sees it', async t => {
  const { instance, phone, pair, socket } = await service(t);
  const id = randomUUID();
  const session = instance.sessions.make({ id, name: 'Conversation 5', agent: 'claude', open: true, status: 'running', createdAt: new Date().toISOString(), cols: 80, rows: 24 });
  instance.sessions.items.set(id, session);
  const cookie = await pair(), other = await pair();
  const otherPhone = await socket(`${instance.mobile.origin.replace('http', 'ws')}/mobile/events`, { headers: { Origin: instance.mobile.origin, Cookie: other } });
  const desktopEvents = await socket(`${instance.origin.replace('http', 'ws')}/events`, { origin: instance.origin });
  desktopEvents.ws.send(JSON.stringify({ type: 'auth', token: instance.token, surface: 'chats' }));
  await until(() => desktopEvents.messages.some(message => message.type === 'connected'));
  const route = `/api/sessions/${id}/rename`;
  assert.equal((await phone(route, { name: 'Banner design' })).status, 401);
  assert.equal((await phone(route, { name: 'Banner design' }, cookie, { Origin: 'https://unrelated.example' })).status, 403);
  const english = await phone(route, { name: 'Дизайн баннера' }, cookie);
  assert.equal(english.status, 400); assert.match(english.data.error, /English chat name/);
  assert.equal((await phone(route, { name: '   ' }, cookie)).status, 400);
  assert.equal(session.name, 'Conversation 5');
  const renamed = await phone(route, { name: '  Banner   design ' }, cookie);
  assert.equal(renamed.status, 200); assert.equal(renamed.data.name, 'Banner design'); assert.equal(session.name, 'Banner design');
  await until(() => otherPhone.messages.some(message => message.type === 'session' && message.session.name === 'Banner design'));
  await until(() => desktopEvents.messages.some(message => message.type === 'session' && message.session.name === 'Banner design'));
});
