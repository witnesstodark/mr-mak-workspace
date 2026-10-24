// Real built UI and isolated service; never mutates the user's Workspace.
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { localDay } from '../workspace.mjs';
import { launchBrowser, desktopAuth } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache', 'workspace-edit-ui-'));
await mkdir(path.join(repo, 'workspace', 'sample'), { recursive: true });
const report = '<h1>Project notes</h1><p>The report must survive metadata edits.</p>';
await writeFile(path.join(repo, 'workspace', 'sample', 'report.html'), report);
const file = path.join(repo, 'workspace', 'workspace.json');
const card = { id: 'sample', title: 'Character Workshop', description: 'A reviewable sample.', category: 'research', type: 'group', folder: 'sample', status: 'active', created: localDay(), steps: [{ name: 'Notes', path: 'report.html' }] };
await writeFile(file, JSON.stringify({ entities: [card, { ...card, id: 'other', title: 'Another project', category: 'game' }, { ...card, id: 'old', title: 'Older project', created: '2020-01-01' }] }));
await cp(path.join(root, 'public', 'assets'), path.join(root, 'dist', 'assets'), { recursive: true });
const service = await createService({ repo, uiDir: path.join(root, 'dist') });
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
  await desktopAuth(context, service.urls.workspace);
  const page = await context.newPage(), peer = await context.newPage();
  page.setDefaultTimeout(15000); peer.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.workspace); await peer.goto(service.urls.workspace);
  const homeCard = page.locator('.home [data-card="sample"]');
  const dot = () => homeCard.getByRole('button', { name: /^Edit Character Workshop:/ });
  const menu = page.getByRole('dialog', { name: 'Card settings: Character Workshop' });
  await dot().click(); await expect(menu).toBeVisible();
  assert.equal(new URL(page.url()).hash, '', 'The status button must not follow the card link');
  await menu.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(dot()).toHaveAttribute('aria-label', 'Edit Character Workshop: Done');
  await expect(peer.locator('.home [data-card="sample"] button')).toHaveAttribute('aria-label', 'Edit Character Workshop: Done');
  await dot().click(); await menu.getByRole('combobox', { name: 'Card category' }).selectOption('dev');
  await expect(homeCard.locator('.chip').first()).toHaveText(/dev/);
  await expect(homeCard.locator('xpath=ancestor::section').locator('.section-title')).toHaveText(/dev/);
  await dot().click(); await menu.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(homeCard).toHaveCount(0);
  assert.equal(await readFile(path.join(repo, 'workspace', 'sample', 'report.html'), 'utf8'), report);
  await page.getByRole('button', { name: 'Show menu', exact: true }).click();
  await page.getByRole('button', { name: /Show archive/ }).click();
  const row = page.locator('.sidebar [data-card="sample"]');
  await row.getByRole('button').click();
  await menu.getByRole('button', { name: 'Active', exact: true }).click();
  await expect(row.getByRole('button')).toHaveAttribute('aria-label', 'Edit Character Workshop: Active');
  await page.getByRole('button', { name: /Hide archive/ }).click();
  await expect(homeCard).toBeVisible();
  // A date-archived card can be brought back even if its stored status is active.
  await page.getByRole('textbox', { name: 'Search entities' }).fill('Older project');
  await page.locator('.sidebar [data-card="old"] button').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Active', exact: true }).click();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.locator('.home [data-card="old"]')).toBeVisible();
  await row.getByRole('button').click(); await menu.getByRole('button', { name: 'Pin card', exact: true }).click();
  await expect(row.locator('a')).toHaveClass(/pinned/);
  await row.getByRole('button').click(); await menu.getByRole('button', { name: 'Unpin card', exact: true }).click();
  await expect(row.locator('a')).not.toHaveClass(/pinned/);
  await row.getByRole('button').focus(); await page.keyboard.press('Enter'); await expect(menu).toBeVisible();
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(row.getByRole('button')).toBeFocused();
  await row.getByRole('button').click(); await page.mouse.click(800, 15); await expect(menu).toHaveCount(0);
  // Failed writes stay visible and never pretend the status changed.
  await page.route('**/api/workspace/entities/sample', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture: service temporarily unavailable.' }) }));
  await row.getByRole('button').click(); await menu.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(menu.getByRole('alert')).toHaveText('Fixture: service temporarily unavailable.');
  await expect(row.getByRole('button')).toHaveAttribute('aria-label', 'Edit Character Workshop: Active');
  await page.unroute('**/api/workspace/entities/sample');
  await menu.getByRole('button', { name: 'Done', exact: true }).click(); await expect(menu).toHaveCount(0);
  // The selected report also has an always-accessible status button.
  await row.getByRole('link').click();
  await page.frameLocator('iframe.report-frame').getByRole('heading', { name: 'Project notes' }).waitFor();
  await page.locator('.topbar').getByRole('button', { name: 'Edit Character Workshop: Done' }).click();
  // Let the save land before reloading; WebKit cancels in-flight requests on reload.
  const saved = page.waitForResponse(response => response.url().includes('/api/workspace/entities/sample') && response.request().method() === 'PATCH');
  await menu.getByRole('button', { name: 'Active', exact: true }).click(); await saved;
  await page.reload();
  await expect(page.locator('.topbar').getByRole('button', { name: 'Edit Character Workshop: Active' })).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.workspaceTheme = theme, theme);
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 740 });
      const control = page.locator('.topbar .entity-status-button');
      await control.click();
      await expect(menu).toBeVisible();
      const rect = await menu.boundingBox();
      assert.ok(rect.x >= 10 && rect.y >= 10 && rect.x + rect.width <= width - 10 && rect.y + rect.height <= 730, JSON.stringify(rect));
      const color = await menu.evaluate(element => getComputedStyle(element).backgroundColor);
      assert.equal(color, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(19, 19, 22)');
      await page.screenshot({ path: path.join(repo, `menu-${theme}-${width}.png`) });
      await page.keyboard.press('Escape');
    }
  }
  const registry = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(registry.entities.find(item => item.id === 'sample').steps, card.steps);
  assert.equal(registry.entities.find(item => item.id === 'sample').category, 'dev');
  assert.deepEqual(errors, []);
  console.log(`Workspace controls passed: status/category/pin, archive and restore, date archive, live peer sync, keyboard/focus, error/retry, report preservation, persisted reload, dark/light and 390px layout. Screenshots: ${repo}`);
} finally { await browser?.close(); await service.close(); }
