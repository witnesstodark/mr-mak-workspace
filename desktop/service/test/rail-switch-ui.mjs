// Switching chats with the Plan panel open shows only the chosen chat: its
// Conversation (or terminal) and its own Plan panel, never the previous chat's.
// Terminals are fakes; no installed CLI or account is used.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/rail-switch-ui-'));
const names = ['Alpha', 'Beta', 'Gamma'];
const chats = names.map((name, tabOrder) => ({
  id: `r-${tabOrder}`, name, group: null, tabOrder, agent: 'codex', cwd: repo, nativeId: null, hasConversation: tabOrder !== 2, open: true, pinned: false, status: 'stopped', createdAt: '2026-10-30T08:00:00Z', updatedAt: `2026-10-30T08:0${tabOrder}:00Z`, cols: 80, rows: 24,
}));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify(chats));
let service, browser;
try {
  service = await createService({ repo, uiDir: process.env.MRMAK_UI_DIR || path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => {
    session.status = 'running'; session.restoreError = null;
    let onExit;
    session.process = { resize() {}, write() {}, onExit(callback) { onExit = callback; return { dispose() {} }; }, kill() { session.process = null; session.status = 'stopped'; onExit?.(); } };
    service.sessions.changed(session);
  };
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1300, height: 700 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const tab = name => page.locator('.chat-tab').filter({ hasText: name }).first();
  // Everything drawn in the chat area: one chat view and at most one Plan panel.
  const shown = () => page.evaluate(() => {
    const main = document.querySelectorAll('.chat-main');
    const box = main[0];
    return {
      mains: main.length,
      children: box ? box.children.length : 0,
      conversations: box ? box.querySelectorAll('.conversation-scroll').length : 0,
      terminals: box ? box.querySelectorAll('.xterm').length : 0,
      rails: box ? box.querySelectorAll('.session-rail').length : 0,
    };
  });

  await page.goto(service.urls.chats);
  await tab('Alpha').click();
  await page.getByRole('button', { name: /plan/i }).first().click();
  await page.locator('.session-rail').waitFor();
  const results = [];
  for (const name of ['Beta', 'Gamma', 'Alpha', 'Gamma', 'Beta', 'Alpha']) {
    await tab(name).click();
    await page.waitForTimeout(400);
    const state = await shown();
    results.push({ name, ...state });
    assert.equal(state.mains, 1, `${name}: one chat area`);
    assert.equal(state.rails, 1, `${name}: one Plan panel ${JSON.stringify(state)}`);
    assert.equal(state.conversations + state.terminals, 1, `${name}: one chat view ${JSON.stringify(state)}`);
  }
  // The same in Conversation view, with the Game panel open too.
  for (const name of ['Alpha', 'Beta']) {
    await tab(name).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Toggle game panel' }).click();
  for (const name of ['Alpha', 'Gamma', 'Beta', 'Alpha']) {
    await tab(name).click();
    await page.waitForTimeout(400);
    const state = await shown();
    results.push({ name, ...state });
    assert.equal(state.rails, 1, `${name}: one Plan panel ${JSON.stringify(state)}`);
    assert.equal(state.conversations + state.terminals, 1, `${name}: one chat view ${JSON.stringify(state)}`);
    assert.ok((await page.locator('.chat-main .game-panel').count()) <= 1, `${name}: at most one Game panel`);
  }
  assert.deepEqual(errors.filter(text => /same key|unique "key"/i.test(text)), []);
  console.log('rail switch UI passed:', JSON.stringify(results));
} finally {
  await browser?.close();
  await service?.close();
}
