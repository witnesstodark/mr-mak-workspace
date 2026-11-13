import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = await mkdtemp(path.join(root, '.cache/model-menu-smoke-'));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await cp(path.join(root, 'public/assets'), path.join(repo, 'ui/assets'), { recursive: true });
let service, browser;
try {
  service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });
  const add = async (id, agent, tabOrder) => {
    const session = service.sessions.make({ id, name: `${agent} model`, agent, cwd: repo, status: 'running', open: true, hasConversation: true, createdAt: new Date().toISOString(), cols: 90, rows: 30, tabOrder });
    session.process = { write() {}, resize() {}, kill() {}, onExit(done) { setTimeout(done, 0); return { dispose() {} }; } };
    service.sessions.items.set(session.id, session);
    await service.sessions.hydrate(session);
  };
  await add('codex-check', 'codex', 0);
  await add('claude-check', 'claude', 1);
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/sessions/codex-check/stats', route => route.fulfill({ json: { supported: true, model: 'gpt-6', effort: null } }));
  let claudeModel = 'claude-opus-5-5', claudeEffort = 'high';
  const applied = [], sent = [];
  await page.route('**/api/sessions/claude-check/stats', route => route.fulfill({ json: { supported: true, model: claudeModel, effort: claudeEffort } }));
  await page.route('**/api/sessions/claude-check/models', route => route.fulfill({ json: { agent: 'claude', supported: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], models: [
    { id: 'claude-opus-5-5', name: 'Opus 5.5', shortName: 'Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', contextWindow: 1000000 },
    { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', shortName: 'Sonnet', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', contextWindow: 1000000 },
    { id: 'claude-nope-9', name: 'Nope 9', shortName: 'Nope', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', contextWindow: 200000 },
  ] } }));
  await page.route('**/api/sessions/claude-check/model', async route => {
    const change = route.request().postDataJSON(); applied.push(change);
    // The CLI refuses a model it cannot validate; the service reports that and keeps the previous one.
    if (change.model === 'claude-nope-9') return route.fulfill({ json: { applied: false, status: { model: 'failed' }, note: 'Claude Code did not change the model: Failed to validate model: claude-nope-9' } });
    if (change.model) claudeModel = change.model;
    if (change.effort) claudeEffort = change.effort;
    await route.fulfill({ json: { applied: true, ...change, status: { ...(change.model && { model: 'applied' }), ...(change.effort && { effort: 'applied' }) } } });
  });
  await page.route('**/api/sessions/*/send', async route => { sent.push(route.request().postDataJSON()); await route.fulfill({ json: { delivered: true } }); });
  await page.goto(service.urls.chats);

  // Codex changes its model only in its own picker, which opens in the terminal.
  const codexModel = page.getByRole('button', { name: 'gpt-6 · xhigh' });
  await expect(codexModel).toBeVisible();
  await codexModel.click();
  await expect(page.getByRole('dialog', { name: 'Model and effort' })).toContainText('own picker');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Model and effort' })).toHaveCount(0);

  // A Claude chat: the menu applies a choice directly.
  await page.getByRole('tab', { name: /claude model/i }).click();
  // The terminal takes focus once its screen arrives; open the menu after that.
  await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'), null, { timeout: 5000 }).catch(() => {});
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

  // A refused model keeps the previous choice checked and shows why.
  await menu.getByRole('radio', { name: /Nope 9/ }).click();
  await expect(menu.getByRole('status')).toContainText('Failed to validate model');
  await expect(page.getByRole('button', { name: 'Sonnet · max' })).toBeVisible();
  await expect(menu.getByRole('radio', { name: /Sonnet 5\.5/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('radio', { name: /Nope 9/ })).toHaveAttribute('aria-checked', 'false');

  assert.deepEqual(applied, [{ model: 'claude-sonnet-5-5' }, { effort: 'max' }, { model: 'claude-nope-9' }]);
  assert.deepEqual(sent, [], 'the menu never types a bare /model or /effort into the chat');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sonnet · max' })).toBeFocused();

  const set = value => fetch(service.origin + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  for (const theme of ['antigravity', 'nordic']) {
    await set({ chatTheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', theme);
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 820 });
      await page.getByRole('button', { name: 'Sonnet · max' }).click();
      await expect(menu).toBeVisible();
      await expect.poll(() => page.locator('.chat-status, .model-menu-chip, .model-menu-panel').evaluateAll(nodes => nodes.every(node => {
        const box = node.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
      }))).toBe(true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.waitForTimeout(250); // The menu fades in.
      await page.screenshot({ path: path.join(root, `.cache/model-menu-${theme}-${width}.png`) });
      await page.keyboard.press('Escape');
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['model and effort menu applies directly, keyboard and Escape', 'a refused model keeps the previous choice and shows the reason', 'no /model or /effort typed into the chat', 'codex opens its own picker', 'footer and menu fit at 390/768/1280 px in two themes'], fixture: repo }));
} finally { await browser?.close(); await service?.close(); }
