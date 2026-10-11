// Two independent browser clients, a local test transport and stub CLI processes.
// No personal conversations, paid requests or Tailscale configuration are touched.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cp, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createService } from '../server.mjs';
import { MobileDictation } from '../mobile-dictation.mjs';

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
await writeFile(path.join(repo, 'workspace/report/index.html'), '<!doctype html><html lang="en" data-mak-report="document"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../_shared/report.css"><script defer src="../_shared/report.js"></script></head><body><main class="container"><h1>Report ready</h1><p>A readable result on your phone.</p><img src="nose.svg" alt="Report image" width="160"><p><a target="_blank" rel="noreferrer" href="https://example.com/source">Source link</a></p></main></body></html>');
await writeFile(path.join(repo, 'workspace/report/plan.md'), '# Mobile plan\n\n**Keep the useful parts in view.**\n\n- Read results\n- Send a follow-up\n');
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'mobile-report', title: 'A useful report', folder: 'report', category: 'dev', created: '2026-10-06', steps: [{ name: 'Report', path: 'index.html' }, { name: 'Plan', path: 'plan.md' }] }] }));
const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
const voiceCalls = [];
const dictation = new MobileDictation(repo, { env: { OPENROUTER_API_KEY: 'test-voice-key', MRMAK_TRANSCRIBE_PROVIDER: 'openrouter' }, fetcher: async (url, options) => {
  voiceCalls.push({ url, size: options.body.get('file').size });
  return Response.json({ text: 'A dictated follow-up.' });
} });
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport, dictation }, mcpOptions: { home: repo, env: {} } });
service.sessions.beginDiscovery = () => {};
const writes = [], ids = [randomUUID(), randomUUID()];
for (const [index, id] of ids.entries()) {
  const session = service.sessions.make({ id, name: index ? 'Research ideas' : 'Game animations', agent: index ? 'claude' : 'codex', status: 'running', open: true, pinned: !index, cols: 100, rows: 28, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cwd: repo });
  const exits = new Set();
  session.process = { write: data => writes.push({ id, data }), resize: () => {}, onExit: callback => { exits.add(callback); return { dispose: () => exits.delete(callback) }; }, kill: () => { session.process = null; session.status = 'closed'; service.sessions.changed(session); for (const callback of [...exits]) callback({ exitCode: 0 }); } };
  service.sessions.items.set(id, session); await service.sessions.hydrate(session);
  session.preview = 'Latest notes: [Review the animation](C:/Projects/game/characters/' + 'very-long-character-name-'.repeat(12) + '/review.html) and https://example.com/research/' + 'reference'.repeat(40);
  await new Promise(resolve => session.terminal.write(Array.from({ length: 90 }, (_, line) => `Line ${line + 1}: live agent output\r\n`).join(''), resolve));
}
service.mobile.transcripts.read = async session => ({ supported: true, activity: [{ id: 'tool-one', name: 'Read test file', status: 'completed', at: new Date().toISOString() }], messages: [
  { id: 'old-user', role: 'user', text: 'Older request excluded from speech.', at: '' },
  { id: 'old-agent', role: 'assistant', text: 'Older answer excluded from speech.', at: '' },
  { id: 'user', role: 'user', text: 'Can we make the next iteration easier to review?', at: new Date().toISOString() },
  { id: 'progress', role: 'assistant', text: 'Intermediate agent progress is included.', at: '' },
  { id: 'assistant', role: 'assistant', imageRefs: [path.join(repo, 'shared-picture.png')], text: '## Ready for review\n\nThe latest results are in your Workspace.\n\n- **Character:** proportions updated\n- **Motion:** timing checked\n- **Next step:** choose the version you prefer\n\n[Open the source](https://example.com/source)\n\n' + (session.id === ids[0] ? 'Your agent is still working on the computer.' : 'Send a follow-up whenever an idea comes to mind.'), at: new Date().toISOString() },
] });
let browser, qrSource;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
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
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.testMicTracks = [];
    navigator.mediaDevices.getUserMedia = async options => {
      if (window.testDenyMic) { window.testDenyMic = false; throw new DOMException('Permission denied', 'NotAllowedError'); }
      const stream = await original(options); window.testMicTracks.push(...stream.getTracks()); return stream;
    };
  });
  await mobileContext.addInitScript(() => {
    const service = new EventTarget();
    window.testSpeech = { spoken: [], cancelled: 0, paused: false, current: null };
    Object.assign(service, {
      getVoices: () => [{ voiceURI: 'local-en', name: 'Test English', lang: 'en-US', localService: true, default: true }, { voiceURI: 'local-tr', name: 'Test Turkish', lang: 'tr-TR', localService: true, default: false }],
      speak: utterance => { window.testSpeech.spoken.push({ text: utterance.text, voice: utterance.voice?.voiceURI }); window.testSpeech.current = utterance; },
      cancel: () => { window.testSpeech.cancelled++; window.testSpeech.current = null; },
      pause: () => { window.testSpeech.paused = true; }, resume: () => { window.testSpeech.paused = false; },
    });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: service });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
  });
  const phone = await mobileContext.newPage(); phone.setDefaultTimeout(12000); phone.on('pageerror', error => errors.push(error.message));
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
  assert.deepEqual(await phone.locator('.mobile-header button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['Refresh page', 'New chat', 'History', 'Chats', 'Results', 'Phone settings']);
  await phone.getByRole('button', { name: 'History', exact: true }).click();
  await phone.getByRole('heading', { name: 'History', exact: true }).waitFor();
  assert.deepEqual(await phone.locator('.mobile-main-nav button.active').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['History']);
  assert.equal(await phone.locator('.mobile-header-count').count(), 1);
  assert.equal(await phone.locator('.mobile-list-count').count(), 0);
  await phone.getByRole('button', { name: 'History', exact: true }).click();
  await phone.getByRole('heading', { name: 'Chats', exact: true }).waitFor();
  assert.deepEqual(await phone.locator('.mobile-main-nav button.active').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['Chats']);
  assert.equal(await phone.locator('.mobile-connection-logo').evaluate(dot => getComputedStyle(dot).animationDuration), '3.6s');
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await phone.locator('.mobile-connection-logo').evaluate(dot => getComputedStyle(dot).animationName), 'none');
  await phone.emulateMedia({ reducedMotion: 'no-preference' });
  await Promise.all([phone.waitForEvent('load'), phone.getByRole('button', { name: 'Refresh page', exact: true }).click()]);
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
  const touch = await mobileContext.newCDPSession(phone);
  const stage = await imagePreview.locator('.mobile-image-stage').boundingBox();
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  const points = offset => [{ x: cx - offset, y: cy, id: 1 }, { x: cx + offset, y: cy, id: 2 }];
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(40) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(80) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(imagePreview.getByRole('button', { name: 'Reset image zoom' })).toHaveText('200%');
  assert.equal(await phone.evaluate(() => window.visualViewport.scale), 1, 'Pinch affects only the image');
  await phone.screenshot({ path: path.join(repo, 'phone-image-viewer.png') });
  await touch.detach();
  const imageDownload = phone.waitForEvent('download');
  await imagePreview.getByRole('link', { name: 'Download image' }).click();
  assert.equal((await imageDownload).suggestedFilename(), 'shared-picture.png');
  await imagePreview.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect(imagePreview).not.toBeVisible();
  const readButton = phone.locator('.mobile-message.assistant').getByRole('button', { name: 'Read aloud', exact: true }).first();
  assert.equal(await phone.evaluate(() => window.testSpeech.spoken.length), 0, 'No automatic playback');
  await expect(phone.getByRole('button', { name: 'Read aloud', exact: true })).toHaveCount(1);
  await expect(phone.locator('.mobile-message').last().getByRole('button', { name: 'Read aloud', exact: true })).toBeVisible();
  await readButton.click();
  assert.ok((await phone.evaluate(() => window.testSpeech.spoken[0].text)).startsWith('Can we make'));
  const spokenRange = await phone.evaluate(() => {
    for (let index = 0; index < 100 && window.testSpeech.current; index++) { const current = window.testSpeech.current; window.testSpeech.current = null; current.onend?.(); }
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
  await phone.getByRole('combobox', { name: 'Reading voice' }).selectOption('local-tr');
  await readButton.click();
  assert.equal(await phone.evaluate(() => window.testSpeech.spoken.at(-1).voice), 'local-tr');
  await phone.getByRole('button', { name: 'Stop reading' }).click();
  assert.equal(await phone.evaluate(() => window.testSpeech.current), null);
  await readButton.click();
  await modeButtons.getByRole('button', { name: 'Terminal', exact: true }).click();
  assert.equal(await phone.evaluate(() => window.testSpeech.current), null, 'Opening terminal stops speech');
  await modeButtons.getByRole('button', { name: 'Conversation', exact: true }).click();
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
  await phone.getByRole('button', { name: 'Jump to latest' }).click();
  assert.ok(await nearBottom());
  assert.equal(await phone.getByRole('button', { name: 'Jump to latest' }).count(), 0);
  await phone.locator('.mobile-messages').evaluate(box => { box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); });
  await phone.getByRole('button', { name: 'Terminal', exact: true }).click();
  await phone.getByRole('button', { name: 'Conversation', exact: true }).click();
  assert.ok(await nearBottom(), 'Returning from Terminal opens the end');
  assert.equal(await phone.getByRole('button', { name: 'Jump to latest' }).count(), 0);
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
  await phone.route('**/mobile/api/transcribe', async route => { await route.fetch(); await route.abort('failed'); });
  await record(); await phone.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await phone.getByRole('button', { name: 'Transcribe recording', exact: true }).waitFor();
  assert.equal(voiceCalls.length, 2);
  await phone.unroute('**/mobile/api/transcribe'); await phone.reload();
  await phone.getByRole('button', { name: /Research ideas/ }).click();
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
  const sendRoute = `**/mobile/api/sessions/${ids[1]}/send`;
  await phone.route(sendRoute, async route => { await route.fetch(); await route.abort('failed'); });
  const before = writes.length;
  await phone.getByRole('button', { name: 'Send', exact: true }).click();
  await phone.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await phone.unroute(sendRoute);
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
  await phone.getByRole('button', { name: 'Terminal', exact: true }).click(); await phone.locator('.mobile-terminal .xterm-screen').waitFor();
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
  for (const name of ['Arrow left', 'Arrow up', 'Arrow down', 'Arrow right']) await phone.getByRole('button', { name, exact: true }).click();
  await phone.waitForTimeout(100);
  assert.deepEqual(writes.slice(beforeKeys), ['\x1b[D', '\x1b[A', '\x1b[B', '\x1b[C'].map(data => ({ id: ids[1], data })));
  for (const width of [320, 390]) {
    await phone.setViewportSize({ width, height: 844 });
    const keyLayout = await phone.locator('.mobile-terminal-keys').evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth, keys: [...node.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height }; }) }));
    assert.ok(keyLayout.scroll <= keyLayout.client + 1);
    assert.equal(new Set(keyLayout.keys.map(r => r.top)).size, 1, 'Terminal controls occupy one row');
    const fitted = await phone.locator('.mobile-terminal-viewport').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(fitted.scroll <= fitted.width + 1, `Fitted terminal needs no horizontal scrolling at ${width}px`);
    assert.ok(keyLayout.keys.every(r => r.left >= 0 && r.right <= width && r.width >= 30 && r.height >= 44));
  }
  await phone.screenshot({ path: path.join(repo, 'phone-terminal.png') });
  await phone.getByRole('button', { name: 'Show terminal at actual size' }).click();
  assert.equal(await phone.locator('.mobile-terminal-surface').evaluate(node => getComputedStyle(node).transform), 'matrix(1, 0, 0, 1, 0, 0)');
  await phone.getByRole('button', { name: 'Fit terminal to screen' }).click();
  assert.deepEqual(ids.map(id => ({ cols: service.sessions.get(id).cols, rows: service.sessions.get(id).rows })), dimensions);
  await phone.getByRole('button', { name: 'Conversation', exact: true }).click();
  await phone.locator('input[type=file]').setInputFiles({ name: 'phone.png', mimeType: 'image/png', buffer: png });
  await phone.getByText('Images ready to send', { exact: true }).waitFor();
  const imageBefore = writes.length; await phone.getByRole('button', { name: 'Send', exact: true }).click(); await phone.getByText('Delivered to terminal', { exact: true }).waitFor();
  assert.ok(writes[imageBefore].data.includes('inbox')); assert.ok(writes[imageBefore].data.includes('phone-'));
  await phone.getByRole('button', { name: 'Back to chats' }).click(); await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await phone.getByRole('button', { name: /A useful report/ }).click();
  const frame = phone.frameLocator('iframe'); await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  await frame.getByAltText('Report image', { exact: true }).click();
  await frame.getByRole('dialog', { name: 'Image preview' }).waitFor();
  const downloadEvent = phone.waitForEvent('download'); await frame.getByRole('link', { name: 'Download', exact: true }).click();
  const download = await downloadEvent; assert.ok(download.suggestedFilename().includes('nose'));
  await frame.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await frame.locator('dialog[open]').count(), 0);
  await phone.screenshot({ path: path.join(repo, 'phone-report.png') });
  assert.equal(await phone.locator('.mobile-report-heading, .mobile-report-tabs').count(), 0);
  assert.equal(await phone.locator('.mobile-header h1').innerText(), 'A useful report');
  await phone.getByLabel('Select report page', { exact: true }).click();
  await phone.getByRole('button', { name: 'Plan', exact: true }).click(); await phone.getByRole('heading', { name: 'Mobile plan' }).waitFor();
  for (const width of [360, 390, 768]) {
    await phone.setViewportSize({ width, height: 844 });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `No page overflow at ${width}px`);
  }
  await phone.getByLabel('Select report page', { exact: true }).click();
  await phone.getByRole('button', { name: 'Close report', exact: true }).click();
  await phone.getByRole('button', { name: /A useful report/ }).click();
  await frame.getByRole('heading', { name: 'Report ready' }).waitFor();
  await phone.getByRole('button', { name: 'Results', exact: true }).click();
  assert.equal(await phone.locator('iframe').count(), 0);
  await phone.getByRole('heading', { name: 'Workspace', exact: true }).waitFor();
  // Close the selected desktop chat from the phone, then resume it from History.
  // Only the launch is stubbed; closing/persistence/selection use the real service.
  await phone.getByRole('button', { name: 'Chats', exact: true }).click();
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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, fixture: repo, checks: ['QR + desktop approval', 'independent views and PTY sizes', 'microphone permission / record / stop / cancel', 'dictation never auto-sends', 'saved recording recovery after reload and chat switch', 'lost transcription reply reuses provider result', 'lost reply / retry once', 'drafts per chat', 'offline recovery', 'image attachment', 'sandboxed report + image download', 'Markdown preview', 'long-link chat cards at 320/360/393/430/768px', '360/390/768px report layout', 'four terminal arrows and touch targets', 'close confirmation / desktop tab sync / History resume / draft retention', 'device revocation'] }));
} finally {
  if (qrSource) await new Promise(resolve => qrSource.close(resolve));
  await browser?.close(); for (const session of service.sessions.items.values()) session.process = null;
  await service.close();
}
