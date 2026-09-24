// Run after npm run build. Isolated browser, repository and fake PTYs; no agent
// login, live conversation, Windows shortcut or production setting is touched.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/workspace-ui-'));
for (const dir of ['workspace/test', 'knowledge', 'processes', '.claude/skills/example', '.agents/skills/example', 'inbox', 'projects']) await mkdir(path.join(repo, dir), { recursive: true });
await writeFile(path.join(repo, '.claude/skills/example/SKILL.md'), '# Example skill\n\n**Read me**\n');
const documentPath = path.join(repo, 'knowledge/notes.md');
await writeFile(documentPath, '# A useful document\n\n| Name | State |\n| --- | --- |\n| Example | Ready |\n\n**Bold text**\n');
const steps = Array.from({ length: 12 }, (_, index) => ({ name: `Step ${index + 1} - complete English title`, path: `step${index}.html` }));
for (const [index, step] of steps.entries()) await writeFile(path.join(repo, 'workspace/test', step.path), `<h1>Document ${index + 1}</h1><p>Readable content.</p>`);
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'test', folder: 'test', title: 'Workspace test', category: 'test', created: '2026-09-15', status: 'active', steps }] }));
await cp(path.join(root, 'public/assets'), path.join(root, 'dist/assets'), { recursive: true });
const mcpHome = path.join(repo, 'fake-home'); await mkdir(path.join(mcpHome, '.codex'), { recursive: true });
await writeFile(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { 'fixture-tools': { url: 'https://fixture.example/mcp', headers: { Authorization: 'private-ui-fixture-token' } } } }));
await writeFile(path.join(repo, '.claude/settings.local.json'), JSON.stringify({ enableAllProjectMcpServers: true }));
await writeFile(path.join(mcpHome, '.codex/config.toml'), '[mcp_servers."global-tools"]\nurl="https://global.example/mcp"\n');
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: mcpHome, env: {}, probe: async () => ({ status: 'available', toolCount: 7 }) } });
const writes = new Map();
for (const agent of ['codex', 'claude', 'kimi', 'shell']) {
  const session = service.sessions.make({ id: agent, name: `${agent} fixture`, agent, cwd: repo, status: 'running', open: true, pinned: false, createdAt: new Date().toISOString(), cols: 90, rows: 30 });
  service.sessions.items.set(agent, session); await service.sessions.hydrate(session);
  const received = []; writes.set(agent, received);
  session.process = { write: data => received.push(data), resize() {}, kill() {} };
  await new Promise(resolve => session.terminal.write(Array.from({ length: 400 }, (_, i) => `Fixture line ${String(i + 1).padStart(3, '0')} - readable terminal output\r\n`).join('') + '\x1b[?1000h\x1b[?1006h', resolve));
}
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.MRMAK_TEST_BROWSER || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 900, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.workspace + '#/test/0');
  for (let index = 0; index < 12; index++) { await page.getByRole('tab').nth(index).click(); await page.frameLocator('iframe.report-frame').getByRole('heading', { name: `Document ${index + 1}`, exact: true }).waitFor(); }
  let releaseReport;
  const delayedReport = new Promise(resolve => { releaseReport = resolve; });
  await page.route('**/workspace/test/step0.html', async route => { if (route.request().method() === 'GET') await delayedReport; await route.continue(); });
  await page.getByRole('tab').nth(0).click();
  try {
    await page.getByRole('status').filter({ hasText: 'Opening report' }).waitFor();
    assert.equal(await page.locator('iframe.report-frame').evaluate(element => getComputedStyle(element).visibility), 'hidden');
    assert.equal(await page.locator('.report-document').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(16, 17, 21)');
  } finally { releaseReport(); }
  await page.locator('.report-document[aria-busy=false]').waitFor();
  assert.equal(await page.frameLocator('iframe.report-frame').locator('body').evaluate(element => getComputedStyle(element).scrollbarColor), 'rgb(81, 76, 89) rgb(17, 18, 23)');
  await page.unroute('**/workspace/test/step0.html');
  await page.route('**/workspace/test/step1.html', route => route.request().method() === 'HEAD' ? route.fulfill({ status: 404 }) : route.continue());
  await page.getByRole('tab').nth(1).click();
  await page.getByText('Page unavailable (404).', { exact: true }).waitFor();
  await page.unroute('**/workspace/test/step1.html');
  await page.getByRole('tab').nth(2).click();
  await page.locator('.report-document[aria-busy=false]').waitFor();
  await page.getByRole('button', { name: 'Toggle files', exact: true }).click();
  await page.getByRole('treeitem', { name: /^knowledge$/ }).click();
  await page.getByRole('treeitem', { name: /^notes.md/ }).click();
  await page.getByRole('heading', { name: 'A useful document' }).waitFor(); assert.equal(await page.locator('.mak-markdown table').count(), 1);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit notes.md' }).fill('# Edited document\n\nUnicode: русский 🐽\n');
  await page.getByRole('textbox', { name: 'Edit notes.md' }).press('Control+s');
  await page.getByText('Saved', { exact: true }).waitFor(); assert.match(await readFile(documentPath, 'utf8'), /русский 🐽/);
  await writeFile(documentPath, '# Changed by another agent\n');
  await page.getByRole('textbox', { name: 'Edit notes.md' }).fill('# My unsaved draft\n');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText(/This file changed on disk/).waitFor(); assert.match(await readFile(documentPath, 'utf8'), /another agent/);
  await page.getByRole('button', { name: 'Close file preview' }).click();
  await page.getByRole('treeitem', { name: /^notes.md/ }).click();
  await page.getByRole('heading', { name: 'My unsaved draft' }).waitFor();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('heading', { name: 'Changed by another agent' }).waitFor();
  await page.getByRole('button', { name: 'Close file preview' }).click();
  await page.getByRole('button', { name: 'Toggle skills', exact: true }).click();
  await page.getByRole('treeitem', { name: /^example$/ }).click(); await page.getByRole('treeitem', { name: /^SKILL.md/ }).click();
  await page.getByRole('heading', { name: 'Example skill' }).waitFor();
  await page.getByRole('button', { name: 'Toggle mcp', exact: true }).click();
  await page.getByRole('heading', { name: 'fixture-tools', exact: true }).waitFor();
  assert.equal((await page.locator('.mcp-panel').innerText()).includes('private-ui-fixture-token'), false);
  await page.getByRole('button', { name: 'Check fixture-tools for Claude', exact: true }).click();
  await page.locator('[data-mcp-id="claude:fixture-tools"]').getByText('7 tools', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Filter MCP by agent' }).selectOption('codex');
  await page.getByRole('heading', { name: 'global-tools', exact: true }).waitFor();
  assert.equal(await page.locator('.mcp-server').count(), 1);
  await page.getByRole('combobox', { name: 'Filter MCP by scope' }).selectOption('project');
  await page.getByText('No MCP servers match these filters.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close MCP', exact: true }).click();
  await page.goto(service.urls.chats);
  async function setTerminalFontSize(size) {
    await page.getByTitle('Chat options', { exact: true }).click();
    const control = page.locator('.font-control');
    const current = Number(await control.locator('span').last().innerText());
    const button = control.getByRole('button', { name: size > current ? '+' : '−', exact: true });
    for (let count = 0; count < Math.abs(size - current); count++) await button.click();
    await page.getByTitle('Chat options', { exact: true }).click();
  }
  // Check the actual terminal rows, not just the host box: FitAddon can size
  // a grid into parent padding and silently clip the CLI's bottom status row.
  for (const [width, height, fontSize] of [[535, 720, 13], [535, 497, 17], [900, 800, 13], [640, 480, 22]]) {
    await page.setViewportSize({ width, height });
    await setTerminalFontSize(fontSize);
    await page.waitForFunction(size => {
      const rows = document.querySelector('.xterm-rows');
      return rows && getComputedStyle(rows).fontSize === `${size}px`;
    }, fontSize);
    await page.waitForFunction(() => {
      const last = document.querySelector('.xterm-rows > :last-child')?.getBoundingClientRect();
      const host = document.querySelector('.terminal-host')?.getBoundingClientRect();
      const status = document.querySelector('.chat-status')?.getBoundingClientRect();
      return last && host && status && last.bottom <= host.bottom + .5 && last.bottom <= status.top - 4 && last.right <= host.right + .5;
    }, null, { timeout: 3000 });
  }
  await page.setViewportSize({ width: 900, height: 800 });
  await setTerminalFontSize(13);
  for (const agent of ['codex', 'claude', 'kimi', 'shell']) {
    await page.locator(`[data-chat-tab="${agent}"] [role="tab"]`).click();
    const screen = page.locator('.terminal-area .xterm-screen'); await screen.waitFor();
    await page.locator('.xterm-rows').filter({ hasText: 'Fixture line' }).waitFor();
    if (agent !== 'shell') {
      await screen.hover(); const before = await page.locator('.xterm-rows').innerText(); await page.mouse.wheel(0, -420);
      await page.waitForFunction(previous => document.querySelector('.xterm-rows')?.textContent !== previous, before);
      assert.notEqual(await page.locator('.xterm-rows').innerText(), before, 'Agent wheel scroll must move history even with mouse reporting enabled');
      await page.evaluate(() => navigator.clipboard.writeText('clipboard sentinel'));
      await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.press('Control+c');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'clipboard sentinel');
      // Shift overrides terminal mouse tracking so a row can be selected.
      await page.keyboard.down('Shift'); await screen.click({ position: { x: 120, y: 30 }, clickCount: 3 }); await page.keyboard.up('Shift');
      await page.keyboard.press('Control+c');
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Fixture line/);
      assert.ok(writes.get(agent).every(data => !data.includes('\x03')), `${agent}: Ctrl+C must never reach PTY`);
    } else {
      await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.press('Control+c');
      for (let i = 0; i < 20 && !writes.get(agent).includes('\x03'); i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(writes.get(agent).includes('\x03'), 'Shell terminal retains Ctrl+C interrupt');
    }
  }
  assert.deepEqual(errors, []);
  console.log('UI passed: 12 clickable wrapping tabs; Markdown preview/edit/save/conflict/draft; local Skills; MCP filtering, checks and hidden credentials; terminal bottom row visible across four window/font sizes; Codex/Claude/Kimi copy and scroll; shell interrupt.');
} finally {
  await browser?.close();
  for (const session of service.sessions.items.values()) session.process = null;
  await service.close();
}
