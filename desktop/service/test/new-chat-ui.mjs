// Run after npm run build. New chat keeps the name, one agent dropdown and the
// permission choice in view, with the rest under More options. The fresh-chat
// suggestion follows context occupancy, and Later is kept by the service for a day.
// Fake PTYs and transcripts only.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { ConversationTranscripts } from '../mobile-transcript.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/new-chat-ui-'));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
// The offer needs a readable transcript; its length no longer matters.
ConversationTranscripts.prototype.read = async () => ({ supported: true, messages: [], userMessages: 400, truncated: true });
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
const session = service.sessions.make({ id: 'long', name: 'Long chat', agent: 'claude', cwd: repo, status: 'running', open: true, pinned: false, hasConversation: true, tabOrder: 0, createdAt: new Date().toISOString(), cols: 90, rows: 30 });
service.sessions.items.set(session.id, session); await service.sessions.hydrate(session);
session.process = { write() {}, resize() {}, kill() {} };
const usage = usedTokens => service.sessions.nativeEvent(session, { kind: 'context-usage', usage: { usedTokens, limitTokens: 200000, source: 'claude', updatedAt: new Date().toISOString(), reason: null } });
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('mrmak.chatView.default', 'conversation'); localStorage.setItem('mrmak.selectedChat', 'long'); });
  await page.goto(service.urls.chats);
  await page.locator('.desk-conversation').waitFor();
  const offer = page.locator('.handoff-offer');

  // Hundreds of messages and a truncated transcript alone do not trigger it.
  usage(60000);
  await page.waitForTimeout(400);
  assert.equal(await offer.count(), 0, 'no offer at 30% context');
  usage(150000);
  await offer.getByText('Context is 75% full').waitFor();
  assert.match(await offer.textContent(), /150K of 200K tokens/);

  // Later is stored with the chat: a reload, a second window or a restart keeps it.
  await offer.getByRole('button', { name: 'Later' }).click();
  await offer.waitFor({ state: 'detached' });
  const until = Date.parse(session.handoffSnooze.until);
  assert.ok(until - Date.now() > 23.9 * 3600_000 && until - Date.now() <= 24 * 3600_000, 'Later lasts a day');
  await page.goto(service.urls.chats); // A fresh window load; the URL token is not kept for reloads.
  await page.locator('.desk-conversation').waitFor();
  usage(170000);
  await page.waitForTimeout(400);
  assert.equal(await offer.count(), 0, 'Later survives a reload and further growth');
  assert.equal(service.sessions.list().find(item => item.id === 'long').handoffSnooze.until, session.handoffSnooze.until, 'the snooze is saved with the chat');

  // When the day is over, the offer returns; Not for this chat ends it.
  service.sessions.snoozeHandoff('long', null);
  await offer.waitFor();
  await offer.getByRole('button', { name: 'Not for this chat' }).click();
  await offer.waitFor({ state: 'detached' });
  assert.deepEqual(session.handoffSnooze, { never: true });

  // New chat: name first, one agent dropdown, permissions in view, the rest folded.
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const dialog = page.locator('.new-chat-dialog');
  await dialog.waitFor();
  assert.equal(await dialog.locator('.desk-eyebrow').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Chat name, in English');
  const trigger = dialog.locator('.agent-select');
  await page.screenshot({ path: path.join(repo, 'new-chat-folded.png') });
  const before = await trigger.getAttribute('aria-label');
  assert.equal(await dialog.locator('.new-chat-advanced').getAttribute('open'), null, 'More options start folded');
  assert.match(await dialog.locator('.new-chat-advanced > summary').textContent(), /^More options/);
  await trigger.click();
  const list = page.getByRole('listbox', { name: 'Agent' });
  await list.waitFor();
  const options = await list.getByRole('option').allTextContents();
  assert.ok(options.length >= 2, 'every agent is listed, including ones not installed');
  assert.ok(options.some(text => text.startsWith('PowerShell') || text.startsWith('Shell') || text.startsWith('Terminal')), 'the local terminal is listed');
  const box = await list.boundingBox(), view = page.viewportSize();
  assert.ok(box.y >= 0 && box.y + box.height <= view.height, 'the list stays on screen');
  // Escape closes the list, not the dialog.
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached' });
  await dialog.waitFor();
  // The keyboard picks the local terminal, which has no permission choice.
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await list.waitFor();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await list.waitFor({ state: 'detached' });
  assert.notEqual(await trigger.getAttribute('aria-label'), before);
  assert.equal(await dialog.locator('.desk-check').count(), 0, 'the terminal has no permission prompt to bypass');
  // A click outside closes the list.
  await trigger.click(); await list.waitFor();
  await dialog.locator('.new-chat-name').click();
  await list.waitFor({ state: 'detached' });
  await dialog.locator('.new-chat-advanced > summary').click();
  await dialog.locator('select[aria-label="Group"]').waitFor();
  for (const theme of ['dark', 'light']) {
    await fetch(`${service.origin}/api/settings`, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ chatTheme: theme }) });
    await page.waitForTimeout(300);
    await trigger.click(); await list.waitFor();
    await page.screenshot({ path: path.join(repo, `new-chat-${theme}.png`) });
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, []);
  console.log(`New chat UI passed: context-based fresh-chat offer, day-long Later kept by the service, Not for this chat, name-first dialog, agent dropdown by mouse and keyboard, folded More options. Screenshots: ${repo}`);
} finally {
  await browser?.close();
  session.process = null;
  await service.close();
}
