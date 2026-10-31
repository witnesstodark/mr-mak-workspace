// Run after npm run build. Opening a chat with an unread reply in the Conversation
// view clears its unread mark, as opening it in Terminal does. Fake PTYs only.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/unread-ui-'));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
for (const [index, id] of ['first', 'second'].entries()) {
  const session = service.sessions.make({ id, name: `${id} chat`, agent: 'claude', cwd: repo, status: 'running', open: true, pinned: false, hasConversation: true, tabOrder: index, createdAt: new Date().toISOString(), cols: 90, rows: 30 });
  service.sessions.items.set(id, session); await service.sessions.hydrate(session);
  session.process = { write() {}, resize() {}, kill() {} };
}
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('mrmak.chatView.default', 'conversation'); localStorage.setItem('mrmak.selectedChat', 'first'); });
  await page.goto(service.urls.chats);
  await page.locator('.desk-conversation').waitFor();
  const second = service.sessions.get('second');
  service.sessions.nativeEvent(second, { kind: 'turn-completed', id: 'reply-1', preview: 'Done.' });
  assert.equal(second.unread, true);
  await page.locator('[data-chat-tab="second"] .session-unread').waitFor();
  await page.locator('[data-chat-tab="second"]').click();
  await page.locator('.desk-conversation').waitFor();
  await page.locator('[data-chat-tab="second"] .session-unread').waitFor({ state: 'detached' });
  assert.equal(second.unread, false);
  assert.deepEqual(errors, []);
  console.log('Unread UI checks passed.');
} finally {
  await browser?.close();
  for (const session of service.sessions.items.values()) session.process = null;
  await service.close();
}
