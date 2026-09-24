// Real renderer + service snapshots, with a deterministic fullscreen CLI fixture.
// No live chats, agent logins or user settings are changed.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/scroll-ui-'));
await mkdir(path.join(repo, 'workspace'), { recursive: true });
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
const writes = new Map();
const draw = async (session, data, broadcast = false) => {
  await new Promise(resolve => session.terminal.write(data, resolve));
  if (broadcast) { session.pendingOutput += data; service.sessions.flushOutput(session); }
};
let position = 200;
const transcript = () => `\x1b[H\x1b[2JClaude fullscreen transcript at message ${position}\r\nMouse scrolls the conversation.\r\n`;
for (const [id, agent, fullscreen] of [['codex', 'codex', false], ['claude-classic', 'claude', false], ['claude-fullscreen', 'claude', true]]) {
  const session = service.sessions.make({ id, agent, name: id, cwd: repo, status: 'running', open: true, createdAt: new Date().toISOString(), cols: 90, rows: 30 });
  service.sessions.items.set(id, session); await service.sessions.hydrate(session);
  const received = []; writes.set(id, received);
  session.process = { resize() {}, kill() {}, write(data) {
    received.push(data);
    // Claude's fullscreen input consumes SGR mouse reports, not legacy X10 bytes.
    for (const match of data.matchAll(/\x1b\[<(64|65);\d+;\d+M/g)) {
      position += match[1] === '64' ? -3 : 3;
      void draw(session, transcript(), true);
    }
  } };
  await draw(session, fullscreen
    ? '\x1b[?1049h\x1b[?1003;1006h' + transcript()
    : Array.from({ length: 400 }, (_, i) => `History line ${i + 1}\r\n`).join('') + '\x1b[?1000;1006h');
}
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 640, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(service.urls.chats);
  const select = async id => {
    await page.locator(`[data-chat-tab="${id}"] [role=tab]`).click();
    await page.locator('.xterm-rows').filter({ hasText: id === 'claude-fullscreen' ? 'Claude fullscreen transcript' : 'History line' }).waitFor();
  };
  for (const id of ['codex', 'claude-classic']) {
    await select(id);
    await page.locator('.xterm-screen').hover();
    const before = await page.locator('.xterm-rows').innerText();
    await page.mouse.wheel(0, -200);
    await page.waitForFunction(text => document.querySelector('.xterm-rows')?.innerText !== text, before);
    assert.equal(writes.get(id).filter(x => /\x1b(?:\[M|\[<)/.test(x)).length, 0, 'Normal history scroll stays local');
  }
  for (const phase of ['initial snapshot', 'tab return', 'window reload']) {
    if (phase === 'tab return') await select('codex');
    if (phase === 'window reload') await page.reload();
    await select('claude-fullscreen');
    await page.locator('.xterm-screen').hover();
    const before = position;
    await page.mouse.wheel(0, -120);
    await page.locator('.xterm-rows').filter({ hasText: `message ${before - 3}` }).waitFor();
    assert.equal(position, before - 3, `${phase}: wheel up reaches fullscreen transcript`);
    await page.mouse.wheel(0, 120);
    await page.locator('.xterm-rows').filter({ hasText: `message ${before}` }).waitFor();
    assert.equal(position, before, `${phase}: wheel down reaches fullscreen transcript`);
  }
  // Copy and ordinary typing still use the existing agent-chat rules.
  await page.locator('.xterm-helper-textarea').focus();
  await page.evaluate(() => navigator.clipboard.writeText('copy sentinel'));
  await page.keyboard.press('Control+c');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'copy sentinel');
  assert.equal(writes.get('claude-fullscreen').some(x => x.includes('\x03')), false);
  await page.keyboard.type('draft');
  assert.ok(writes.get('claude-fullscreen').join('').includes('draft'));
  assert.deepEqual(errors, []);
  console.log('Scroll UI passed: Codex/classic history stays local; Claude fullscreen wheel up/down works after initial snapshot, tab return and window reload; copy does not interrupt.');
} finally {
  await browser?.close();
  for (const s of service.sessions.items.values()) s.process = null;
  await service.close();
}
