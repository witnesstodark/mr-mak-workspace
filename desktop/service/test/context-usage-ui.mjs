// Isolated UI/service fixture. No real CLI or user session is started.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { createService } from '../server.mjs';
import { nativeContext } from '../native-context.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/context-usage-ui-'));
await mkdir(path.join(repo, 'workspace')); await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify(['codex', 'claude', 'kimi'].map((agent, index) => ({ id: `context-${agent}`, tabOrder: index, name: `${agent} Context`, agent, cwd: repo, open: true, pinned: false, cols: 90, rows: 28, createdAt: '2026-10-23T08:00:00Z', updatedAt: '2026-10-23T08:00:00Z' }))));
let service, browser;
const errors = [];
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  for (const session of service.sessions.items.values()) {
    await service.sessions.hydrate(session);
    session.status = 'running'; session.process = { resize() {}, write() {}, kill() { session.process = null; } };
  }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  let connection;
  await page.routeWebSocket('**/events', route => { connection = route; route.connectToServer(); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  const display = page.getByRole('status', { name: 'Session context usage' });
  const choose = agent => page.locator(`[data-chat-tab="context-${agent}"] [role=tab]`).click();
  await choose('codex');
  await expect(display).toContainText('Unknown');
  const codex = service.sessions.get('context-codex');
  const report = used => nativeContext({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: used }, total_token_usage: { total_tokens: 9000000 }, model_context_window: 200000 } } }, 'codex');
  service.sessions.nativeEvent(codex, report(30000));
  await expect(display).toContainText('15% used · 30,000 / 200,000 tokens');
  await expect(display.getByRole('meter')).toHaveAttribute('value', '15');
  await choose('claude'); await expect(display).toContainText('Unknown');
  service.sessions.nativeEvent(service.sessions.get('context-claude'), nativeContext({ type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: 20000, cache_creation_input_tokens: 1000 } } }, 'claude'));
  await expect(display).toContainText('21,010 tokens · limit unknown');
  await expect(display.getByRole('meter')).toHaveCount(0);
  await choose('kimi'); await expect(display).toContainText('Unavailable');
  await choose('codex'); await expect(display).toContainText('30,000');
  service.sessions.nativeEvent(codex, nativeContext({ type: 'compacted' }, 'codex'));
  await expect(display).toContainText('Unknown · waiting after compact');
  service.sessions.nativeEvent(codex, report(4000));
  await expect(display).toContainText('2% used · 4,000 / 200,000 tokens');
  service.sessions.input(codex.id, '/new\r');
  await expect(display).toContainText('Unknown');
  service.sessions.nativeEvent(codex, report(190000));
  for (const width of [320, 500, 900, 1440]) {
    await page.setViewportSize({ width, height: 760 });
    await expect(display).toBeVisible();
    assert.equal(await display.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `context fits ${width}px`);
    await expect(display).toContainText('95% used · 190,000 / 200,000 tokens');
    if (width === 900 || width === 320) await page.screenshot({ path: path.join(repo, `context-${width}.png`) });
  }
  await service.sessions.clearScreen(codex.id);
  await expect(display).toContainText('190,000', { timeout: 2000 });
  connection.close();
  await expect(display).toContainText('Unknown · disconnected');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, fixture: repo, checks: ['unknown and unsupported', 'live native reports', 'session switching', 'compact and new reset', 'scrollback clear preserves context', 'disconnected hides old values', '320/500/900/1440px', 'no page errors'] }));
} finally {
  // These are fixture objects only; do not exercise native shutdown delays.
  if (service) for (const session of service.sessions.items.values()) session.process = null;
  await browser?.close(); await service?.close();
}
