// Exercise the Game panel in the real Chats window: two chats share one folder
// but work on different games. Each chat opens its own panel and keeps the
// project it chose, across a reload. Opening the panel never runs anything; the
// first Run shows the command and runs it only after Run it, and a changed
// .agents/game.json asks again. Terminals are fakes; the only process started
// is the test's own small Node game, stopped from the panel.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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
// A closed chat in the Blended folder makes it one of the projects the picker offers.
// It is the newest, so the owner's own recent projects do not push it off the list.
chats.push({ ...chats[0], id: 'p-2', name: 'Blended folder', cwd: path.join(repo, 'blended'), open: false, tabOrder: 2, updatedAt: '2099-01-01T00:00:00Z' });
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify(chats));
const blended = path.join(repo, 'blended'), started = path.join(blended, 'started.txt');
await mkdir(blended);
await writeFile(path.join(blended, 'blended.cjs'), "console.log('Blended is running'); require('fs').appendFileSync('started.txt', 'run\\n'); setInterval(() => {}, 1000);");
await saveGame(blended, { command: 'node blended.cjs' });
const runs = async () => (await readFile(started, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
let service, browser;
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => {
    session.status = 'running'; session.restoreError = null;
    let onExit;
    session.process = { resize() {}, write() {}, onExit(callback) { onExit = callback; return { dispose() {} }; }, kill() { session.process = null; session.status = 'stopped'; onExit?.(); } };
    service.sessions.changed(session);
  };
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
  const confirmation = panel.getByRole('alertdialog', { name: 'Confirm game command' });

  await page.goto(service.urls.chats);
  await tab('Blended').click();
  await toggle.click();
  await panel.getByText('has no game command yet').waitFor();
  // The picker also lists the owner's real recent projects; choose the test's own folder by path.
  const offered = async () => (await project.locator('option').evaluateAll(options => options.map(option => option.value))).find(value => path.resolve(value).toLowerCase() === blended.toLowerCase());
  for (let tries = 0; tries < 40 && !await offered(); tries++) await page.waitForTimeout(100);
  const choice = await offered();
  assert.ok(choice, 'the Blended folder is offered');
  await project.selectOption(choice);
  await panel.getByText('node blended.cjs').waitFor();
  await panel.getByText('Asks before the first run').waitFor();
  assert.equal(await runs(), 0, 'opening the panel runs nothing');

  // The first Run shows what will run and where; Cancel runs nothing.
  await panel.getByRole('button', { name: 'Run game' }).click();
  await confirmation.waitFor();
  await confirmation.getByText(path.join(blended)).first().waitFor();
  await confirmation.getByText('blended.cjs').waitFor();
  assert.match(await confirmation.locator('dd').first().textContent(), /node(\.exe)?$/i);
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  assert.equal(await runs(), 0, 'a cancelled confirmation runs nothing');
  await panel.getByRole('button', { name: 'Run game' }).click();
  await confirmation.getByRole('button', { name: 'Run it' }).click();
  await panel.getByRole('button', { name: 'Stop game' }).waitFor();
  await panel.getByText('Blended is running').waitFor();
  assert.equal(await runs(), 1);
  assert.equal(await project.isDisabled(), true, 'the project stays while its game runs');
  await panel.getByRole('button', { name: 'Stop game' }).click();
  await panel.getByText(/Exited/).waitFor();

  // A confirmed command runs again without asking.
  await panel.getByRole('button', { name: 'Run game' }).click();
  await panel.getByRole('button', { name: 'Stop game' }).waitFor();
  assert.equal(await confirmation.count(), 0);
  await panel.getByRole('button', { name: 'Stop game' }).click();
  await panel.getByText(/Exited/).waitFor();
  assert.equal(await runs(), 2);

  // The other chat in the same folder neither opens the panel nor sees Blended's game.
  await tab('Channel').click();
  assert.equal(await panel.count(), 0, 'the panel opens per chat');
  await toggle.click();
  await panel.getByText('has no game command yet').waitFor();
  assert.equal(await panel.getByText('node blended.cjs').count(), 0);
  await toggle.click();

  // An agent changes the file: the panel asks again before the new command runs.
  await saveGame(blended, { command: 'node blended.cjs --level 2' });
  await page.reload();
  await tab('Blended').click();
  await panel.getByText('node blended.cjs --level 2').waitFor();
  await panel.getByRole('button', { name: 'Run game' }).click();
  await confirmation.getByText('changed since you last ran this game').waitFor();
  await confirmation.getByText('--level 2').waitFor();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  assert.equal(await runs(), 2, 'a changed command waits for its confirmation');
  await tab('Channel').click();
  assert.equal(await panel.count(), 0);
  assert.equal(service.sessions.get('p-1').gameFolder, null);
  assert.deepEqual(errors, []);
  console.log('game panel UI: per-chat project, confirmation before the first and a changed run, run and stop verified');
} finally {
  await browser?.close();
  await service?.close();
}
