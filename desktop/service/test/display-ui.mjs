// Rename chats (desktop tab and phone), terminal colours and the phone's app name,
// in the built UI with stub terminals. No CLI, account, personal chat or Tailscale.
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/display-ui-'));
const shots = process.env.IAAR_SCREENSHOTS || repo;
await mkdir(path.join(repo, 'workspace'), { recursive: true }); await mkdir(shots, { recursive: true });
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
for (const name of ['mak-nose.svg', 'mak-nose-chats.svg', 'mak-mobile-192.png', 'mak-mobile-512.png']) await copyFile(path.join(root, 'public/assets', name), path.join(repo, 'ui/assets', name));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
const dictation = { status: async () => ({ available: false, provider: null, maxSeconds: 0, maxBytes: 0 }), close() {}, revoke() {} };
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport, dictation }, mcpOptions: { home: repo, env: {} } });
service.sessions.beginDiscovery = () => {};
const ids = [randomUUID(), randomUUID()], writes = [];
const screen = ['\x1b[2J\x1b[H', '\x1b[1m ✻ Claude Code\x1b[0m', '', '❯ Make the release banner warmer', '', '● I will update the banner colours.', '', '\x1b[90m  ⎿  Read src/styles/banner.css (42 lines)\x1b[0m', '', '● The warm banner is ready.', '  Needs your decision: keep the cold one for dark mode?', '',
  '\x1b[32m+ .banner { background: var(--warm); }\x1b[0m', '\x1b[31m- .banner { background: var(--cold); }\x1b[0m', '', '\x1b[33m  Do you want to make this edit to banner.css?\x1b[0m', '\x1b[36m  ❯ 1. Yes\x1b[0m', '    2. No, and tell Claude what to do differently', ''].join('\r\n');
for (const [index, id] of ids.entries()) {
  const session = service.sessions.make({ id, name: index ? 'Research notes' : 'Conversation 5', agent: index ? 'codex' : 'claude', status: 'running', open: true, cols: 96, rows: 24, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cwd: repo });
  session.process = { write: data => writes.push(data), resize() {} };
  service.sessions.items.set(id, session); await service.sessions.hydrate(session);
  await new Promise(resolve => session.terminal.write(screen, resolve));
}
service.mobile.transcripts.read = async () => ({ supported: true, activity: [], messages: [{ id: 'm1', role: 'user', text: 'Make the release banner warmer', at: new Date().toISOString() }] });
const settings = () => fetch(`${service.origin}/api/bootstrap`, { headers: { Authorization: `Bearer ${service.token}` } }).then(response => response.json()).then(value => value.settings);
const desktopApi = data => fetch(`${service.origin}/api/settings`, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const until = async (label, check, timeout = 6000) => { const end = Date.now() + timeout; for (;;) { if (await check()) return; if (Date.now() > end) throw new Error(`Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 40)); } };

let browser;
const files = [], errors = [];
try {
  browser = await launchBrowser();
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: 'dark' });
  const chats = await desktopContext.newPage(), workspace = await desktopContext.newPage();
  for (const page of [chats, workspace]) { page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); }
  const shoot = async (page, name, options = {}) => { const file = path.join(shots, name); await page.screenshot({ path: file, ...options }); files.push(file); };
  await chats.goto(service.urls.chats);

  // 1b. Desktop: double-click a tab to rename it in place.
  const tab = chats.locator(`[data-chat-tab="${ids[0]}"]`);
  await tab.getByRole('tab').dblclick();
  const field = tab.getByRole('textbox', { name: 'English chat name' });
  await expect(field).toHaveValue('Conversation 5');
  await field.fill('Draft name'); await field.press('Escape');
  await expect(tab.getByRole('tab')).toContainText('Conversation 5');
  assert.equal(service.sessions.get(ids[0]).name, 'Conversation 5', 'Escape cancels');
  await tab.getByRole('tab').dblclick(); await field.fill('Banner design'); await field.press('Enter');
  await until('Enter saves', () => service.sessions.get(ids[0]).name === 'Banner design');
  await tab.getByRole('tab').dblclick(); await field.fill('Banner colours');
  await chats.locator('.chat-context').click({ position: { x: 5, y: 5 } });
  await until('blur saves', () => service.sessions.get(ids[0]).name === 'Banner colours');
  await tab.getByRole('tab').dblclick(); await field.fill('Баннер'); await field.press('Enter');
  await chats.getByRole('alert').getByText('Use an English chat name.', { exact: false }).waitFor();
  assert.equal(service.sessions.get(ids[0]).name, 'Banner colours');
  await chats.getByRole('button', { name: 'Dismiss error' }).click();
  // Dragging still reorders tabs.
  const first = await tab.boundingBox(), second = await chats.locator(`[data-chat-tab="${ids[1]}"]`).boundingBox();
  await chats.mouse.move(first.x + 30, first.y + first.height / 2); await chats.mouse.down();
  await chats.mouse.move(second.x + second.width - 8, second.y + second.height / 2, { steps: 8 }); await chats.mouse.up();
  await until('drag reorders', () => service.sessions.active()[0].id === ids[1]);
  await chats.locator(`[data-chat-tab="${ids[0]}"]`).getByRole('tab').click();

  // 2. Settings → Change terminal colors (dark Workspace).
  await workspace.goto(service.urls.workspace);
  await workspace.getByRole('button', { name: 'Toggle settings', exact: true }).click();
  await workspace.getByRole('button', { name: /Change terminal colors/ }).click();
  const dialog = workspace.getByRole('dialog', { name: 'Terminal colors' });
  const hexField = label => dialog.getByRole('textbox', { name: `${label} hex`, exact: true });
  for (const [label, value] of [['Background', '#1d1a2e'], ['Text', '#f2e9dc'], ['Cursor', '#ffb86c'], ['Selection', '#6b5b95'], ['You', '#8fd0ff'], ['Attention', '#ffb454']]) { await hexField(label).fill(value); await hexField(label).blur(); }
  await hexField('Text').fill('#zz'); await expect(hexField('Text')).toHaveAttribute('aria-invalid', 'true'); await hexField('Text').blur();
  await until('colours saved', async () => (await settings()).terminalColors?.attention === '#ffb454');
  assert.deepEqual((await settings()).terminalColors, { background: '#1d1a2e', foreground: '#f2e9dc', cursor: '#ffb86c', selection: '#6b5b95', user: '#8fd0ff', attention: '#ffb454' });
  await expect(dialog.getByText('6 custom colours')).toBeVisible();
  await shoot(workspace, 'colors-dialog-dark.png');
  // Every open desktop terminal follows at once, without a restart.
  await expect(chats.locator('.terminal-host')).toHaveCSS('background-color', 'rgb(29, 26, 46)');
  // xterm paints its own theme background inside the host.
  await expect.poll(() => chats.locator('.terminal-host').evaluate(host => [...host.querySelectorAll('*')].some(node => getComputedStyle(node).backgroundColor === 'rgb(29, 26, 46)'))).toBe(true);
  await shoot(chats, 'terminal-custom-colors.png');
  await desktopApi({ terminalAppearance: 'focus' });
  await expect(chats.locator('.terminal-host')).toHaveCSS('background-color', 'rgb(29, 26, 46)');
  await chats.waitForTimeout(600); // Focus colours lines shortly after a change.
  await shoot(chats, 'terminal-custom-colors-focus.png');
  await desktopApi({ terminalAppearance: 'original' });

  // Light Workspace: the full ANSI list and a low-contrast warning.
  await desktopApi({ workspaceTheme: 'light' });
  await expect(workspace.locator('html')).toHaveAttribute('data-workspace-theme', 'light');
  await dialog.locator('summary', { hasText: 'All CLI colours' }).click();
  await hexField('Bright magenta').fill('#ff79c6'); await hexField('Bright magenta').blur();
  await hexField('Text').fill('#3a3448'); await hexField('Text').blur();
  await expect(dialog.getByRole('status')).toContainText('contrast of');
  await dialog.getByRole('textbox', { name: 'Black hex', exact: true }).scrollIntoViewIfNeeded();
  await dialog.locator('.terminal-colors-body').evaluate(node => { node.scrollTop = 0; });
  await shoot(workspace, 'colors-dialog-light.png');
  await dialog.getByRole('button', { name: 'Reset Text', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Reset Bright magenta', exact: true }).click();
  await until('resets saved', async () => { const colors = (await settings()).terminalColors; return !colors.foreground && !colors.brightMagenta; });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await desktopApi({ workspaceTheme: 'dark', terminalColors: { background: '#1d1a2e', foreground: '#f2e9dc', cursor: '#ffb86c', selection: '#6b5b95', user: '#8fd0ff', attention: '#ffb454' } });

  // 3. Phone settings: the name under the phone's Home Screen icon.
  await chats.getByRole('button', { name: 'Mobile access', exact: true }).click();
  const phoneDialog = chats.getByRole('dialog', { name: 'Mobile access' });
  const name = phoneDialog.getByRole('textbox', { name: 'Name on your phone' });
  await expect(name).toHaveValue('Iaar');
  await name.fill('A name that is far too long for it'); assert.equal((await name.inputValue()).length, 30, 'The field stops at 30 characters');
  await name.fill('Mobz'); await name.press('Enter');
  await phoneDialog.getByText('Saved. New Home Screen icons use this name.').waitFor();
  assert.equal((await settings()).phoneName, 'Mobz');
  await name.scrollIntoViewIfNeeded();
  await shoot(chats, 'phone-name-setting.png');
  await chats.keyboard.press('Escape');

  // The manifest a phone reads when it is added to the Home Screen.
  await service.mobile.enable();
  const manifestPage = await desktopContext.newPage();
  await manifestPage.setViewportSize({ width: 820, height: 420 });
  const manifestResponse = await manifestPage.goto(`${service.mobile.origin}/mobile/manifest.webmanifest`);
  assert.equal(manifestResponse.headers()['cache-control'], 'no-store');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.short_name, 'Mobz'); assert.equal(manifest.name, 'Mobz · Iaar');
  await manifestPage.setContent(`<body style="margin:0;background:#0d0e12;color:#e8e4ed;font:14px/1.5 ui-monospace,Consolas,monospace;padding:20px"><div style="color:#9c97a7;margin-bottom:10px">GET ${service.mobile.origin}/mobile/manifest.webmanifest · Cache-Control: ${manifestResponse.headers()['cache-control']}</div><pre style="white-space:pre-wrap;margin:0">${JSON.stringify(manifest, null, 2).replace(/</g, '&lt;')}</pre></body>`);
  await shoot(manifestPage, 'manifest-output.png', { fullPage: true });
  await writeFile(path.join(shots, 'manifest-output.json'), JSON.stringify(manifest, null, 2));

  // 1a and phone parts at 390 px.
  const api = async (route, data) => {
    const response = await fetch(`${service.mobile.origin}/mobile/api${route}`, { method: 'POST', headers: { Origin: service.mobile.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  const qr = await service.mobile.newPairing(), claim = (await api('/pair', { token: new URL(qr.url).hash.slice(6), name: 'Test phone' })).data;
  await service.mobile.approve(claim.id);
  const credential = (await api('/pair/finish', claim)).cookie.split('=')[1];
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phoneContext.addCookies([{ name: 'iaar_mobile', value: credential, domain: '127.0.0.1', path: '/mobile/', httpOnly: true, sameSite: 'Strict' }]);
  const phone = await phoneContext.newPage(); phone.setDefaultTimeout(12000); phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(`${service.mobile.origin}/mobile/`);
  await phone.getByRole('button', { name: /Banner colours/ }).click();
  await expect(phone).toHaveTitle('Mobz');
  assert.equal(await phone.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content'), 'Mobz');
  await phone.getByTitle('Rename chat').click();
  const rename = phone.getByRole('form', { name: 'Rename chat' });
  const chatName = rename.getByRole('textbox', { name: 'Chat name · English' });
  await expect(chatName).toHaveValue('Banner colours');
  await chatName.fill('Баннер'); await rename.getByRole('button', { name: 'Save name' }).click();
  await rename.getByRole('alert').getByText('Use an English chat name. Messages can be in any language.').waitFor();
  await shoot(phone, 'phone-rename-error-390.png');
  await chatName.fill('Release banner'); await rename.getByRole('button', { name: 'Save name' }).click();
  await rename.waitFor({ state: 'detached' });
  await phone.getByRole('heading', { name: 'Release banner', exact: true }).waitFor();
  await expect(chats.locator(`[data-chat-tab="${ids[0]}"]`)).toContainText('Release banner');
  await phone.getByTitle('Rename chat').click();
  await shoot(phone, 'phone-rename-390.png');
  await phone.getByRole('button', { name: 'Close rename' }).click();
  // The phone's Terminal view uses the desktop's colours, and follows changes live.
  await phone.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(phone.locator('.mobile-terminal')).toHaveCSS('background-color', 'rgb(29, 26, 46)');
  await phone.locator('.xterm-rows').getByText('Do you want to make this edit', { exact: false }).waitFor();
  await shoot(phone, 'phone-terminal-colors-390.png');
  await desktopApi({ terminalColors: { background: '#0f1f1a' } });
  await expect(phone.locator('.mobile-terminal')).toHaveCSS('background-color', 'rgb(15, 31, 26)');
  await desktopApi({ phoneName: 'Studio' });
  await expect(phone).toHaveTitle('Studio');
  assert.deepEqual(writes, [], 'Nothing was typed into a terminal');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, screenshots: files }, null, 2));
} finally {
  await browser?.close();
  for (const item of service.sessions.items.values()) item.process = null;
  await service.close();
}
