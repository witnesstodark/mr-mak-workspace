// Two independent browser clients, a local test transport and stub CLI processes.
// No personal conversations, paid requests or Tailscale configuration are touched.
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cp, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createService } from '../server.mjs';
import { MobileDictation } from '../mobile-dictation.mjs';
import { launchBrowser, testBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/mobile-ui-'));
await mkdir(path.join(repo, 'workspace/report'), { recursive: true });
await mkdir(path.join(repo, 'workspace/_shared'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
for (const name of ['mak-nose.svg', 'mak-nose-chats.svg', 'mak-mobile-192.png', 'mak-mobile-512.png']) await copyFile(path.join(root, 'public/assets', name), path.join(repo, 'ui/assets', name));
for (const name of ['report.css', 'report.js']) await copyFile(path.join(root, 'workspace/_shared', name), path.join(repo, 'workspace/_shared', name));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQ42mP8/x8AAwMCAO+jvWQAAAAASUVORK5CYII='.replace('EQ42', 'EQVR42'), 'base64');
await writeFile(path.join(repo, 'shared-picture.png'), png);
// Use a supplied SVG as a visible report image; the PNG is only an upload fixture.
await copyFile(path.join(root, 'public/assets/mak-nose.svg'), path.join(repo, 'workspace/report/nose.svg'));
await writeFile(path.join(repo, 'workspace/report/index.html'), '<!doctype html><html lang="en" data-mak-report="document"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../_shared/report.css"><script defer src="../_shared/report.js"></script></head><body><main class="container"><h1>Report ready</h1><p>A readable result on your phone.</p><img src="nose.svg" alt="Report image" width="160"><p><a target="_blank" rel="noreferrer" href="https://example.com/source">Source link</a></p><div id="nested-scroll" style="height:100px;overflow:auto"><div style="height:600px">Nested content</div></div><div id="delayed-content" style="height:0">Long report content</div><script>window.addEventListener("load", () => setTimeout(() => document.getElementById("delayed-content").style.height = "2200px", 300))</script></main></body></html>');
await writeFile(path.join(repo, 'workspace/report/plan.md'), '# Mobile plan\n\n**Keep the useful parts in view.**\n\n- Read results\n- Send a follow-up\n' + Array.from({ length: 60 }, (_, index) => `\nParagraph ${index + 1}: Read and continue reviewing this report.\n`).join(''));
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'mobile-report', title: 'A useful report', folder: 'report', category: 'dev', created: '2026-10-06', steps: [{ name: 'Report', path: 'index.html' }, { name: 'Plan', path: 'plan.md' }] }] }));
const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
const voiceCalls = [];
const dictation = new MobileDictation(repo, { env: { OPENROUTER_API_KEY: 'test-voice-key', MRMAK_TRANSCRIBE_PROVIDER: 'openrouter' }, fetcher: async (url, options) => {
  voiceCalls.push({ url, size: options.body.get('file').size });
  return Response.json({ text: 'A dictated follow-up.' });
} });
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport, dictation }, mcpOptions: { home: repo, env: {} } });
service.sessions.beginDiscovery = () => {};
// Lost replies: the server handles the request, then the connection drops before
// the reply. The phone's requests pass through its service worker, which
// Playwright's WebKit cannot route, so WebKit simulates this on the server.
const dropReplies = new Set(); let dropHooked = false;
async function loseNextReply(page, part) {
  if (testBrowser === 'webkit') {
    // The phone talks to the mobile server, which starts when mobile access is enabled.
    if (!dropHooked) {
      dropHooked = true;
      service.mobile.server.prependListener('request', (request, response) => {
        const match = [...dropReplies].find(item => request.url.includes(item));
        if (match) { dropReplies.delete(match); response.end = () => { request.socket.destroy(); return response; }; }
      });
    }
    dropReplies.add(part); return;
  }
  // Chromium transparently retries a POST whose connection drops, so it keeps page.route.
  await page.route(`**${part}`, async route => { await route.fetch(); await route.abort('failed'); });
}
const restoreReplies = (page, part) => testBrowser === 'webkit' ? undefined : page.unroute(`**${part}`);
service.mobile.readAloud = { status: async () => ({ available: true }), synthesize: async () => Buffer.from('RIFFfakeWAVE'), revoke() {}, close() {} };
let recordingName = 'recording.webm';
const writes = [], ids = [randomUUID(), randomUUID()];
for (const [index, id] of ids.entries()) {
  const session = service.sessions.make({ id, name: index ? 'Research ideas' : 'Game animations', agent: index ? 'claude' : 'codex', status: 'running', open: true, pinned: !index, cols: 100, rows: 28, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cwd: repo });
  const exits = new Set();
  session.process = { write: data => writes.push({ id, data }), resize: () => {}, onExit: callback => { exits.add(callback); return { dispose: () => exits.delete(callback) }; }, kill: () => { session.process = null; session.status = 'closed'; service.sessions.changed(session); for (const callback of [...exits]) callback({ exitCode: 0 }); } };
  service.sessions.items.set(id, session); await service.sessions.hydrate(session);
  session.preview = 'Latest notes: [Review the animation](C:/Projects/game/characters/' + 'very-long-character-name-'.repeat(12) + '/review.html) and https://example.com/research/' + 'reference'.repeat(40);
  await new Promise(resolve => session.terminal.write(Array.from({ length: 90 }, (_, line) => `Line ${line + 1}: live agent output\r\n`).join('') + `╭${'─'.repeat(60)}╮\r\n│ A long reply line that the desktop terminal draws at its full width and the phone wraps.      │\r\n`, resolve));
}
service.mobile.transcripts.read = async session => ({ supported: true, activity: [{ id: 'tool-one', name: 'Read test file', status: 'completed', at: new Date().toISOString() }],
  agents: [{ id: 'agent-one', name: 'Bot Coder: task 8', type: 'general-purpose', step: 'Bash · Run the tests', startedAt: new Date(Date.now() - 5 * 60000).toISOString(), updatedAt: new Date().toISOString() }],
  commands: [{ id: 'command-one', name: 'PowerShell', title: 'Run the Playwright suite', startedAt: new Date(Date.now() - 2 * 60000).toISOString(), agent: 'Bot Coder: task 8' }], messages: [
  { id: 'old-user', role: 'user', text: 'Older request excluded from speech.', at: '' },
  { id: 'old-agent', role: 'assistant', text: 'Older answer excluded from speech.', at: '' },
  { id: 'user', role: 'user', text: 'Can we make the next iteration easier to review?', at: new Date().toISOString() },
  { id: 'progress', role: 'assistant', text: 'Intermediate agent progress is included.', at: '' },
  { id: 'assistant', role: 'assistant', imageRefs: [path.join(repo, 'shared-picture.png'), path.join(repo, recordingName)], text: '## Ready for review\n\nThe latest results are in your Workspace.\n\n- **Character:** proportions updated\n- **Motion:** timing checked\n- **Next step:** choose the version you prefer\n\n[Open the source](https://example.com/source)\n\n' + (session.id === ids[0] ? 'Your agent is still working on the computer.' : 'Send a follow-up whenever an idea comes to mind.'), at: new Date().toISOString() },
] });
let browser, qrSource, diagnosticPhone;
const reportResponses = [];
try {
  browser = await launchBrowser({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const recordingPage = await browser.newPage();
  const recorded = await recordingPage.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d'), stream = canvas.captureStream(15);
    const mimeType = ['video/webm;codecs=vp8', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, { mimeType }), parts = [];
    const finished = new Promise(resolve => { recorder.ondataavailable = event => parts.push(event.data); recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(parts).arrayBuffer()))); });
    recorder.start();
    const draw = setInterval(() => { ctx.fillStyle = Date.now() % 2 ? 'blue' : 'green'; ctx.fillRect(0,0,160,90); }, 30);
    await new Promise(resolve => setTimeout(resolve, 800)); recorder.stop(); clearInterval(draw);
    const bytes = await finished; stream.getTracks().forEach(track => track.stop()); return { bytes, name: mimeType.startsWith('video/mp4') ? 'recording.mp4' : 'recording.webm' };
  });
  recordingName = recorded.name;
  await writeFile(path.join(repo, recordingName), Buffer.from(recorded.bytes)); await recordingPage.close();
  const desktop = await browser.newPage({ viewport: { width: 640, height: 860 } }); desktop.setDefaultTimeout(12000);
  const errors = []; desktop.on('pageerror', error => errors.push(error.message));
  await desktop.goto(service.urls.chats); await desktop.getByRole('button', { name: 'Mobile access', exact: true }).click();
  const pairingResponse = desktop.waitForResponse(response => response.url().endsWith('/api/mobile/pair') && response.request().method() === 'POST');
  await desktop.getByRole('button', { name: 'Enable & show QR code' }).click();
  const pairing = await (await pairingResponse).json();
  const manifest = await (await fetch(`${service.mobile.origin}/mobile/manifest.webmanifest`)).json();
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(item => item.sizes === `${size}x${size}`);
    const response = await fetch(`${service.mobile.origin}${icon.src}`);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/png/);
  }
  await desktop.getByAltText('Scan to connect this phone to Mr. Mak').waitFor();
  await desktop.screenshot({ path: path.join(repo, 'desktop-pairing.png') });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await mobileContext.addInitScript(() => {
    // Patch the prototype (WebKit ignores an own-property override). Chromium uses its
    // fake capture device; headless WebKit has none, so fall back to a synthetic tone.
    const original = MediaDevices.prototype.getUserMedia;
    const CaptureAudioContext = window.testCaptureAudioContext || window.AudioContext;
    window.testMicTracks = [];
    MediaDevices.prototype.getUserMedia = async function (options) {
      if (window.testDenyMic) { window.testDenyMic = false; throw new DOMException('Permission denied', 'NotAllowedError'); }
      let stream;
      try { stream = await original.call(this, options); } catch {
        const audio = new CaptureAudioContext(), tone = audio.createOscillator(), output = audio.createMediaStreamDestination();
        tone.connect(output); tone.start(); stream = output.stream;
      }
      window.testMicTracks.push(...stream.getTracks()); return stream;
    };
  });
  await mobileContext.addInitScript(() => {
    window.testCaptureAudioContext = window.AudioContext;
    window.testSpeech = { spoken: [], cancelled: 0, paused: false, current: null, closed: true };
    const originalFetch = window.fetch;
    window.fetch = (url, options) => { if (String(url).endsWith('/read-aloud') && options?.body) { const data = JSON.parse(options.body); window.testSpeech.spoken.push({ text: data.text, voice: data.voice }); } return originalFetch(url, options); };
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class {
      constructor() { window.testSpeech.closed = false; this.destination = {}; }
      resume() { window.testSpeech.paused = false; return Promise.resolve(); }
      suspend() { window.testSpeech.paused = true; return Promise.resolve(); }
      close() { window.testSpeech.closed = true; window.testSpeech.current = null; window.testSpeech.cancelled++; return Promise.resolve(); }
      decodeAudioData() { return Promise.resolve({}); }
      createBufferSource() { return { connect() {}, start() { window.testSpeech.current = { onend: () => this.onended?.() }; } }; }
    } });
  });
  await mobileContext.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.testConnections = []; window.testDelayedSockets = [];
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); window.testConnections.push(this); }
      close(...args) { if (window.testDelayClose) { window.testDelayedSockets.push(this); return; } super.close(...args); }
    };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.testVisibility || 'visible' });
  });
  let reloadingPhone = false;
  const navigationCancellations = [];
  const phone = await mobileContext.newPage(); phone.setDefaultTimeout(12000);
  diagnosticPhone = phone;
  phone.on('response', async response => {
    if (!response.url().endsWith('/mobile/api/reports/open')) return;
    const value = await response.json().catch(() => ({}));
    reportResponses.push({ status: response.status(), kind: value.kind, step: value.step, error: value.error });
  });
  await phone.exposeFunction('testUnhandledRejection', message => errors.push(`Unhandled rejection: ${message}`));
  await phone.addInitScript(() => window.addEventListener('unhandledrejection', event => { void window.testUnhandledRejection(String(event.reason)).catch(() => {}); }));
  phone.on('pageerror', error => {
    // WebKit emits native access-control diagnostics for reads cancelled by a
    // document reload even when fetch is caught. Permit only these two local
    // read routes during our own reload; all JS errors/rejections still fail.
    const route = error.message.match(/\/mobile\/api\/(bootstrap|sessions\/[a-f0-9-]+\/messages) due to access control checks\.$/)?.[1];
    const local = error.message.includes(new URL(service.mobile.origin).host + '/mobile/api/');
    if (testBrowser === 'webkit' && reloadingPhone && local && route) navigationCancellations.push(error.message);
    else errors.push(error.message);
  });
  async function reloadPhone() {
    reloadingPhone = true;
    try { await phone.reload(); } finally { reloadingPhone = false; }
  }
  // Open from another site like a QR scanner, rather than an address-bar visit.
  qrSource = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<a href="${pairing.url}">Open Mr. Mak</a>`);
  });
  await new Promise(resolve => qrSource.listen(0, 'localhost', resolve));
  await phone.goto(`http://localhost:${qrSource.address().port}`);
  // Playwright's request interception omits Sec-Fetch headers from its client
  // snapshot. Assert the header received by the server that enforces it.
  const navigationSite = new Promise(resolve => {
    const inspect = request => {
      if (request.url.startsWith('/mobile/') && request.headers['sec-fetch-dest'] === 'document') {
        service.mobile.server.off('request', inspect); resolve(request.headers['sec-fetch-site']);
      }
    };
    service.mobile.server.on('request', inspect);
  });
  await phone.getByRole('link', { name: 'Open Mr. Mak' }).click();
  assert.equal(await navigationSite, 'cross-site');
  await phone.getByRole('button', { name: 'Request connection' }).click();
  await phone.getByRole('heading', { name: 'Confirm on your computer' }).waitFor();
  await desktop.getByRole('button', { name: 'Connect phone', exact: true }).click();
  await phone.getByRole('heading', { name: 'Chats', exact: true }).waitFor();
  await desktop.getByText('Connected now', { exact: true }).waitFor();
  assert.deepEqual(await phone.locator('.mobile-header button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['Reconnect', 'New chat', 'History', 'Chats', 'Results', 'Phone settings']);
  await phone.getByRole('button', { name: 'History', exact: true }).click();
  await phone.getByRole('heading', { name: 'History', exact: true }).waitFor();
  assert.deepEqual(await phone.locator('.mobile-main-nav button.active').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['History']);
  assert.equal(await phone.locator('.mobile-header-count').count(), 1);
  assert.equal(await phone.locator('.mobile-list-count').count(), 0);
  // The phone's back gesture returns to the screen above instead of leaving the app. Esc is the
  // desktop's close request, the same one Android's back gesture sends.
  await phone.keyboard.press('Escape');
  await phone.getByRole('heading', { name: 'Chats', exact: true }).waitFor();
  assert.deepEqual(await phone.locator('.mobile-main-nav button.active').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['Chats']);
  assert.equal(await phone.locator('.mobile-connection-logo').evaluate(dot => getComputedStyle(dot).animationDuration), '3.6s');
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await phone.locator('.mobile-connection-logo').evaluate(dot => getComputedStyle(dot).animationName), 'none');
  await phone.emulateMedia({ reducedMotion: 'no-preference' });
  const documentIdentity = await phone.evaluate(() => { window.testDocumentIdentity = Math.random(); return window.testDocumentIdentity; });
  await phone.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await phone.waitForFunction(() => !document.querySelector('.mobile-offline'));
  assert.equal(await phone.evaluate(() => window.testDocumentIdentity), documentIdentity, 'Reconnect never reloads the document');
  await phone.getByRole('heading', { name: 'Chats', exact: true }).waitFor();
  for (const width of [320, 360, 393, 430, 768]) {
    await phone.setViewportSize({ width, height: 844 });
    const layout = await phone.evaluate(() => {
      const selectors = ['.mobile-chat-list', '.mobile-chat-cards', '.mobile-chat-card', '.mobile-header', '.mobile-main-nav', '.mobile-search'];
      return [...document.querySelectorAll(selectors.join(','))].map(node => ({ selector: node.className, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, client: node.clientWidth, scroll: node.scrollWidth }));
    });
    await phone.screenshot({ path: path.join(repo, `phone-chats-${width}.png`) });
    assert.deepEqual(layout.filter(box => box.left < -1 || box.right > width + 1 || box.scroll > box.client + 1), [], `Chat list stays in bounds at ${width}px: ${JSON.stringify(layout)}`);
  }
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.screenshot({ path: path.join(repo, 'phone-chats.png') });
  // Browser eligibility is simulated; the native Android installation remains a phone check.
  await phone.evaluate(() => {
    window.installCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.installCalls++; };
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await phone.getByRole('complementary', { name: 'Install Mr. Mak' }).waitFor();
  assert.equal(await phone.evaluate(() => window.installCalls), 0, 'Never open installation without a tap');
  await phone.screenshot({ path: path.join(repo, 'phone-install.png') });
  await phone.getByRole('button', { name: 'Not now', exact: true }).click();
  assert.equal(await phone.getByRole('complementary', { name: 'Install Mr. Mak' }).count(), 0);
  await phone.getByRole('button', { name: 'Phone settings' }).click();
  const speechProvider = phone.getByRole('combobox', { name: 'Dictation provider' });
  await speechProvider.selectOption('local'); await expect(speechProvider).toHaveValue('local');
  await phone.getByText(/Local Whisper needs setup on your computer/).waitFor();
  await speechProvider.selectOption('openrouter'); await expect(speechProvider).toHaveValue('openrouter');
  await phone.getByRole('button', { name: 'Install Mr. Mak', exact: true }).click();
  assert.equal(await phone.evaluate(() => window.installCalls), 1);
  await phone.getByRole('button', { name: 'Phone settings' }).click();
  await phone.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.installCalls++; };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  assert.equal(await phone.getByRole('complementary', { name: 'Install Mr. Mak' }).count(), 0, 'Not now persists for this session');
  await phone.getByRole('button', { name: 'Phone settings' }).click();
  await phone.getByRole('button', { name: 'Install Mr. Mak', exact: true }).click();
  await phone.getByText('Mr. Mak is installed on this phone.', { exact: true }).waitFor();
  await phone.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await phone.getByRole('button', { name: 'Phone settings' }).click();

  const dimensions = ids.map(id => ({ cols: service.sessions.get(id).cols, rows: service.sessions.get(id).rows }));
  const desktopSelected = (await (await fetch(`${service.origin}/api/bootstrap`, { headers: { Authorization: `Bearer ${service.token}` } })).json()).selectedId;
  await phone.getByRole('button', { name: /Research ideas/ }).click();
  await phone.getByRole('heading', { name: 'Ready for review' }).waitFor();
  const modeButtons = phone.getByRole('group', { name: 'Conversation view' });
  async function swipeModes(dx, dy = 0, clickIndex = -1) {
    await modeButtons.evaluate((node, { dx, dy, clickIndex }) => {
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: 120, clientY: 100 }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: 120 + dx, clientY: 100 + dy }));
      if (clickIndex >= 0) node.querySelectorAll('button')[clickIndex].click();
    }, { dx, dy, clickIndex });
  }
  assert.ok(await phone.locator('.mobile-chat-tools').evaluate(node => node.getBoundingClientRect().height <= 34), 'No vertical spacing around compact tabs');
  await swipeModes(-70, 0, 0); await phone.locator('.mobile-terminal').waitFor();
  await swipeModes(70, 0, 1); await phone.locator('.mobile-messages').waitFor();
  await swipeModes(-15); assert.equal(await phone.locator('.mobile-terminal').count(), 0, 'Tiny movement is not a swipe');
  await swipeModes(-60, 90); assert.equal(await phone.locator('.mobile-terminal').count(), 0, 'Vertical gesture does not switch');
  await phone.locator('.mobile-messages').evaluate(node => {
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, isPrimary: true, clientX: 150, clientY: 200 }));
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, isPrimary: true, clientX: 50, clientY: 200 }));
  });
  assert.equal(await phone.locator('.mobile-terminal').count(), 0, 'Swiping conversation content never switches modes');
  await modeButtons.getByRole('button', { name: 'Terminal', exact: true }).click(); await phone.locator('.mobile-terminal').waitFor();
  await modeButtons.getByRole('button', { name: 'Conversation', exact: true }).click(); await phone.locator('.mobile-messages').waitFor();
  service.sessions.nativeEvent(service.sessions.get(ids[1]), { kind: 'turn-started' });
  const conversationImage = phone.locator('.mobile-conversation-image img').first();
  await conversationImage.waitFor();
  await expect(conversationImage).toHaveJSProperty('naturalWidth', 1);
  await phone.getByRole('button', { name: 'Enlarge shared-picture.png' }).first().click();
  const imagePreview = phone.getByRole('dialog', { name: 'Shared image preview' });
  await expect(imagePreview).toBeVisible();
  const viewerSize = await imagePreview.boundingBox();
  assert.equal(Math.round(viewerSize.width), 390); assert.equal(Math.round(viewerSize.height), 844);
  await imagePreview.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(imagePreview.getByRole('button', { name: 'Reset image zoom' })).toHaveText('150%');
  await imagePreview.getByRole('button', { name: 'Reset image zoom' }).click();
  const stage = await imagePreview.locator('.mobile-image-stage').boundingBox();
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  const points = offset => [{ x: cx - offset, y: cy, id: 1 }, { x: cx + offset, y: cy, id: 2 }];
  if (testBrowser === 'webkit') {
    // Playwright exposes native multi-touch through Chromium CDP only. Exercise
    // the pointer handlers in WebKit; native iOS pinch still needs device review.
    await imagePreview.locator('.mobile-image-stage').evaluate((node, { cx, cy }) => {
      const capture = node.setPointerCapture; node.setPointerCapture = () => {};
      const pointer = (type, id, x) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, clientX: x, clientY: cy }));
      pointer('pointerdown', 1, cx - 40); pointer('pointerdown', 2, cx + 40);
      pointer('pointermove', 1, cx - 80); pointer('pointermove', 2, cx + 80);
      pointer('pointerup', 1, cx - 80); pointer('pointerup', 2, cx + 80);
      node.setPointerCapture = capture;
    }, { cx, cy });
  } else {
    const touch = await mobileContext.newCDPSession(phone);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(40) });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(80) });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
  }
  await expect(imagePreview.getByRole('button', { name: 'Reset image zoom' })).toHaveText('200%');
  assert.equal(await phone.evaluate(() => window.visualViewport.scale), 1, 'Pinch affects only the image');
  await phone.screenshot({ path: path.join(repo, 'phone-image-viewer.png') });
  const imageDownload = phone.waitForEvent('download');
  await imagePreview.getByRole('link', { name: 'Download image' }).click();
  assert.equal((await imageDownload).suggestedFilename(), 'shared-picture.png');
  await imagePreview.getByRole('button', { name: 'Close image', exact: true }).click();
  await phone.getByRole('button', { name: `Open video ${recordingName}` }).first().click();
  const videoPreview = phone.getByRole('dialog', { name: 'Shared video preview' });
  await videoPreview.waitFor();
  const player = videoPreview.locator('video');
  // Safari respects preload="metadata" and does not decode a frame until play.
  await expect.poll(() => player.evaluate(video => video.readyState)).toBeGreaterThanOrEqual(1);
  assert.equal(await player.evaluate(video => video.controls && video.playsInline), true);
  await player.evaluate(video => video.play());
  await expect.poll(() => player.evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => player.evaluate(video => video.currentTime)).toBeGreaterThan(0);
  await player.evaluate(video => { video.pause(); video.currentTime = 0.2; });
  await expect.poll(() => player.evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(0.19);
  await videoPreview.getByRole('button', { name: 'Close video' }).click();
  assert.equal(await phone.locator('.mobile-video-stage').count(), 0);

  await expect(imagePreview).not.toBeVisible();
  const readButton = phone.locator('.mobile-message.assistant').getByRole('button', { name: 'Read aloud', exact: true }).first();
  assert.equal(await phone.evaluate(() => window.testSpeech.spoken.length), 0, 'No automatic playback');
  await expect(phone.getByRole('button', { name: 'Read aloud', exact: true })).toHaveCount(1);
  assert.equal(await readButton.innerText(), '', 'Read aloud is an icon without visible text');
  await expect(readButton.locator('svg')).toHaveCount(1);
  await expect(phone.locator('.mobile-message').last().getByRole('button', { name: 'Read aloud', exact: true })).toBeVisible();
  await readButton.click();
  await phone.waitForFunction(() => window.testSpeech.spoken.length > 0);
  assert.ok((await phone.evaluate(() => window.testSpeech.spoken[0].text)).startsWith('Can we make'));
  const spokenRange = await phone.evaluate(async () => {
    for (let index = 0; index < 500 && !window.testSpeech.closed; index++) { if (window.testSpeech.current) { const current = window.testSpeech.current; window.testSpeech.current = null; current.onend?.(); } await new Promise(resolve => setTimeout(resolve, 10)); }
    return window.testSpeech.spoken.map(part => part.text).join(' ');
  });
  assert.ok(spokenRange.includes('Intermediate agent progress is included.'));
  assert.ok(spokenRange.includes('Ready for review'));
  assert.ok(!spokenRange.includes('Older request'));
  assert.ok(!spokenRange.includes('Older answer'));
  await readButton.click();
  await phone.getByRole('button', { name: 'Pause reading' }).click();
  assert.equal(await phone.evaluate(() => window.testSpeech.paused), true);
  await phone.getByRole('button', { name: 'Resume reading' }).click();
  assert.equal(await phone.evaluate(() => window.testSpeech.paused), false);
  assert.equal(await phone.locator('.mobile-messages select').count(), 0, 'Voice selection stays in settings');
  await phone.getByRole('button', { name: 'Phone settings' }).click();
  const readingVoice = phone.getByRole('combobox', { name: 'English reading voice' });
  await expect(readingVoice.locator('option')).toHaveCount(2);
  assert.deepEqual(await readingVoice.locator('option').evaluateAll(options => options.map(option => option.value)), ['am_michael', 'bf_emma']);
  await readingVoice.selectOption('bf_emma');
  assert.equal(await phone.evaluate(() => localStorage.getItem('mrmak.mobile.read-aloud.voice')), 'bf_emma');
  await phone.getByRole('button', { name: 'Phone settings' }).click();
  await readButton.click();
  await phone.waitForFunction(() => window.testSpeech.spoken.at(-1)?.voice === 'bf_emma');
  await phone.getByRole('button', { name: 'Stop reading' }).click();
  assert.equal(await phone.evaluate(() => window.testSpeech.current), null);
  await readButton.click();
  await modeButtons.getByRole('button', { name: 'Terminal', exact: true }).click();
  assert.equal(await phone.evaluate(() => window.testSpeech.current), null, 'Opening terminal stops speech');
  await modeButtons.getByRole('button', { name: 'Conversation', exact: true }).click();
  const draftBeforeWake = 'Keep my draft while the phone sleeps.';
  await phone.getByRole('textbox', { name: 'Message' }).fill(draftBeforeWake);
  const beforeWake = await phone.evaluate(() => ({ sockets: window.testConnections.length, identity: window.testDocumentIdentity, scroll: document.querySelector('.mobile-messages').scrollTop }));
  // Intercept the caller rather than the service worker's network request:
  // WebKit's Playwright routing cannot hold a service-worker fetch.
  await phone.evaluate(() => {
    const original = window.fetch; let hold = true;
    window.testReleaseBootstrap = null;
    window.testRestoreFetch = () => { window.fetch = original; };
    window.fetch = (...args) => {
      if (hold && String(args[0]).endsWith('/mobile/api/bootstrap')) {
        hold = false;
        return new Promise((_, reject) => { window.testReleaseBootstrap = () => reject(new DOMException('Test lost bootstrap', 'AbortError')); });
      }
      return original(...args);
    };
  });
  await phone.evaluate(() => { window.testDelayClose = true; });
  await phone.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await phone.waitForFunction(() => !!window.testReleaseBootstrap);
  const wakeStarted = Date.now();
  await phone.evaluate(() => {
    window.testDelayClose = true; window.testVisibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
    window.testVisibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow'));
  });
  await phone.waitForFunction(count => window.testConnections.length > count && !document.querySelector('.mobile-offline'), beforeWake.sockets);
  assert.ok(Date.now() - wakeStarted < 2500, 'Wake reconnect starts immediately, without the retry delay');
  assert.equal(await phone.evaluate(() => window.testDocumentIdentity), beforeWake.identity);
  await expect(phone.getByRole('textbox', { name: 'Message' })).toHaveValue(draftBeforeWake);
  assert.equal(await phone.locator('.mobile-terminal').count(), 0, 'Conversation mode stays selected');
  assert.equal(await phone.evaluate(() => document.querySelector('.mobile-messages').scrollTop), beforeWake.scroll);
  await phone.evaluate(() => { window.testReleaseBootstrap(); window.testRestoreFetch(); });
  await phone.evaluate(() => { window.testDelayClose = false; for (const socket of window.testDelayedSockets) socket.close(); window.testDelayedSockets = []; });
  await phone.getByRole('textbox', { name: 'Message' }).fill('');
  const recentActivity = phone.locator('.mobile-tool-activity');
  await recentActivity.waitFor();
  await expect(recentActivity).not.toHaveAttribute('open', '');
  await expect(phone.getByText('Read test file', { exact: true })).toBeHidden();
  await recentActivity.locator('summary').click();
  await expect(phone.getByText('Read test file', { exact: true })).toBeVisible();
  await phone.waitForTimeout(2400);
  await expect(phone.getByText('Read test file', { exact: true })).toBeVisible();
  await recentActivity.locator('summary').click();
  await expect(phone.getByText('Read test file', { exact: true })).toBeHidden();
  const workingAgents = phone.locator('.background-work');
  await expect(workingAgents.locator('summary')).toContainText('1 agent and 1 command working');
  await expect(phone.getByText('Bash · Run the tests')).toBeHidden();
  await workingAgents.locator('summary').click();
  await expect(phone.getByText('Bash · Run the tests')).toBeVisible();
  await expect(workingAgents).toContainText('general-purpose · running 5 min');
  await expect(workingAgents.locator('li.command')).toContainText('Run the Playwright suite');
  await expect(workingAgents.locator('li.command')).toContainText('PowerShell · started by Bot Coder: task 8');
  await workingAgents.locator('summary').click();
  await phone.locator('.mobile-activity-status.working').waitFor();
  assert.equal(await phone.locator('.mobile-worker-hands').evaluate(node => getComputedStyle(node).animationName), 'mobile-worker-type');
  const modeLayout = await phone.locator('.mobile-chat-tools').evaluate(node => {
    const segment = node.querySelector('.mobile-segment').getBoundingClientRect(), status = node.querySelector('.mobile-activity-status').getBoundingClientRect();
    const buttons = [...node.querySelectorAll('.mobile-segment button')].map(button => button.getBoundingClientRect().width);
    return { gap: status.left - segment.right, widths: buttons };
  });
  assert.ok(Math.abs(modeLayout.gap - 8) < 1); assert.ok(Math.abs(modeLayout.widths[0] - modeLayout.widths[1]) < 1);
  await phone.screenshot({ path: path.join(repo, 'phone-working.png') });
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await phone.locator('.mobile-worker-hands').evaluate(node => getComputedStyle(node).animationName), 'none');
  await phone.emulateMedia({ reducedMotion: 'no-preference' });
  service.sessions.nativeEvent(service.sessions.get(ids[1]), { kind: 'turn-interrupted' });
  await phone.locator('.mobile-activity-status.working').waitFor({ state: 'detached' });
  const readerBeforeScroll = service.mobile.transcripts.read;
  service.mobile.transcripts.read = async () => ({ supported: true, messages: Array.from({ length: 40 }, (_, index) => ({ id: `scroll-${index}`, role: index % 2 ? 'assistant' : 'user', text: `History message ${index + 1}. A longer message to exercise conversation scrolling on the phone.`, at: new Date().toISOString() })) });
  await phone.waitForFunction(() => document.querySelectorAll('.mobile-message').length === 40);
  const nearBottom = () => phone.locator('.mobile-messages').evaluate(box => box.scrollHeight - box.scrollTop - box.clientHeight < 3);
  assert.ok(await nearBottom(), 'New messages follow the end');
  await phone.locator('.mobile-messages').evaluate(box => { box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); });
  await phone.getByRole('button', { name: 'Jump to latest' }).waitFor();
  await phone.waitForTimeout(2400);
  assert.equal(await phone.locator('.mobile-messages').evaluate(box => box.scrollTop), 0, 'Polling does not pull a history reader to the end');
  const stableDraft = phone.getByRole('textbox', { name: 'Message this chat' });
  const selectedBeforeWorkspace = await phone.locator('.mobile-header h1').innerText();
  await stableDraft.fill('A draft retained across mobile views.');
  await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await phone.getByRole('heading', { name: 'Workspace', exact: true }).waitFor();
  await phone.getByRole('button', { name: 'Chats', exact: true }).click();
  await phone.getByRole('heading', { name: selectedBeforeWorkspace, exact: true }).waitFor();
  await expect(stableDraft).toHaveValue('A draft retained across mobile views.');
  await expect.poll(() => phone.locator('.mobile-messages').evaluate(box => box.scrollTop)).toBe(0);
  await reloadPhone();
  await phone.getByRole('heading', { name: selectedBeforeWorkspace, exact: true }).waitFor();
  await expect(stableDraft).toHaveValue('A draft retained across mobile views.');
  await expect.poll(() => phone.locator('.mobile-messages').evaluate(box => box.scrollTop)).toBe(0);
  await stableDraft.fill('');

  await phone.getByRole('button', { name: 'Jump to latest' }).click();
  assert.ok(await nearBottom());
  assert.equal(await phone.getByRole('button', { name: 'Jump to latest' }).count(), 0);
  await phone.locator('.mobile-messages').evaluate(box => { box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); });
  await phone.getByRole('button', { name: 'Terminal', exact: true }).click();
  await phone.getByRole('button', { name: 'Conversation', exact: true }).click();
  assert.equal(await phone.locator('.mobile-messages').evaluate(box => box.scrollTop), 0, 'Returning from Terminal preserves history position');
  await phone.getByRole('button', { name: 'Terminal', exact: true }).click();
  await phone.locator('.mobile-terminal').waitFor();
  await reloadPhone();
  await phone.getByRole('heading', { name: selectedBeforeWorkspace, exact: true }).waitFor();
  await phone.locator('.mobile-terminal').waitFor();
  assert.equal(await phone.locator('.mobile-messages').count(), 0, 'Reload restores Terminal mode');
  await phone.getByRole('button', { name: 'Conversation', exact: true }).click();

  await phone.getByRole('button', { name: 'Jump to latest' }).click();
  assert.ok(await nearBottom());
  service.mobile.transcripts.read = readerBeforeScroll;
  await phone.waitForFunction(() => document.querySelectorAll('.mobile-message').length === 5);

  assert.deepEqual(ids.map(id => ({ cols: service.sessions.get(id).cols, rows: service.sessions.get(id).rows })), dimensions);
  assert.equal((await (await fetch(`${service.origin}/api/bootstrap`, { headers: { Authorization: `Bearer ${service.token}` } })).json()).selectedId, desktopSelected);
  const input = phone.getByRole('textbox', { name: 'Message this chat' });
  await input.fill('Existing draft');
  await phone.evaluate(() => { window.testDenyMic = true; });
  await phone.getByRole('button', { name: 'Dictate a message', exact: true }).click();
  await phone.getByText(/Allow microphone access in your browser/).waitFor();
  assert.equal(await input.inputValue(), 'Existing draft'); assert.equal(voiceCalls.length, 0);
  await phone.getByRole('button', { name: 'Dismiss voice input error' }).click();
  const record = async () => {
    await phone.getByRole('button', { name: 'Dictate a message', exact: true }).click();
    await phone.getByRole('button', { name: 'Stop recording and transcribe' }).waitFor();
    await phone.waitForTimeout(700);
  };
  await record();
  assert.equal(await phone.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  await phone.screenshot({ path: path.join(repo, 'phone-dictation-recording.png') });
  const writesBeforeVoice = writes.length;
  await phone.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await expect(input).toHaveValue('Existing draft\nA dictated follow-up.');
  assert.equal(await input.inputValue(), 'Existing draft\nA dictated follow-up.');
  assert.equal(writes.length, writesBeforeVoice); assert.equal(voiceCalls.length, 1); assert.ok(voiceCalls[0].size > 12);
  assert.equal(await phone.evaluate(() => window.testMicTracks.every(track => track.readyState === 'ended')), true);
  await record(); await phone.getByRole('button', { name: 'Cancel recording' }).click();
  await phone.getByRole('button', { name: 'Dictate a message', exact: true }).waitFor();
  assert.equal(voiceCalls.length, 1); assert.equal(await input.inputValue(), 'Existing draft\nA dictated follow-up.');
  // Lost transcription replies keep audio in IndexedDB. Reload and retry the same ID.
  await loseNextReply(phone, '/mobile/api/transcribe');
  await record(); await phone.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await phone.getByRole('button', { name: 'Transcribe recording', exact: true }).waitFor();
  assert.equal(voiceCalls.length, 2);
  await restoreReplies(phone, '/mobile/api/transcribe');
  await reloadPhone();
  await phone.getByRole('heading', { name: 'Research ideas', exact: true }).waitFor();
  await phone.getByRole('button', { name: 'Transcribe recording', exact: true }).click();
  await expect(input).toHaveValue('Existing draft\nA dictated follow-up.\nA dictated follow-up.');
  assert.equal(voiceCalls.length, 2); assert.equal(writes.length, writesBeforeVoice);
  assert.equal(await input.inputValue(), 'Existing draft\nA dictated follow-up.\nA dictated follow-up.');
  // Leaving the chat releases the microphone and saves unfinished audio in that chat.
  await record(); await phone.getByRole('button', { name: 'Back to chats' }).click();
  await phone.waitForTimeout(200);
  assert.equal(await phone.evaluate(() => window.testMicTracks.every(track => track.readyState === 'ended')), true);
  await phone.getByRole('button', { name: /Game animations/ }).click();
  assert.equal(await phone.getByRole('button', { name: 'Transcribe recording', exact: true }).count(), 0);
  await phone.getByRole('button', { name: 'Back to chats' }).click(); await phone.getByRole('button', { name: /Research ideas/ }).click();
  await phone.getByRole('button', { name: 'Transcribe recording', exact: true }).waitFor();
  await phone.screenshot({ path: path.join(repo, 'phone-dictation-recovery.png') });
  await phone.getByRole('button', { name: 'Discard recording', exact: true }).click();
  assert.equal(voiceCalls.length, 2);
  await input.fill('A thought from my phone'); await input.press('Shift+Enter'); await input.pressSequentially('Please keep the same chat.');
  assert.equal(await input.inputValue(), 'A thought from my phone\nPlease keep the same chat.');
  // The server receives the request, but its first reply is lost on the network.
  const sendRoute = `/mobile/api/sessions/${ids[1]}/send`;
  await loseNextReply(phone, sendRoute);
  const before = writes.length;
  await phone.getByRole('button', { name: 'Send', exact: true }).click();
  await phone.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await restoreReplies(phone, sendRoute);
  await phone.getByRole('button', { name: 'Retry', exact: true }).click();
  await phone.getByText('Delivered to terminal', { exact: true }).waitFor();
  assert.equal(writes.length - before, 2); assert.ok(writes[before].data.includes('A thought from my phone\nPlease keep the same chat.'));
  assert.equal(await input.inputValue(), '');
  await input.fill('Keep this draft while I switch chats.');
  await phone.getByRole('button', { name: 'Back to chats' }).click(); await phone.getByRole('button', { name: /Game animations/ }).click();
  assert.equal(await phone.getByRole('textbox', { name: 'Message this chat' }).inputValue(), '');
  await phone.getByRole('button', { name: 'Back to chats' }).click(); await phone.getByRole('button', { name: /Research ideas/ }).click();
  assert.equal(await phone.getByRole('textbox', { name: 'Message this chat' }).inputValue(), 'Keep this draft while I switch chats.');
  await phone.screenshot({ path: path.join(repo, 'phone-conversation.png') });
  await mobileContext.setOffline(true); await phone.getByText('Offline · draft saved', { exact: true }).waitFor();
  await mobileContext.setOffline(false); await phone.getByRole('status', { name: 'Connected to your computer', exact: true }).waitFor();
  assert.equal(await input.inputValue(), 'Keep this draft while I switch chats.');
  await phone.getByRole('button', { name: 'Terminal', exact: true }).click(); await phone.locator('.mobile-terminal-reader pre').waitFor();
  // Simulate a silent application socket while the transport still looks open.
  await phone.bringToFront();
  const silentClients = [...service.mobile.clients];
  assert.equal(await phone.evaluate(() => document.visibilityState), 'visible');
  for (const ws of silentClients) {
    ws.send = () => {};
    const handlers = ws.listeners('message'); ws.removeAllListeners('message');
    ws.on('message', (...args) => {
      try { if (JSON.parse(String(args[0])).type === 'ping') return; } catch { /* Let the normal handler validate. */ }
      for (const handler of handlers) handler.apply(ws, args);
    });
  }
  const writesBeforeRecovery = writes.length;
  await new Promise(resolve => setTimeout(resolve, 500));
  await phone.evaluate(() => document.visibilityState);
  await new Promise(resolve => setTimeout(resolve, 52000));
  await phone.getByRole('status', { name: 'Connected to your computer', exact: true }).waitFor();
  assert.ok([...service.mobile.clients].some(ws => !silentClients.includes(ws)), 'Watchdog creates a fresh connection');
  assert.equal(writes.length, writesBeforeRecovery, 'Recovery never resends terminal input');
  assert.equal(await input.inputValue(), 'Keep this draft while I switch chats.');

  const beforeKeys = writes.length;
  const arrowKeys = [['Arrow left', '\x1b[D'], ['Arrow up', '\x1b[A'], ['Arrow down', '\x1b[B'], ['Arrow right', '\x1b[C']];
  for (const [index, [name]] of arrowKeys.entries()) {
    // A tap only dispatches input; delivery happens asynchronously over HTTP.
    // Wait for each reply and verify the exact terminal writes, even on a slow runner.
    const [response] = await Promise.all([
      phone.waitForResponse(response => response.url().endsWith(`/mobile/api/sessions/${ids[1]}/key`) && response.request().method() === 'POST'),
      phone.getByRole('button', { name, exact: true }).tap(),
    ]);
    assert.equal(response.status(), 200, `${name} is accepted`);
    assert.deepEqual(await response.json(), { delivered: true });
    assert.deepEqual(writes.slice(beforeKeys), arrowKeys.slice(0, index + 1).map(([, data]) => ({ id: ids[1], data })), `${name} is delivered once, in order`);
  }
  for (const width of [320, 390]) {
    await phone.setViewportSize({ width, height: 844 });
    await expect.poll(() => phone.locator('.mobile-terminal-reader').evaluate(node => node.scrollWidth - node.clientWidth), { message: `Wrapped terminal needs no horizontal scrolling at ${width}px` }).toBeLessThanOrEqual(1);
    const keyLayout = await phone.locator('.mobile-terminal-keys').evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth, keys: [...node.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height }; }) }));
    assert.ok(keyLayout.scroll <= keyLayout.client + 1);
    assert.equal(new Set(keyLayout.keys.map(r => r.top)).size, 1, 'Terminal controls occupy one row');
    const wrapped = await phone.locator('.mobile-terminal-reader').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, text: node.textContent }));
    assert.ok(wrapped.text.trim(), 'Wrapped terminal shows the terminal text');
    assert.match(wrapped.text, /│ A long reply line that the desktop terminal draws at its full width and the phone wraps\.$/, 'Box padding and its right border are removed');
    assert.ok(!wrapped.text.includes('─'.repeat(7)), 'Long rules are shortened');
    assert.ok(wrapped.scroll <= wrapped.width + 1, `Wrapped terminal needs no horizontal scrolling at ${width}px`);
    assert.ok(keyLayout.keys.every(r => r.left >= 0 && r.right <= width && r.width >= 30 && r.height >= 44));
  }
  await phone.screenshot({ path: path.join(repo, 'phone-terminal.png') });
  await phone.getByRole('button', { name: 'Fit terminal to screen' }).click(); await phone.locator('.mobile-terminal .xterm-screen').waitFor();
  const fitted = await phone.locator('.mobile-terminal-viewport').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(fitted.scroll <= fitted.width + 1, 'Fitted terminal needs no horizontal scrolling');
  await phone.getByRole('button', { name: 'Show terminal at actual size' }).click();
  assert.equal(await phone.locator('.mobile-terminal-surface').evaluate(node => getComputedStyle(node).transform), 'matrix(1, 0, 0, 1, 0, 0)');
  await phone.getByRole('button', { name: 'Fit terminal to screen' }).click();
  for (const width of [320, 390]) {
    await phone.setViewportSize({ width, height: 844 });
    // Fit is applied by ResizeObserver, after the viewport change resolves.
    await expect.poll(() => phone.locator('.mobile-terminal-viewport').evaluate(node => node.scrollWidth - node.clientWidth), { message: `Fitted terminal needs no horizontal scrolling at ${width}px` }).toBeLessThanOrEqual(1);
  }
  assert.deepEqual(ids.map(id => ({ cols: service.sessions.get(id).cols, rows: service.sessions.get(id).rows })), dimensions);
  await phone.getByRole('button', { name: 'Conversation', exact: true }).click();
  await phone.locator('input[type=file]').setInputFiles({ name: 'phone.png', mimeType: 'image/png', buffer: png });
  await phone.getByText('Images ready to send', { exact: true }).waitFor();
  const imageBefore = writes.length; await phone.getByRole('button', { name: 'Send', exact: true }).click(); await phone.getByText('Delivered to terminal', { exact: true }).waitFor();
  assert.ok(writes[imageBefore].data.includes('inbox')); assert.ok(writes[imageBefore].data.includes('phone-'));
  await phone.getByRole('button', { name: 'Back to chats' }).click(); await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await phone.getByRole('button', { name: /A useful report/ }).click();
  const frame = phone.frameLocator('iframe'); await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  // Returning from Chats remounts the header menu above an already composited
  // iframe. Use the phone's touch input and keep its menu on screen at each size.
  for (const width of [320, 390, 768]) {
    await phone.setViewportSize({ width, height: 844 });
    for (let round = 0; round < 4; round++) {
      await phone.getByRole('button', { name: 'Chats', exact: true }).click();
      await phone.getByRole('button', { name: 'Results', exact: true }).click();
      await phone.getByLabel('Select report page', { exact: true }).tap();
      const menuBox = await phone.locator('.mobile-page-menu').boundingBox();
      assert.ok(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= width, `Report menu stays in bounds at ${width}px`);
      await phone.getByRole('button', { name: 'Plan', exact: true }).tap();
      await phone.getByRole('heading', { name: 'Mobile plan' }).waitFor();
      await phone.getByLabel('Select report page', { exact: true }).tap();
      await phone.getByRole('button', { name: 'Report', exact: true }).tap();
      await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
    }
  }
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.getByLabel('Select report page', { exact: true }).tap();
  await phone.screenshot({ path: path.join(repo, 'phone-report-menu.png') });
  await phone.getByLabel('Select report page', { exact: true }).tap();
  await frame.getByAltText('Report image', { exact: true }).click();
  await frame.getByRole('dialog', { name: 'Image preview' }).waitFor();
  const downloadEvent = phone.waitForEvent('download'); await frame.getByRole('link', { name: 'Download', exact: true }).click();
  const download = await downloadEvent; assert.ok(download.suggestedFilename().includes('nose'));
  await frame.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await frame.locator('dialog[open]').count(), 0);
  await phone.screenshot({ path: path.join(repo, 'phone-report.png') });
  assert.equal(await phone.locator('.mobile-report-heading, .mobile-report-tabs').count(), 0);
  assert.equal(await phone.locator('.mobile-header h1').innerText(), 'A useful report');
  await expect.poll(() => frame.locator('#delayed-content').evaluate(node => node.offsetHeight)).toBe(2200);
  const htmlIdentity = await frame.locator('body').evaluate(() => { window.testReportIdentity = Math.random(); location.hash = '#chapter-two'; window.scrollTo(0,500); document.getElementById('nested-scroll').scrollTop = 180; return window.testReportIdentity; });
  const reportKey = 'mrmak.mobile.report.mobile-report.0';
  await expect.poll(() => phone.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').top, reportKey)).toBe(500);
  await phone.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(stableDraft).toBeVisible();
  await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  assert.equal(await frame.locator('body').evaluate(() => window.testReportIdentity), htmlIdentity, 'Section switching keeps the same report document');
  assert.equal(await frame.locator('body').evaluate(() => window.scrollY), 500);
  assert.equal(await frame.locator('#nested-scroll').evaluate(node => node.scrollTop), 180);
  const beforeForged = await phone.evaluate(key => localStorage.getItem(key), reportKey);
  await phone.evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'null', data: { type: 'mrmak:report-state', state: { path: 'malicious', top: 999, left: 0 } } })));
  assert.equal(await phone.evaluate(key => localStorage.getItem(key), reportKey), beforeForged, 'Messages from another window cannot change report position');
  await reloadPhone();
  await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  await expect.poll(() => frame.locator('body').evaluate(() => window.scrollY)).toBe(500);
  assert.equal(await frame.locator('body').evaluate(() => location.hash), '#chapter-two');
  assert.equal(await frame.locator('#nested-scroll').evaluate(node => node.scrollTop), 180);

  // Attach navigation only, freeze it for retries, and keep the transcript readable.
  // Capture this transition's event order on slower CI browsers without adding
  // waits or changing the interaction under test. Only synthetic fixture data.
  await phone.evaluate(() => {
    window.testMenuTrace = [];
    const record = value => { window.testMenuTrace.push({ at: Math.round(performance.now()), ...value }); if (window.testMenuTrace.length > 50) window.testMenuTrace.shift(); };
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'mrmak.mobile.workspace') record({ type: 'selection', value }); return original.call(this, key, value); };
    for (const type of ['pointerdown', 'pointerup', 'click', 'toggle']) document.addEventListener(type, event => {
      const target = event.target, menu = document.querySelector('.mobile-page-picker');
      record({ type, pointer: event.pointerType, target: target.tagName, label: target.closest('button,summary')?.getAttribute('aria-label') || target.textContent?.slice(0, 40), menuContains: menu?.contains(target), menuOpen: menu?.open });
    }, true);
  });
  const contextRoute = `/mobile/api/sessions/${ids[1]}/send`, contextPayloads = [];
  const originalSubmit = service.mobile.submit;
  service.mobile.submit = function (device, id, data) { if (id === ids[1]) contextPayloads.push(structuredClone(data)); return originalSubmit.call(this, device, id, data); };
  await loseNextReply(phone, contextRoute);
  await phone.getByRole('button', { name: 'Chats', exact: true }).click();
  await input.fill('Adjust this section when I ask.');
  const contextBefore = writes.length;
  await phone.getByRole('button', { name: 'Send', exact: true }).click();
  await phone.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  const deliveredContext = contextPayloads[0].text;
  const contextMetadata = text => JSON.parse(/\n(\{[^\n]+\})\n<\/mrmak_workspace_context>$/.exec(text)[1]);
  assert.deepEqual(contextMetadata(deliveredContext).workspace, { id: 'mobile-report', tabIndex: 0, title: 'A useful report', tab: 'Report', currentViewerPage: 'workspace/report/index.html', sectionAnchor: '#chapter-two' });
  assert.match(deliveredContext, /Do not read, open, or investigate this Workspace merely because this note is attached/);
  assert.ok(!deliveredContext.includes('/mobile/view/') && !deliveredContext.includes('Report ready'), 'No grant URL or report content is copied');
  await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await phone.getByLabel('Select report page', { exact: true }).tap();
  await phone.getByRole('button', { name: 'Plan', exact: true }).tap(); await phone.getByRole('heading', { name: 'Mobile plan' }).waitFor();
  await phone.getByRole('button', { name: 'Chats', exact: true }).click(); await reloadPhone();
  await phone.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await restoreReplies(phone, contextRoute);
  await phone.getByRole('button', { name: 'Retry', exact: true }).click(); await phone.getByText('Delivered to terminal', { exact: true }).waitFor();
  assert.equal(writes.length - contextBefore, 2, 'Changed Workspace and reload do not duplicate delivery');
  assert.deepEqual(contextPayloads[1], contextPayloads[0], 'A retry retains the exact original context');
  await input.fill('Now use the Plan tab.');
  const planBefore = writes.length; await phone.getByRole('button', { name: 'Send', exact: true }).click(); await phone.getByText('Delivered to terminal', { exact: true }).waitFor();
  assert.equal(contextMetadata(contextPayloads.at(-1).text).workspace.tab, 'Plan');
  assert.equal(contextMetadata(contextPayloads.at(-1).text).workspace.reportEntryPage, 'workspace/report/plan.md');
  assert.equal(contextMetadata(contextPayloads.at(-1).text).workspace.sectionAnchor, undefined, 'Another tab never inherits an old section');
  assert.equal(writes.length - planBefore, 2);
  service.mobile.submit = originalSubmit;
  const contextReader = service.mobile.transcripts.read;
  service.mobile.transcripts.read = async () => ({ supported: true, messages: [{ id: 'context-user', role: 'user', text: deliveredContext, at: new Date().toISOString() }, { id: 'context-assistant', role: 'assistant', text: 'Ready when you ask.', at: new Date().toISOString() }] });
  await expect(phone.locator('.mobile-message.user .mobile-message-copy')).toHaveCount(1);
  await expect(phone.locator('.mobile-message.user .mobile-message-copy')).toHaveText('Adjust this section when I ask.');
  await phone.getByRole('button', { name: 'Read aloud', exact: true }).click();
  await phone.waitForFunction(() => window.testSpeech.spoken.at(-1)?.text.includes('Ready when you ask.'));
  assert.ok(!await phone.evaluate(() => window.testSpeech.spoken.at(-1).text.includes('Workspace')));
  await phone.getByRole('button', { name: 'Stop reading', exact: true }).click();
  service.mobile.transcripts.read = contextReader;
  await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await phone.getByRole('heading', { name: 'Mobile plan' }).waitFor();
  await phone.getByLabel('Select report page', { exact: true }).tap();
  await phone.getByRole('button', { name: 'Report', exact: true }).tap();
  await frame.getByRole('heading', { name: 'Report ready' }).waitFor();

  // Pull to refresh reloads the report only from the top, and keeps its page.
  const pullDown = (locator, distance) => locator.evaluate((node, distance) => {
    // Desktop WebKit exposes Touch but does not allow constructing it. The
    // handlers consume touch coordinates, so use the same event data in both engines.
    const dispatch = (type, y) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: y == null ? [] : [{ identifier: 1, target: node, clientX: 120, clientY: y }] });
      node.dispatchEvent(event);
    };
    dispatch('touchstart', 100);
    for (let y = 110; y <= 100 + distance; y += 10) dispatch('touchmove', y);
    dispatch('touchend');
  }, distance);
  const reportIdentity = () => frame.locator('body').evaluate(() => window.testReportIdentity).catch(() => 'loading');
  await expect.poll(() => frame.locator('body').evaluate(() => window.scrollY)).toBe(500);
  const beforePull = await frame.locator('body').evaluate(() => (window.testReportIdentity = Math.random()));
  await pullDown(frame.locator('body'), 200);
  await frame.locator('body').evaluate(() => window.scrollTo(0, 0));
  await pullDown(frame.locator('body'), 40);
  await phone.waitForTimeout(300);
  assert.equal(await reportIdentity(), beforePull, 'A pull below the top or a short pull keeps the report');
  await pullDown(frame.locator('body'), 200);
  await expect.poll(reportIdentity).toBeUndefined();
  await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  assert.equal(await frame.locator('body').evaluate(() => location.hash), '#chapter-two');
  await expect(phone.locator('.mobile-pull-refresh')).toHaveCount(0);

  await phone.getByLabel('Select report page', { exact: true }).tap();
  await phone.getByRole('button', { name: 'Plan', exact: true }).tap(); await phone.getByRole('heading', { name: 'Mobile plan' }).waitFor();
  await phone.locator('.mobile-report-markdown').evaluate(node => { node.scrollTop = 350; node.dispatchEvent(new Event('scroll')); });
  await phone.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(stableDraft).toBeVisible();
  await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await phone.getByRole('heading', { name: 'Mobile plan' }).waitFor();
  assert.equal(await phone.locator('.mobile-report-markdown').evaluate(node => node.scrollTop), 350);
  await reloadPhone();
  await phone.getByRole('heading', { name: 'Mobile plan' }).waitFor();
  await expect.poll(() => phone.locator('.mobile-report-markdown').evaluate(node => node.scrollTop)).toBe(350);

  for (const width of [360, 390, 768]) {
    await phone.setViewportSize({ width, height: 844 });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No page overflow at ${width}px`);
  }
  await phone.getByLabel('Select report page', { exact: true }).tap();
  await phone.getByRole('button', { name: 'Close report', exact: true }).tap();
  await phone.getByRole('button', { name: /A useful report/ }).click();
  await phone.getByRole('heading', { name: 'Mobile plan' }).waitFor();
  await phone.getByLabel('Select report page', { exact: true }).tap();
  await phone.getByRole('button', { name: 'Report', exact: true }).tap();
  await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  await phone.getByLabel('Select report page', { exact: true }).tap();
  await phone.getByRole('button', { name: 'Close report', exact: true }).tap();
  await phone.getByRole('heading', { name: 'Workspace', exact: true }).waitFor();
  const listRefresh = phone.waitForRequest(request => request.url().endsWith('/mobile/api/reports'));
  await pullDown(phone.locator('.mobile-results-list'), 200);
  await listRefresh;
  await expect(phone.locator('.mobile-pull-refresh')).toHaveCount(0);
  // Back steps up one screen at a time: report, Workspace list, then the chat list.
  await phone.getByRole('button', { name: /A useful report/ }).click(); await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  await phone.keyboard.press('Escape'); await phone.getByRole('heading', { name: 'Workspace', exact: true }).waitFor();
  // A back request that reaches the focused report frame steps back the same way.
  await phone.getByRole('button', { name: /A useful report/ }).click(); await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  await frame.locator('body').press('Escape'); await phone.getByRole('heading', { name: 'Workspace', exact: true }).waitFor();
  await phone.waitForTimeout(300); assert.equal(await phone.getByRole('heading', { name: 'Workspace', exact: true }).isVisible(), true, 'One back request steps back once');
  await phone.keyboard.press('Escape'); await phone.getByRole('heading', { name: 'Chats', exact: true }).waitFor();
  await phone.getByRole('button', { name: 'Chats', exact: true }).click(); await input.waitFor();
  await phone.keyboard.press('Escape'); await phone.getByRole('heading', { name: 'Chats', exact: true }).waitFor();
  assert.equal(await phone.getByRole('button', { name: 'Back to chats' }).count(), 0);
  await phone.getByRole('button', { name: 'Chats', exact: true }).click();
  await input.fill('There is no selected Workspace now.');
  const clearedBefore = writes.length;
  await phone.getByRole('button', { name: 'Send', exact: true }).click(); await phone.getByText('Delivered to terminal', { exact: true }).waitFor();
  assert.equal(contextMetadata(writes[clearedBefore].data.replace(/\x1b\[20[01]~/g, '')).workspace, null, 'Closing a report clears the current context');
  const slashBefore = writes.length; await input.fill('/status');
  await phone.getByRole('button', { name: 'Send', exact: true }).click(); await phone.getByText('Delivered to terminal', { exact: true }).waitFor();
  assert.equal(writes[slashBefore].data, '\x1b[200~/status\x1b[201~', 'Native slash commands are unchanged');
  // A pending draft from before this update must retry its original plain text.
  const legacyRequest = { requestId: randomUUID(), text: 'An older pending draft.', images: [] };
  const legacyBefore = writes.length;
  await phone.evaluate(async ({ id, data }) => {
    const response = await fetch(`/mobile/api/sessions/${id}/send`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!response.ok) throw new Error('Legacy fixture delivery failed');
    localStorage.setItem(`mrmak.mobile.draft.${id}`, JSON.stringify(data));
  }, { id: ids[1], data: legacyRequest });
  await reloadPhone(); await phone.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await phone.getByRole('button', { name: 'Retry', exact: true }).click(); await phone.getByText('Delivered to terminal', { exact: true }).waitFor();
  assert.equal(writes.length - legacyBefore, 2, 'Pre-update pending drafts remain compatible with delivery receipts');
  assert.equal(writes[legacyBefore].data, '\x1b[200~An older pending draft.\x1b[201~');
  // Close the selected desktop chat from the phone, then resume it from History.
  // Only the launch is stubbed; closing/persistence/selection use the real service.
  await phone.getByRole('button', { name: 'Chats', exact: true }).click();
  await phone.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await phone.getByRole('button', { name: /Game animations/ }).click();
  await desktop.getByRole('button', { name: 'Close mobile access', exact: true }).click();
  await desktop.locator(`[data-chat-tab="${ids[0]}"] [role="tab"]`).click();
  await input.fill('Keep this draft after closing.');
  phone.once('dialog', dialog => dialog.dismiss());
  await phone.getByRole('button', { name: 'Close chat', exact: true }).click();
  assert.equal(service.sessions.get(ids[0]).open, true);
  phone.once('dialog', dialog => { assert.match(dialog.message(), /History/); void dialog.accept(); });
  await phone.getByRole('button', { name: 'Close chat', exact: true }).click();
  await phone.getByRole('heading', { name: 'Chats', exact: true }).waitFor();
  assert.equal(await phone.getByRole('button', { name: /Game animations/ }).count(), 0);
  await desktop.locator(`[data-chat-tab="${ids[0]}"]`).waitFor({ state: 'detached' });
  const afterClose = await (await fetch(`${service.origin}/api/bootstrap`, { headers: { Authorization: `Bearer ${service.token}` } })).json();
  assert.equal(afterClose.selectedId, ids[1]);
  assert.equal(service.sessions.get(ids[0]).open, false); assert.equal(service.sessions.get(ids[0]).process, null);
  await phone.getByRole('button', { name: 'History', exact: true }).click();
  await phone.getByRole('button', { name: /Game animations/ }).click();
  assert.equal(await input.inputValue(), 'Keep this draft after closing.');
  assert.equal(await phone.getByRole('button', { name: 'Close chat', exact: true }).count(), 0);
  const originalLaunch = service.sessions.launch;
  service.sessions.launch = async session => { assert.equal(session.id, ids[0]); session.process = { write: data => writes.push({ id: session.id, data }), resize() {} }; session.status = 'running'; service.sessions.changed(session); };
  await phone.getByRole('button', { name: 'Resume chat', exact: true }).click();
  await phone.getByRole('button', { name: 'Resume chat', exact: true }).waitFor({ state: 'detached' });
  service.sessions.launch = originalLaunch;
  assert.equal(service.sessions.get(ids[0]).open, true);
  await desktop.locator(`[data-chat-tab="${ids[0]}"]`).waitFor();
  await desktop.getByRole('button', { name: 'Mobile access', exact: true }).click();
  await desktop.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await phone.getByRole('heading', { name: 'Start in Mr. Mak Chats' }).waitFor();
  assert.equal(service.sessions.get(ids[0]).status, 'running'); assert.equal(service.sessions.get(ids[1]).status, 'running');
  if (navigationCancellations.length) console.log(`Expected WebKit read cancellations during reload: ${navigationCancellations.length}`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, fixture: repo, checks: ['Workspace context follows card/tab/page and section', 'navigation-only references; no report content or grant URLs', 'context frozen across lost reply, page change and reload', 'automatic context excluded from display and read aloud', 'cleared selection, slash commands and pre-update pending drafts', 'QR + desktop approval', 'independent views and PTY sizes', 'microphone permission / record / stop / cancel', 'dictation never auto-sends', 'saved recording recovery after reload and chat switch', 'lost transcription reply reuses provider result', 'lost reply / retry once', 'drafts per chat', 'offline recovery', 'image attachment', 'sandboxed report + image download', 'Markdown preview', 'long-link chat cards at 320/360/393/430/768px', '360/390/768px report layout', 'four terminal arrows and touch targets', 'close confirmation / desktop tab sync / History resume / draft retention', 'device revocation'] }));
} catch (error) {
  if (diagnosticPhone) {
    const state = await diagnosticPhone.evaluate(() => ({
      navigation: localStorage.getItem('mrmak.mobile.navigation'), workspace: localStorage.getItem('mrmak.mobile.workspace'),
      report: document.querySelector('.mobile-results')?.textContent?.slice(0, 800),
      headings: [...document.querySelectorAll('h1,h2')].map(node => node.textContent),
    })).catch(() => null);
    console.error(JSON.stringify({ mobileFailure: state, reportResponses, menuTrace: await diagnosticPhone.evaluate(() => window.testMenuTrace).catch(() => null) }));
    await diagnosticPhone.screenshot({ path: path.join(repo, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close(); for (const session of service.sessions.items.values()) session.process = null;
  if (qrSource) { qrSource.closeAllConnections(); await new Promise(resolve => qrSource.close(resolve)); }
  await service.close();
}
