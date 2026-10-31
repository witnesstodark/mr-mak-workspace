// Exercise the Run game panel in the real Chats window: two chats share one
// folder but work on different games. Each chat opens its own panel and keeps
// the project it chose, across a reload. Terminals are fakes; nothing is run.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { saveGame } from '../game-run.mjs';
import { desktopAuth, launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/game-ui-'));
const chats = [['p-0', 'Blended'], ['p-1', 'Channel']].map(([id, name], tabOrder) => ({
  id, name, group: null, tabOrder, agent: 'codex', cwd: repo, nativeId: null, hasConversation: false, open: true, pinned: false, status: 'stopped', createdAt: '2026-10-30T08:00:00Z', updatedAt: `2026-10-30T08:0${tabOrder}:00Z`, cols: 80, rows: 24,
}));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify(chats));
const blended = path.join(repo, 'blended');
await mkdir(blended);
await saveGame(blended, { command: 'abrir_blended.bat' });
let service, browser;
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => {
    session.status = 'running'; session.restoreError = null;
    let onExit;
    session.process = { resize() {}, write() {}, onExit(callback) { onExit = callback; return { dispose() {} }; }, kill() { session.process = null; session.status = 'stopped'; onExit?.(); } };
    service.sessions.changed(session);
  };
  // The Blended folder is one of the projects the picker offers.
  await service.sessions.create({ agent: 'shell', name: 'Blended folder', cwd: blended }).then(session => service.sessions.close?.(session.id)).catch(() => {});
  browser = await launchBrowser();
  // The desktop shell keeps its credentials in memory and restores them after a reload.
  const context = await browser.newContext({ viewport: { width: 1300, height: 700 } });
  await desktopAuth(context, service.urls.chats);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const tab = name => page.locator('.chat-tab').filter({ hasText: name }).first();
  const panel = page.locator('.game-panel');
  const toggle = page.getByRole('button', { name: 'Toggle game panel' });
  const project = page.getByLabel('Project whose game this chat runs');

  await page.goto(service.urls.chats);
  await tab('Blended').click();
  await toggle.click();
  await panel.getByText('has no game command yet').waitFor();
  const choice = await project.locator('option', { hasText: 'blended' }).first().getAttribute('value');
  assert.ok(choice, 'the Blended folder is offered');
  await project.selectOption(choice);
  await panel.getByText('abrir_blended.bat').waitFor();

  // The other chat in the same folder neither opens the panel nor sees Blended's game.
  await tab('Channel').click();
  assert.equal(await panel.count(), 0, 'the panel opens per chat');
  await toggle.click();
  await panel.getByText('has no game command yet').waitFor();
  assert.equal(await panel.getByText('abrir_blended.bat').count(), 0);
  await toggle.click();

  await page.reload();
  await tab('Blended').click();
  await panel.getByText('abrir_blended.bat').waitFor();
  await tab('Channel').click();
  assert.equal(await panel.count(), 0);
  assert.equal(service.sessions.get('p-1').gameFolder, null);
  assert.deepEqual(errors, []);
  console.log('game panel UI: per-chat project and panel state verified');
} finally {
  await browser?.close();
  await service?.close();
}
