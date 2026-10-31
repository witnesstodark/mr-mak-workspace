// Real mobile navigation across registry updates, with isolated pairing/storage.
// No running application, personal chats or Tailscale settings are touched.
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MobileGateway } from '../mobile.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/mobile-report-tabs-'));
await mkdir(path.join(repo, 'workspace/review'), { recursive: true });
await mkdir(path.join(repo, 'state'), { recursive: true });
const steps = [
  ['Painel', 'painel'], ['Roteiro', 'roteiro'], ['Editor', 'editor'], ['Entregas', 'entregas'],
  ['Playtest', 'playtest'], ['Decisões', 'decisoes'], ['Acervo', 'acervo'], ['Arquivo', 'arquivo'],
].map(([name, base]) => ({ name, path: `${base}.html` }));
for (const step of steps) await writeFile(path.join(repo, 'workspace/review', step.path), `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>${step.name}</h1><div style="height:1800px"></div></body></html>`);
const registry = tabs => writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'review', title: 'Tab migration', folder: 'review', category: 'dev', created: '2026-10-21', steps: tabs }] }));
await registry(steps.filter(step => !['Roteiro', 'Editor'].includes(step.name)));
const sessions = Object.assign(new EventEmitter(), { list: () => [] });
const mobile = await new MobileGateway({ repo, stateDir: path.join(repo, 'state'), uiDir: process.argv[2] || path.join(root, 'dist'), sessions, settings: () => ({}), transport: { enable: async origin => ({ origin }), disable: async () => {} }, dictation: { status: async () => ({ available: false }), close() {} }, readAloud: { close() {} } }).init();
let browser;
try {
  await mobile.enable();
  const pairing = await mobile.newPairing(), claim = mobile.claim({ token: new URL(pairing.url).hash.slice(6), name: 'Test phone' });
  await mobile.approve(claim.id);
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addCookies([{ name: 'mrmak_mobile', value: mobile.pending.get(claim.id).credential, url: `${mobile.origin}/mobile/`, httpOnly: true, sameSite: 'Strict' }]);
  await context.addInitScript(() => {
    if (window !== top || sessionStorage.getItem('tabs-test')) return;
    sessionStorage.setItem('tabs-test', '1');
    localStorage.setItem('mrmak.mobile.navigation', JSON.stringify({ view: 'results', history: false }));
    localStorage.setItem('mrmak.mobile.workspace', JSON.stringify({ id: 'review', step: 0 }));
  });
  const phone = await context.newPage(); phone.setDefaultTimeout(10000);
  const checks = [];
  async function open(name) {
    await phone.getByLabel('Select report page', { exact: true }).click();
    await phone.locator('.mobile-page-menu').getByRole('button', { name: new RegExp(`^${name}(?:✓)?$`) }).click();
    await phone.locator('iframe').waitFor();
    await phone.frameLocator('iframe').locator('h1').waitFor();
    const actual = await phone.frameLocator('iframe').locator('h1').innerText();
    // Wait for the current document's ready/restore/capture round trip.
    const route = await phone.frameLocator('iframe').locator('h1').evaluate(() => location.pathname.replace(/^\/mobile\/view\/[^/]+\//, ''));
    await expect.poll(() => phone.evaluate(route => Object.entries(localStorage).some(([key, value]) => key.startsWith('mrmak.mobile.report.review.') && JSON.parse(value).path === route), route)).toBe(true);
    checks.push({ selected: name, actual });
  }
  await phone.goto(`${mobile.origin}/mobile/`);
  for (const name of ['Playtest', 'Acervo', 'Arquivo']) await open(name);
  // First insertion: Archive moves from index 5 to 6; both indices have now been read.
  await registry(steps.filter(step => step.name !== 'Editor'));
  await phone.reload(); await open('Arquivo');
  // Second insertion: indices 5 and 6 now belong to Decisions and Assets.
  await registry(steps); await phone.reload();
  for (const name of ['Decisões', 'Acervo', 'Arquivo', 'Editor', 'Playtest']) await open(name);
  await phone.getByLabel('Select report page', { exact: true }).click();
  const labels = await phone.locator('.mobile-page-menu button span:first-child').allTextContents();
  assert.deepEqual(labels, steps.map(step => step.name));
  await phone.screenshot({ path: path.join(repo, 'menu.png') });
  const result = { labels, checks, failures: checks.filter(check => check.selected !== check.actual) };
  await writeFile(path.join(repo, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence: repo }, null, 2));
  assert.deepEqual(result.failures, [], 'Each tab must show its own document after insertions');
} finally { await browser?.close(); await mobile.close(); }
