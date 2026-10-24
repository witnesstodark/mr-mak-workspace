// Isolated application state and browser profiles; no real chats or preferences.
import { expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createService } from '../server.mjs';
import { launchBrowser, desktopAuth } from './browser.mjs';
import { themes } from '../appearance.mjs';

async function readable(locator, background, description) {
  const color = await locator.evaluate(node => {
    // Let the browser convert computed colour-mix()/color() values to sRGB.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(node).color; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  });
  const luminance = channels => channels.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const foreground = luminance(color);
  const backdrop = luminance([1, 3, 5].map(i => parseInt(background.slice(i, i + 2), 16)));
  const ratio = (Math.max(foreground, backdrop) + .05) / (Math.min(foreground, backdrop) + .05);
  assert.ok(ratio >= 4.5, `${description}: rendered contrast ${ratio.toFixed(2)}`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/theme-ui-'));
await mkdir(path.join(repo, 'workspace/test'), { recursive: true });
await mkdir(path.join(repo, 'knowledge'), { recursive: true });
await cp(path.join(root, 'public/assets'), path.join(root, 'dist/assets'), { recursive: true });
await writeFile(path.join(repo, 'knowledge/notes.md'), '# Theme notes\n\nReadable **Markdown**.\n');
await writeFile(path.join(repo, 'workspace/test/report.html'), `<!doctype html><html data-mak-report="document"><head><style>body{background:#101115;color:#d3d0d9;min-height:2200px}h1{color:#fff}img{width:60px}</style></head><body><h1>Reading report</h1><p>Dark text on a light background.</p><input aria-label="Keep my draft" value="Original"><img alt="Artwork" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23ee3377'/%3E%3C/svg%3E"><script>window.mountId=crypto.randomUUID()</script></body></html>`);
await writeFile(path.join(repo, 'workspace/test/custom.html'), '<!doctype html><html data-mak-report="document" data-mak-theme="custom"><head><style>body{background:rgb(20,30,40);color:white}</style></head><body><h1>Custom game</h1><canvas style="background:rgb(30,80,40)"></canvas></body></html>');
await writeFile(path.join(repo, 'workspace/test/notes.md'), '# Readable notes\n\nA **strong** paragraph and [a link](https://example.com/).\n\n| Name | State |\n| --- | --- |\n| Theme | Ready |\n');
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'test', folder: 'test', title: 'Theme check', sample: true, category: 'dev', created: '2026-10-02', status: 'active', defaultStep: 0, steps: [{ name: 'Report', path: 'report.html' }, { name: 'Notes', path: 'notes.md' }, { name: 'Custom game', path: 'custom.html' }] }] }));
let service, browser;
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  const session = service.sessions.make({ id: 'theme-chat', name: 'Theme preview', group: 'Theme group', agent: 'codex', cwd: repo, status: 'running', open: true, createdAt: new Date().toISOString(), cols: 90, rows: 30 });
  const writes = [];
  session.process = { write: data => writes.push(data), resize() {}, kill() {} };
  service.sessions.items.set(session.id, session);
  await service.sessions.hydrate(session);
  await new Promise(resolve => session.terminal.write('Theme preview: native terminal stays connected.\r\n\x1b[32m+ added line\x1b[0m\r\n\x1b[31m- removed line\x1b[0m\r\n', resolve));
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1300, height: 920 }, colorScheme: 'dark' });
  await desktopAuth(context, service.urls.workspace);
  const page = await context.newPage(), second = await context.newPage(), chats = await context.newPage();
  await chats.route('**/api/sessions/theme-chat/messages', route => route.fulfill({ json: { supported: true, messages: [
    { id: 'u1', role: 'user', text: 'Give these ideas a clear place to grow.', at: '2026-10-20T12:00:00Z' },
    { id: 'a1', role: 'assistant', text: '## A comfortable place to focus\n\nReadable text, quiet surfaces and a little personality.\n\n- A distinct accent for actions\n- Clear **hierarchy** and balanced contrast\n\n```ts\nconst nextStep = "Make something useful"\n```', at: '2026-10-20T12:00:01Z' },
  ] } }));
  const errors = []; for (const view of [page, second, chats]) { view.setDefaultTimeout(12000); view.on('pageerror', error => errors.push(error.message)); }
  await page.goto(service.urls.workspace + '#/test/0');
  await second.goto(service.urls.workspace);
  await chats.goto(service.urls.chats);
  await page.locator('.report-document[aria-busy=false]').waitFor();
  const report = () => page.frameLocator('iframe.report-frame');
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'dark');
  const mountId = await report().locator('html').evaluate(() => window.mountId);
  await report().getByRole('textbox', { name: 'Keep my draft' }).fill('Keep this edit');
  await report().locator('body').evaluate(() => scrollTo(0, 400));
  await page.getByRole('button', { name: 'Toggle settings', exact: true }).click();
  await page.getByLabel('Workspace theme', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'light');
  await expect(second.locator('html')).toHaveAttribute('data-workspace-theme', 'light');
  await expect(second.locator('.content')).toHaveCSS('background-color', 'rgb(247, 248, 250)');
  await expect(second.locator('.entity-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(chats.locator('html')).toHaveAttribute('data-workspace-theme', 'dark');
  await expect(report().locator('html')).toHaveAttribute('data-mrmak-theme', 'light');
  assert.equal(await report().locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await report().locator('h1').evaluate(node => getComputedStyle(node).color), 'rgb(17, 21, 33)');
  assert.equal(await report().locator('html').evaluate(() => window.mountId), mountId);
  assert.equal(await report().locator('html').evaluate(() => scrollY), 400);
  assert.equal(await report().getByRole('textbox', { name: 'Keep my draft' }).inputValue(), 'Keep this edit');
  assert.equal(await report().getByRole('img', { name: 'Artwork' }).evaluate(node => getComputedStyle(node).filter), 'none');
  // Untrusted siblings and invalid values cannot change the report's theme.
  await report().locator('html').evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin, data: { type: 'mrmak:theme', theme: 'dark' } })));
  await expect(report().locator('html')).toHaveAttribute('data-mrmak-theme', 'light');
  const saved = await (await fetch(service.origin + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceTheme: 'invalid' }) })).json();
  assert.equal(saved.workspaceTheme, 'light');
  // Named palettes apply independently, synchronise with other windows and
  // update the existing report and terminal instead of remounting either.
  const output = path.join(root, '.cache/theme-previews');
  await mkdir(output, { recursive: true });
  await chats.setViewportSize({ width: 620, height: 850 });
  const terminalElement = await chats.locator('.terminal-host .xterm').elementHandle();
  await chats.getByRole('button', { name: 'Chat appearance', exact: true }).click();
  for (const theme of themes) {
    await page.getByLabel('Workspace theme', { exact: true }).selectOption(theme.id);
    await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', theme.id);
    await expect(second.locator('html')).toHaveAttribute('data-workspace-theme', theme.id);
    await expect(report().locator('html')).toHaveAttribute('data-mrmak-theme', theme.id);
    assert.equal(await report().locator('html').evaluate(() => window.mountId), mountId);
    assert.equal(await report().getByRole('textbox', { name: 'Keep my draft' }).inputValue(), 'Keep this edit');
    await chats.getByLabel('Chat theme', { exact: true }).selectOption(theme.id);
    await expect(chats.locator('html')).toHaveAttribute('data-workspace-theme', theme.id);
    assert.equal(await terminalElement.evaluate(node => node.isConnected), true);
    await readable(chats.locator('.chat-group-chip .chip-name'), theme.bg, `${theme.id} group label`);
    await chats.getByRole('tab', { name: /^Theme preview/ }).click({ button: 'right' });
    await expect(chats.locator('.tab-menu')).toHaveCSS('background-color', theme.panel.replace(/#(..)(..)(..)/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`));
    await readable(chats.locator('.tab-menu [role=menuitem]').first(), theme.panel, `${theme.id} tab menu`);
    await chats.keyboard.press('Escape');
    await expect(chats.locator('.tab-menu')).toHaveCount(0);
    await expect(chats.locator('.chats-surface')).toHaveCSS('background-color', theme.bg.replace(/#(..)(..)(..)/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`));
    await second.screenshot({ path: path.join(output, `${theme.id}-workspace.png`) });
    await chats.screenshot({ path: path.join(output, `${theme.id}-terminal.png`) });
  }
  await chats.getByRole('button', { name: 'Chat appearance', exact: true }).click();
  await chats.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(chats.getByRole('heading', { name: 'A comfortable place to focus' })).toBeVisible();
  const draft = chats.locator('.conversation-composer textarea');
  await draft.fill('Keep my chat draft');
  await chats.getByRole('button', { name: 'Chat appearance', exact: true }).click();
  for (const theme of themes) {
    await chats.getByLabel('Chat theme', { exact: true }).selectOption(theme.id);
    await expect(chats.locator('html')).toHaveAttribute('data-workspace-theme', theme.id);
    await expect(draft).toHaveValue('Keep my chat draft');
    await readable(chats.locator('.agent-label'), theme.bg, `${theme.id} provider label`);
    await readable(chats.locator('.conversation-copy-text').last(), theme.bg, `${theme.id} message`);
    await readable(chats.locator('.conversation-send'), theme.accent, `${theme.id} send icon`);
    await chats.getByRole('button', { name: 'Chat appearance', exact: true }).click();
    await chats.screenshot({ path: path.join(output, `${theme.id}-chat.png`) });
    for (const width of [390, 768, 1280]) {
      await chats.setViewportSize({ width, height: 850 });
      assert.equal(await chats.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true, `${theme.id}: fits ${width}px`);
    }
    await chats.setViewportSize({ width: 620, height: 850 });
    await chats.getByRole('button', { name: 'Chat appearance', exact: true }).click();
  }
  assert.deepEqual(writes, [], 'Theme changes must not send input to the CLI');
  await chats.getByLabel('Chat theme', { exact: true }).selectOption('nordic-polar-night');
  await page.getByLabel('Workspace theme', { exact: true }).selectOption('light');
  await expect(chats.locator('html')).toHaveAttribute('data-workspace-theme', 'nordic-polar-night');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.locator('.mak-markdown h1').waitFor();
  assert.equal(await page.locator('.mak-markdown h1').evaluate(node => getComputedStyle(node).color), 'rgb(17, 21, 33)');
  await page.getByRole('button', { name: 'Toggle files', exact: true }).click();
  await page.getByRole('treeitem', { name: /^knowledge$/ }).click();
  await page.getByRole('treeitem', { name: /^notes.md/ }).click();
  await page.getByRole('heading', { name: 'Theme notes', exact: true }).waitFor();
  await page.locator('.file-preview').getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.locator('.markdown-editor').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Close file preview', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle settings', exact: true }).click();
  await page.getByLabel('Workspace theme', { exact: true }).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'dark');
  await page.bringToFront();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'light');
  await page.getByLabel('Workspace theme', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Custom game', exact: true }).click();
  await report().getByRole('heading', { name: 'Custom game' }).waitFor();
  assert.equal(await report().locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(20, 30, 40)');
  assert.equal(await report().locator('canvas').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(30, 80, 40)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'light');
  assert.deepEqual(errors, []);
  await context.close();
  await service.close();
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  const restarted = await browser.newPage();
  await restarted.goto(service.urls.workspace);
  await expect(restarted.locator('html')).toHaveAttribute('data-workspace-theme', 'light');
  const restartedChats = await browser.newPage();
  await restartedChats.goto(service.urls.chats);
  await expect(restartedChats.locator('html')).toHaveAttribute('data-workspace-theme', 'nordic-polar-night');
  console.log(`Theme UI passed: ${themes.length} palettes in Workspace, reports, Terminal and Conversation; independent saved choices; multi-window sync; system mode; preserved drafts, report state, artwork and terminal connection; 390/768/1280px layouts. Previews: .cache/theme-previews.`);
} finally { await browser?.close(); await service?.close(); }
