// Real terminal parser and trusted browser gestures; no system clipboard writes.
import { expect } from '@playwright/test';
import { mkdtemp, mkdir, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/clipboard-ui-'));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });
const session = service.sessions.make({ id: 'clipboard-test', createdAt: new Date().toISOString(), cols: 90, rows: 32, name: 'Clipboard test', agent: 'claude', cwd: repo, open: true, status: 'running' });
session.process = { write() {}, resize() {}, kill() {} };
service.sessions.items.set(session.id, session); await service.sessions.hydrate(session);
await new Promise(resolve => session.terminal.write('Select this terminal text\r\n', resolve));
const output = text => service.sessions.emit('output', { id: session.id, sequence: ++session.sequence, data: '\x1b]52;c;' + Buffer.from(text).toString('base64') + '\x07' });
let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.addInitScript(() => {
    window.copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => window.copied.push(text), write: async items => window.copied.push(await (await items[0].getType('text/plain')).text()) }, configurable: true });
  });
  await page.goto(service.urls.chats);
  const terminal = page.locator('.terminal-host .xterm-screen'); await terminal.waitFor();
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  output('unsolicited'); await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.copied), []);
  await terminal.dblclick({ position: { x: 30, y: 10 } });
  output('selected by the owner');
  await expect.poll(() => page.evaluate(() => window.copied)).toEqual(['selected by the owner']);
  output('second unsolicited write'); await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.copied), ['selected by the owner']);
  await terminal.dblclick({ position: { x: 30, y: 10 } });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  output('background overwrite'); await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.copied), ['selected by the owner']);
  console.log('Clipboard UI passed: live selection copy, unsolicited output rejected, one write per gesture, blur revocation.');
} finally { await browser?.close(); session.process = null; await service.close(); }
