// Exercise tab groups in the real Chats window: header chips, collapse that
// survives a reload, the tab right-click menu, dropping a tab on a chip and the
// New chat group picker. Terminals are fakes; no user chats or logins are used.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/groups-ui-'));
// g-4 is a closed chat: it keeps its group in History and has no tab.
const chats = [['g-0', 'Director', 'ThugLife', true], ['g-1', 'Network', 'ThugLife', true], ['g-2', 'Animator', null, true], ['g-3', 'Combat', 'Dungeon', true], ['g-4', 'Scout', 'Dungeon', false]].map(([id, name, group, open], tabOrder) => ({
  id, name, group, tabOrder, agent: 'codex', cwd: repo, nativeId: null, hasConversation: false, open, pinned: false, status: 'stopped', createdAt: '2026-10-14T08:00:00Z', updatedAt: `2026-10-14T08:0${tabOrder}:00Z`, cols: 80, rows: 24,
}));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify(chats));
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
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const names = () => page.locator('.chat-tabs .chat-tab-name').allTextContents();
  const groupNames = group => page.locator(`.chat-tab-group[data-chat-group="${group}"] .chat-tab-name`).allTextContents();
  const chip = group => page.locator(`.chat-tab-group[data-chat-group="${group}"] .chat-group-chip`);
  const tab = name => page.locator('.chat-tab').filter({ hasText: name }).first();

  await page.goto(service.urls.chats);
  await page.locator('.chat-tab-group').nth(1).waitFor();
  assert.deepEqual(await names(), ['Director', 'Network', 'Animator', 'Combat']);
  assert.deepEqual(await page.locator('.chat-group-chip .chip-name').allTextContents(), ['ThugLife', 'Dungeon']);
  assert.deepEqual(await page.locator('.chat-group-chip small').allTextContents(), ['2', '1']);

  // Collapse hides every member except the selected one, and the choice survives a reload.
  await chip('ThugLife').click();
  await page.locator('.chat-tab-group.collapsed').waitFor();
  assert.deepEqual(await names(), ['Director', 'Animator', 'Combat']);
  await page.reload();
  await page.locator('.chat-tab-group.collapsed').waitFor();
  assert.deepEqual(await names(), ['Director', 'Animator', 'Combat']);
  await chip('ThugLife').click();
  await page.locator('.chat-tab-group.collapsed').waitFor({ state: 'detached' });
  assert.deepEqual(await names(), ['Director', 'Network', 'Animator', 'Combat']);

  // Right-click: move an ungrouped tab into an existing group, then into a new one, then ungroup from the chip.
  await tab('Animator').click({ button: 'right' });
  await page.locator('.tab-menu').waitFor();
  assert.deepEqual(await page.locator('.tab-menu [role=menuitem]').allTextContents(), ['Rename chat', 'Pin in History', 'Dungeon', 'ThugLife', 'Show working folder', 'Clear terminal scrollback', 'Close tab · keep in History'], 'the tab menu keeps the chat settings and offers groups most recently active first');
  await page.locator('.tab-menu [aria-label="Rose tab color"]').click();
  await page.locator('.chat-tab.has-color').filter({ hasText: 'Animator' }).waitFor();
  assert.equal(service.sessions.get('g-2').tabColor, '#dba3bb');
  await tab('Animator').click({ button: 'right' });
  await page.locator('.tab-menu [role=menuitem]', { hasText: 'Pin in History' }).click();
  await page.locator('.chat-tab').first().filter({ hasText: 'Animator' }).waitFor();
  assert.equal(service.sessions.get('g-2').pinned, true, 'pinning from the menu moves the tab ahead');
  await tab('Animator').click({ button: 'right' });
  await page.locator('.tab-menu [role=menuitem]', { hasText: 'Unpin from History' }).click();
  await page.locator('.chat-tab').last().filter({ hasText: 'Animator' }).waitFor();
  assert.equal(service.sessions.get('g-2').pinned, false, 'unpinning returns the tab to the end of the unpinned tabs');
  await tab('Animator').click({ button: 'right' });
  await page.locator('.tab-menu [role=menuitem]', { hasText: 'Rename chat' }).click();
  await page.locator('.tab-menu-rename input').fill('Animator Lead');
  await page.locator('.tab-menu-rename input').press('Enter');
  await tab('Animator Lead').waitFor();
  await tab('Animator Lead').click({ button: 'right' });
  await page.locator('.tab-menu [role=menuitem]', { hasText: 'Rename chat' }).click();
  await page.locator('.tab-menu-rename input').fill('Animator');
  await page.locator('.tab-menu-rename input').press('Enter');
  await tab('Animator').waitFor();
  await tab('Animator').getByRole('tab').press('F2');
  await page.getByRole('textbox', { name: 'English chat name' }).fill('Animation Review');
  await page.getByRole('textbox', { name: 'English chat name' }).press('Enter');
  await tab('Animation Review').getByRole('tab').dblclick();
  await page.getByRole('textbox', { name: 'English chat name' }).fill('Animator');
  await page.getByRole('textbox', { name: 'English chat name' }).press('Enter');
  await tab('Animator').waitFor();
  await tab('Animator').click({ button: 'right' });
  await page.locator('.tab-menu [role=menuitem]', { hasText: 'Dungeon' }).click();
  await page.locator('.chat-tab-group[data-chat-group="Dungeon"] .chat-tab').nth(1).waitFor();
  assert.deepEqual(await groupNames('Dungeon'), ['Combat', 'Animator'], 'joining places the tab after the last member');
  assert.equal(service.sessions.get('g-2').group, 'Dungeon');
  await tab('Animator').click({ button: 'right' });
  await page.locator('.tab-menu input').fill('Research');
  await page.locator('.tab-menu input').press('Enter');
  await chip('Research').waitFor();
  assert.deepEqual(await groupNames('Research'), ['Animator']);
  assert.deepEqual(await names(), ['Director', 'Network', 'Combat', 'Animator']);
  await chip('Research').click({ button: 'right' });
  await page.locator('.tab-menu [aria-label="Sky group color"]').click();
  await page.waitForFunction(() => document.querySelector('.chat-tab-group[data-chat-group="Research"]')?.style.getPropertyValue('--tab-accent') === '#91b6da');
  assert.deepEqual((await (await fetch(service.origin + '/api/bootstrap', { headers: { Authorization: `Bearer ${service.token}` } })).json()).settings.groupColors, { Research: '#91b6da' });
  await chip('Research').click({ button: 'right' });
  assert.equal(await page.locator('.tab-menu [aria-label="Sky group color"]').getAttribute('aria-pressed'), 'true');
  await page.locator('.tab-menu [aria-label="No group color"]').click();
  await page.waitForFunction(() => document.querySelector('.chat-tab-group[data-chat-group="Research"]')?.style.getPropertyValue('--tab-accent') !== '#91b6da');
  await chip('Research').click({ button: 'right' });
  await page.locator('.tab-menu [role=menuitem]', { hasText: 'Ungroup 1 tab' }).click();
  await chip('Research').waitFor({ state: 'detached' });
  assert.equal(service.sessions.get('g-2').group, null);
  assert.equal(await page.locator('.chat-tab-group').count(), 2);

  // Drag a tab onto a group chip.
  const from = await tab('Animator').locator('.chat-tab-select').boundingBox();
  const to = await chip('ThugLife').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) await page.mouse.move(from.x + (to.x + to.width / 2 - from.x) * step / 12, from.y + (to.y + to.height / 2 - from.y) * step / 12);
  await page.locator('.chat-tab-group.drop-into').waitFor();
  await page.mouse.up();
  await page.locator('.chat-tab-group[data-chat-group="ThugLife"] .chat-tab').nth(2).waitFor();
  assert.deepEqual(await groupNames('ThugLife'), ['Director', 'Network', 'Animator']);

  // New chat offers the known groups and files the new tab under the chosen one.
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const picker = page.locator('.desk-dialog select[aria-label="Group"]');
  assert.deepEqual(await picker.locator('option').allTextContents(), ['No group', 'Dungeon', 'ThugLife', 'New group…']);
  await page.locator('.desk-dialog input[placeholder*="Dream Game"]').fill('Producer');
  await picker.selectOption('ThugLife');
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.locator('.chat-tab-group[data-chat-group="ThugLife"] .chat-tab').filter({ hasText: 'Producer' }).waitFor();
  const created = service.sessions.list().find(item => item.name === 'Producer');
  assert.equal(created.group, 'ThugLife');
  assert.deepEqual(await groupNames('ThugLife'), ['Director', 'Network', 'Animator', 'Producer']);

  // The chat options menu carries the same picker and can clear the group.
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.locator('.chat-options select[aria-label="Group"]').selectOption('');
  await page.locator('.chat-tab-group[data-chat-group="ThugLife"] .chat-tab').filter({ hasText: 'Producer' }).waitFor({ state: 'detached' });
  assert.equal(service.sessions.get(created.id).group, null);

  // Right-click a chip to rename the group; a taken name is offered as a merge.
  await chip('ThugLife').click({ button: 'right' });
  await page.locator('.tab-menu [role=menuitem]', { hasText: 'Rename group' }).click();
  await page.locator('.tab-menu-rename input').fill('Dungeon');
  assert.equal(await page.locator('.tab-menu-rename button').textContent(), 'Merge');
  await page.locator('.tab-menu-rename input').fill('Studio');
  assert.equal(await page.locator('.tab-menu-rename button').textContent(), 'Save');
  await page.locator('.tab-menu-rename input').press('Enter');
  await chip('Studio').waitFor();
  await expect.poll(() => groupNames('Studio')).toEqual(['Director', 'Network', 'Animator']);
  assert.equal(service.sessions.get('g-0').group, 'Studio');

  // Dragging a chip moves the whole group, and the drag does not collapse it.
  const grab = await chip('Dungeon').boundingBox();
  const studio = await page.locator('.chat-tab-group[data-chat-group="Studio"]').boundingBox();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) await page.mouse.move(grab.x + grab.width / 2 + (studio.x + 8 - grab.x - grab.width / 2) * step / 12, grab.y + grab.height / 2 + (studio.y + studio.height / 2 - grab.y - grab.height / 2) * step / 12);
  await page.locator('.chat-tab-group.drop-before[data-chat-group="Studio"]').waitFor();
  assert.equal(await page.locator('.group-ghost').count(), 1);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.chat-group-chip .chip-name')?.textContent === 'Dungeon');
  assert.deepEqual(await page.locator('.chat-group-chip .chip-name').allTextContents(), ['Dungeon', 'Studio']);
  assert.equal(await page.locator('.chat-tab-group.collapsed').count(), 0);

  // Right-click a chip to delete the group: the open tab and the History chat lose it, both chats stay.
  await chip('Dungeon').click({ button: 'right' });
  await page.locator('.tab-menu [role=menuitem]', { hasText: 'Delete group…' }).click();
  assert.match(await page.locator('.tab-menu-confirm p').textContent(), /1 open tab and 1 chat in History/);
  await page.locator('.tab-menu-confirm button.danger').click();
  await chip('Dungeon').waitFor({ state: 'detached' });
  assert.equal(service.sessions.get('g-3').group, null);
  assert.equal(service.sessions.get('g-4').group, null);
  assert.ok((await names()).includes('Combat'), 'the chat stays open');

  // History lists every group as a filter, including one that only a closed chat still carries, and deletes it from there.
  await service.sessions.assign('g-4', 'Archive');
  await page.locator('.history-button').click();
  await page.locator('.history-filters button', { hasText: 'Archive' }).click();
  assert.match(await page.locator('.history-group-bar').textContent(), /Archive · 0 open · 1 in History/);
  assert.deepEqual(await page.locator('.history-item strong').allTextContents(), ['Scout']);
  await page.locator('.history-group-bar button', { hasText: 'Delete group…' }).click();
  await page.locator('.history-group-bar button.danger').click();
  await page.locator('.history-filters button', { hasText: 'Archive' }).waitFor({ state: 'detached' });
  assert.equal(service.sessions.get('g-4').group, null);
  assert.equal(await page.locator('.history-filters button.selected').textContent(), 'All');
  await page.locator('.history-button').click();

  // The folder button groups the open tabs by project folder, then ungroups them.
  const byProject = page.getByRole('button', { name: 'Group tabs by project', exact: true });
  await expect(byProject).toHaveAttribute('aria-pressed', 'false');
  await byProject.click();
  await expect(byProject).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.chat-group-chip')).toHaveCount(1);
  assert.ok(service.sessions.active().every(item => item.group));
  await byProject.click();
  await expect(byProject).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.chat-group-chip')).toHaveCount(0);

  assert.equal(await page.locator('.desktop-error').count(), 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(repo, 'groups.png') });
  console.log(`Groups UI passed: chips, collapse across reload, tab menu with rename, pin, tab color and groups, group color from the chip menu, new group, ungroup, drop on chip, New chat picker, options picker, group rename, group drag, group by project toggle, delete from the chip and from History. Screenshot: ${path.join(repo, 'groups.png')}`);
} finally {
  await browser?.close(); await service?.close();
}
