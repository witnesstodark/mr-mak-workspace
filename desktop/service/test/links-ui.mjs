// Isolated fake chats and local documents. No production session is touched.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/links-ui-'));
await mkdir(path.join(repo, 'workspace/test'), { recursive: true });
const external = 'https://browser-check.example/page?one=1&two=2#details';
await writeFile(path.join(repo, 'workspace/test/report.html'), `<!doctype html><html><head></head><body><h1>Link report</h1><a href="${external}"><span>External report link</span></a><a href="#section">Local section</a><h2 id="section">Section</h2><a href="${external}" download>Download</a></body></html>`);
await writeFile(path.join(repo, 'workspace/test/notes.md'), `# Link notes\n\n[Markdown web link](${external})\n`);
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'test', folder: 'test', title: 'Links', category: 'dev', created: '2026-09-22', status: 'active', steps: [{ name: 'Report', path: 'report.html' }, { name: 'Notes', path: 'notes.md' }] }] }));
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: path.join(repo, 'fake-home'), env: {} } });
const session = service.sessions.make({ id: 'links', name: 'Link fixture', agent: 'codex', cwd: repo, status: 'running', open: true, cols: 80, rows: 30 });
service.sessions.items.set(session.id, session); await service.sessions.hydrate(session);
session.process = { write() {}, resize() {}, kill() {} };
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 650, height: 740 } });
  await context.route('https://browser-check.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>External destination</h1>' }));
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  async function popup(click, expected) {
    const next = context.waitForEvent('page');
    await click();
    const opened = await next;
    await opened.waitForLoadState('domcontentloaded');
    assert.equal(opened.url(), expected);
    await opened.close();
  }
  await page.goto(service.urls.workspace + '#/test/0');
  const frame = page.frameLocator('iframe.report-frame');
  await popup(() => frame.getByText('External report link').click(), external);
  await frame.getByRole('heading', { name: 'Link report' }).waitFor();
  await frame.getByText('Local section', { exact: true }).click();
  assert.equal(await frame.getByText('Local section', { exact: true }).getAttribute('target'), null);
  assert.equal(await frame.getByText('Download', { exact: true }).getAttribute('target'), null);
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await popup(() => page.getByRole('link', { name: 'Markdown web link' }).click(), external);
  await page.getByRole('heading', { name: 'Link notes' }).waitFor();

  await page.goto(service.urls.chats);
  await page.locator('.xterm-screen').waitFor();
  const wrapped = 'https://browser-check.example/wrapped/' + 'long-path-'.repeat(12) + '?a=1&b=2#section';
  async function terminalLink(output, label, expected) {
    // Include mouse reporting, as used by real agent TUIs.
    const data = '\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h' + output + '\r\n';
    await new Promise(resolve => session.terminal.write(data, resolve));
    session.pendingOutput += data; service.sessions.flushOutput(session);
    const row = page.locator('.xterm-rows > div').filter({ hasText: label }).first();
    await row.waitFor();
    const box = await row.boundingBox();
    await page.mouse.move(box.x + 25, box.y + box.height / 2);
    await page.locator('.xterm-cursor-pointer').waitFor();
    await popup(() => page.mouse.click(box.x + 25, box.y + box.height / 2), expected);
    assert.ok(page.url().includes('chats'), 'Opening a link must leave the terminal in place');
  }
  await terminalLink(external, 'https://browser-check.example/page', external);
  await terminalLink(wrapped, 'https://browser-check.example/wrapped', wrapped);
  await terminalLink(`\x1b]8;;${external}\x07Agent citation\x1b]8;;\x07`, 'Agent citation', external);
  assert.deepEqual(errors, []);
  console.log('Links UI passed: plain and wrapped terminal URLs, OSC 8 citations with mouse tracking, Markdown and HTML popups; local sections and download links preserved.');
} finally {
  await browser?.close(); session.process = null; await service.close();
}
