// Headless live-reader checks with a fake builder and isolated source/state.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-live-ui-'));
const project = path.join(repo, 'source'), stateDir = path.join(repo, '.mrmak');
await mkdir(path.join(repo, 'workspace/card'), { recursive: true }); await mkdir(project); await mkdir(stateDir);
await writeFile(path.join(repo, 'workspace/card/guide.md'), '# How it works\n\nA read-only live reader.');
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'live', title: 'Live Codex', folder: 'card', category: 'project', status: 'active', pinned: true, created: '2026-10-10', steps: [{ name: 'Codex', path: 'index.html', source: 'live' }, { name: 'How it works', path: 'guide.md' }] }] }));
await writeFile(path.join(stateDir, 'live-sources.json'), JSON.stringify([{ id: 'live', label: 'Live Codex', project, python: process.execPath, args: ['builder.mjs'] }]));
const input = path.join(project, 'input.md'); await writeFile(input, 'first');
await writeFile(path.join(project, 'builder.mjs'), `
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
if (process.argv.includes('--list-inputs')) console.log(JSON.stringify({ dirs: [], files: [path.resolve('input.md')] }));
else {
  const text = await readFile('input.md', 'utf8');
  if (text === 'first') while (!(await readFile('release', 'utf8').catch(() => false))) await new Promise(resolve => setTimeout(resolve, 50));
  await new Promise(resolve => setTimeout(resolve, 1400));
  if (text === 'broken') { process.stderr.write('Validation failed\\nDocs/Broken.md:42: missing link target\\n'); process.exitCode = 1; }
  else {
    const out = process.argv[process.argv.indexOf('--out') + 1];
    const html = '<!doctype html><html><head><title>Fake Codex</title></head><body style="margin:0;min-height:5000px"><h1>' + text + '</h1><p id="route"></p><script>document.getElementById("route").textContent=location.hash;window.scrollTo(0,0);</script></body></html>';
    await writeFile(path.join(out, 'index.tmp'), html); await rename(path.join(out, 'index.tmp'), path.join(out, 'index.html'));
  }
}
`);
const service = await createService({ repo, uiDir: path.join(root, 'dist'), stateDir, restoreSessions: false });
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.workspace + '#/live/0');
  await page.getByText('Building the Codex...', { exact: true }).waitFor();
  assert.equal(await page.locator('iframe.report-frame').count(), 0);
  await writeFile(path.join(project, 'release'), 'ready');
  const report = page.frameLocator('iframe.report-frame');
  await report.getByRole('heading', { name: 'first' }).waitFor();
  const iframe = page.locator('iframe.report-frame');
  await iframe.evaluate(element => { element.dataset.testIdentity = 'same-frame'; });
  const src = await iframe.getAttribute('src');
  const frame = page.frames().find(item => item.url().includes('/view/'));
  await frame.evaluate(() => { location.hash = '#doc~~same-page'; scrollTo(0, 1234); });
  await frame.evaluate(() => parent.postMessage({ type: 'mrmak:reload' }, '*')); // report cannot command parent reload
  await frame.evaluate(() => window.postMessage({ type: 'mrmak:reload' }, location.origin)); // wrong origin/source
  await writeFile(input, 'second');
  await page.getByText('Updating the Codex…', { exact: true }).waitFor();
  await report.getByRole('heading', { name: 'second' }).waitFor();
  await page.waitForFunction(() => document.querySelector('iframe')?.dataset.testIdentity === 'same-frame');
  assert.equal(await iframe.getAttribute('src'), src);
  await frame.waitForFunction(() => location.hash === '#doc~~same-page' && Math.abs(scrollY - 1234) < 3);
  await writeFile(input, 'broken');
  await page.getByRole('alert').filter({ hasText: 'Latest rebuild failed: Docs/Broken.md:42: missing link target' }).waitFor();
  await report.getByRole('heading', { name: 'second' }).waitFor();
  assert.equal(await iframe.getAttribute('src'), src);
  await page.getByText('Full error', { exact: true }).click();
  await page.getByText('Validation failed', { exact: false }).waitFor();
  for (const theme of ['dark', 'light']) {
    await fetch(service.origin + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceTheme: theme }) });
    await page.waitForFunction(theme => document.documentElement.dataset.workspaceTheme === theme, theme);
    for (const width of [1400, 460]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await iframe.evaluate(element => element.getBoundingClientRect().width > 100), true);
      assert.equal(await page.locator('.live-source-status').evaluate(element => getComputedStyle(element).color !== getComputedStyle(element).backgroundColor), true);
    }
  }
  await writeFile(input, 'repaired'); await report.getByRole('heading', { name: 'repaired' }).waitFor();
  assert.equal(await page.locator('.live-source-status.failed').count(), 0);
  await page.getByRole('tab', { name: 'How it works' }).click(); await page.getByRole('heading', { name: 'How it works' }).waitFor();
  assert.match(await readFile(input, 'utf8'), /repaired/); assert.deepEqual(errors, []);
  console.log('Live UI passed: first-build status; same iframe/src; hash and window scroll restored; failed rebuild retains page and exposes full error; recovery; wide/narrow dark/light status; guide tab.');
} finally { await browser?.close(); await service.close(); await rm(repo, { recursive: true, force: true }); }
