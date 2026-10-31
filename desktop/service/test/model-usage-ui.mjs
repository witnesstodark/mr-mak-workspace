import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = await mkdtemp(path.join(root, '.cache/usage-smoke-'));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await cp(path.join(root, 'public/assets'), path.join(repo, 'ui/assets'), { recursive: true });
let service, browser;
try {
  service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });
  const add = async (id, agent, tabOrder) => {
    const session = service.sessions.make({ id, name: `${agent} usage`, agent, cwd: repo, status: 'running', open: true, hasConversation: true, createdAt: new Date().toISOString(), cols: 90, rows: 30, tabOrder });
    session.process = { write() {}, resize() {}, kill() {}, onExit(done) { setTimeout(done, 0); return { dispose() {} }; } };
    service.sessions.items.set(session.id, session);
    await service.sessions.hydrate(session);
  };
  await add('usage-check', 'codex', 0);
  await add('claude-check', 'claude', 1);
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const resetsAt = Math.floor(Date.now() / 1000) + 7200;
  const general = { limitId: 'general', planType: 'plus', primary: { usedPercent: 38, windowMinutes: 300, resetsAt }, secondary: { usedPercent: 68, windowMinutes: 10080, resetsAt } };
  const exclusive = { limitId: 'exclusive', limitName: 'Special model', isExclusive: true, primary: { usedPercent: 82, windowMinutes: 300, resetsAt } };
  await page.route('**/api/sessions/usage-check/stats', route => route.fulfill({ json: { supported: true, model: 'gpt-6', usage: { agent: 'codex', tokens: { current: 64000, cumulative: 180000, input: 150000, cached: 12000, output: 30000, contextWindow: 256000, contextPercent: 25 }, rateLimits: general, rateLimitsList: [general, exclusive], costUSD: 1.25 } } }));
  // A Claude chat whose status line has not reported its plan limits yet.
  let claudeModel = 'claude-opus-5-5', claudeEffort = 'high';
  const applied = [], sent = [];
  await page.route('**/api/sessions/claude-check/stats', route => route.fulfill({ json: { supported: true, model: claudeModel, effort: claudeEffort, usage: { agent: 'claude', tokens: { current: 30000, cumulative: 30000, input: 30000, cached: 0, output: 0, contextWindow: null, contextPercent: null }, rateLimits: null, rateLimitsList: [] } } }));
  await page.route('**/api/sessions/claude-check/models', route => route.fulfill({ json: { agent: 'claude', supported: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], models: [
    { id: 'claude-opus-5-5', name: 'Opus 5.5', shortName: 'Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', contextWindow: 1000000 },
    { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', shortName: 'Sonnet', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', contextWindow: 1000000 },
  ] } }));
  await page.route('**/api/sessions/claude-check/model', async route => {
    const change = route.request().postDataJSON(); applied.push(change);
    if (change.model) claudeModel = change.model;
    if (change.effort) claudeEffort = change.effort;
    await route.fulfill({ json: { applied: true, ...change } });
  });
  await page.route('**/api/sessions/*/send', async route => { sent.push(route.request().postDataJSON()); await route.fulfill({ json: { delivered: true } }); });
  await page.goto(service.urls.chats);

  // The footer shows only the 5-hour and weekly percentages; the rest is in the tooltip.
  const chip = page.getByRole('button', { name: /^Plan usage:/ });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/5h.*38%.*Week.*68%/);
  await expect(chip).not.toContainText('Special model');
  await expect(chip).not.toContainText('ctx');
  await expect(chip).not.toContainText('$');
  await chip.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Codex');
  await expect(tooltip).toContainText('Special model');
  await expect(tooltip).toContainText('64k / 256k tokens');
  await expect(tooltip).toContainText('$1.25');
  await expect(tooltip).toContainText(/Resets in 1h 5\dm|Resets in 2h 0m|Resets in 1h/);
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  // Keyboard focus shows the tooltip too, and Escape hides it.
  await chip.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  // Codex changes its model only in its own picker, which opens in the terminal.
  const codexModel = page.getByRole('button', { name: 'gpt-6 · xhigh' });
  await expect(codexModel).toBeVisible();
  await codexModel.click();
  await expect(page.getByRole('dialog', { name: 'Model and effort' })).toContainText('own picker');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Model and effort' })).toHaveCount(0);

  // A Claude chat: unknown limits read "—", and the menu applies a choice directly.
  await page.getByRole('tab', { name: /claude usage/i }).click();
  // The terminal takes focus once its screen arrives; open the menu after that.
  await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'), null, { timeout: 5000 }).catch(() => {});
  await expect(chip).toHaveText(/5h\s*—.*Week\s*—/);
  const modelChip = page.getByRole('button', { name: 'Opus · high' });
  await expect(modelChip).toBeVisible();
  await modelChip.click();
  const menu = page.getByRole('dialog', { name: 'Model and effort' });
  await expect(menu.getByRole('radio', { name: /Opus 5\.5/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('radio', { name: /Opus 5\.5/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('radio', { name: /Sonnet 5\.5/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Sonnet · high' })).toBeVisible();
  await menu.getByRole('radio', { name: 'max effort' }).click();
  await expect(page.getByRole('button', { name: 'Sonnet · max' })).toBeVisible();
  assert.deepEqual(applied, [{ model: 'claude-sonnet-5-5' }, { effort: 'max' }]);
  assert.deepEqual(sent, [], 'the menu never types a bare /model or /effort into the chat');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sonnet · max' })).toBeFocused();

  const set = value => fetch(service.origin + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const byProject = page.getByRole('button', { name: 'Group tabs by project', exact: true });
  await byProject.click();
  await expect(page.locator('.chat-group-chip')).toHaveCount(1);
  await expect(byProject).toHaveAttribute('aria-pressed', 'true');
  await byProject.click();
  await expect(page.locator('.chat-group-chip')).toHaveCount(0);
  await expect(byProject).toHaveAttribute('aria-pressed', 'false');
  for (const theme of ['antigravity', 'nordic']) {
    await set({ chatTheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', theme);
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 820 });
      await expect(chip).toBeVisible();
      await page.getByRole('button', { name: 'Sonnet · max' }).click();
      await expect(menu).toBeVisible();
      await expect.poll(() => page.locator('.chat-status, .chat-status-usage, .model-menu-chip, .model-menu-panel').evaluateAll(nodes => nodes.every(node => {
        const box = node.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
      }))).toBe(true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.waitForTimeout(250); // The menu fades in.
      await page.screenshot({ path: path.join(root, `.cache/usage-footer-${theme}-${width}.png`) });
      await page.keyboard.press('Escape');
      await chip.hover();
      await expect(page.getByRole('tooltip')).toBeVisible();
      await expect.poll(() => page.getByRole('tooltip').evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0; })).toBe(true);
      await page.mouse.move(0, 0);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['5-hour and weekly percentages only in the footer', 'unknown limits shown as —', 'usage tooltip on hover and focus', 'model and effort menu applies directly, keyboard and Escape', 'no /model or /effort typed into the chat', 'group-by-project action', 'footer and menu fit at 390/768/1280 px in two themes'], fixture: repo }));
} finally { await browser?.close(); await service?.close(); }
