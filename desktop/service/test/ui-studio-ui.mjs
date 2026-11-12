// Run after npm run build. The Game UI Studio in the real Workspace window:
// isolated repository and browser, a fake agent chat, no agent login touched.
// The studio frame loads on its own redirected origin; only that frame on that
// origin is answered, and nothing reaches a chat without the owner's Send.
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { localDay } from '../workspace.mjs';
import { launchBrowser, desktopAuth } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache', 'ui-studio-ui-'));
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await cp(path.join(root, 'public/assets'), path.join(repo, 'ui/assets'), { recursive: true });
// A repository with none of the author's folders: one report and one game project.
await mkdir(path.join(repo, 'workspace/notes'), { recursive: true });
await mkdir(path.join(repo, 'projects/Sample Game'), { recursive: true });
await writeFile(path.join(repo, 'workspace/notes/report.html'), '<!doctype html><html><head></head><body><h1>Notes report</h1></body></html>');
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'notes', title: 'Notes', folder: 'notes', type: 'standalone', category: 'dev', status: 'active', created: localDay(), steps: [{ name: 'Notes', path: 'report.html' }] }] }));
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });

// Studio chats are fake terminals: what they receive is recorded, nothing runs.
const started = [], received = new Map();
service.sessions.create = async options => {
  started.push(options);
  const id = `studio-chat-${started.length}`;
  const session = service.sessions.make({ id, name: options.name, agent: options.agent, cwd: options.cwd, effort: options.effort, bypass: options.bypass === true, status: 'running', open: true, pinned: false, createdAt: new Date().toISOString(), cols: 90, rows: 30 });
  service.sessions.items.set(id, session); await service.sessions.hydrate(session);
  const writes = []; received.set(id, writes);
  const exits = new Set();
  session.process = { write: data => writes.push(data), resize() {}, kill() { exits.forEach(exit => exit()); }, onExit: exit => { exits.add(exit); return { dispose: () => exits.delete(exit) }; } };
  return service.sessions.list().find(item => item.id === id);
};
const typed = id => (received.get(id) || []).join('');

let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await desktopAuth(context, service.urls.workspace);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Claude counts as installed here, whatever this computer has.
  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch(), value = await response.json();
    value.agents = value.agents.map(agent => agent.id === 'claude' ? { ...agent, available: true } : agent);
    await route.fulfill({ response, json: value });
  });
  await page.goto(service.urls.workspace);
  // Opened with the Topbar button, or already open at #/ui-studio after a reload.
  const studioFrame = async (click = true) => {
    if (click) await page.getByRole('button', { name: 'UI Studio', exact: true }).click();
    await expect(page.locator('.crumb-current', { hasText: 'Game UI Studio' })).toBeVisible();
    const element = page.locator('iframe[title="Game UI Studio"]');
    await element.waitFor();
    const origin = new URL(await element.getAttribute('src')).origin;
    await expect.poll(() => page.frames().some(frame => frame.url().startsWith(origin))).toBe(true);
    return { origin, frame: page.frames().find(frame => frame.url().startsWith(origin)) };
  };
  let { origin: studioOrigin, frame: studio } = await studioFrame();
  // The frame loads the studio's own port, not the shared content port it would be redirected from.
  assert.notEqual(studioOrigin, new URL(service.urls.workspace).origin);
  assert.notEqual(studioOrigin, service.contentOrigin);
  // The bundled editor reached Mr. Mak: its project picker lists this repository's projects.
  const editor = page.frameLocator('iframe[title="Game UI Studio"]');
  await expect(editor.locator('#project-select option', { hasText: 'Sample Game' })).toHaveCount(1);
  await expect(editor.locator('#project-select option')).toHaveCount(2); // Standalone and Sample Game: no built-in projects
  await expect(editor.locator('#chat-project-badge')).toHaveText('Standalone');

  // A request from a frame, answered (or not) within `wait` ms.
  const ask = (frame, action, payload = {}, wait = 3000) => frame.evaluate(({ action, payload, wait }) => new Promise(resolve => {
    const id = `test-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => resolve(null), wait);
    window.addEventListener('message', event => {
      if (event.data?.type === 'mrmak:studio-response' && event.data.id === id) { clearTimeout(timer); resolve({ ...event.data, origin: event.origin }); }
    });
    window.parent.postMessage({ type: 'mrmak:studio-request', id, action, payload }, '*');
  }), { action, payload, wait });

  // The hello of the studio frame is answered from the Workspace window.
  const hello = await ask(studio, 'hello');
  assert.ok(hello?.ok, 'the studio hello gets a reply on its redirected origin');
  assert.equal(hello.origin, new URL(service.urls.workspace).origin);
  assert.ok(hello.value.agents.some(agent => agent.id === 'claude'));

  // The studio's draft is kept by Mr. Mak in the repository and restored after a reload.
  const draft = await studio.evaluate(async () => JSON.stringify((await import('./model.mjs')).createDefaultDocument('Persisted Game', '')));
  const stored = await ask(studio, 'save-state', { draft: { doc: draft, at: Date.now() + 60000 }, projects: { roots: ['projects'], hidden: [] } });
  assert.equal(stored?.ok, true, stored?.error);
  assert.equal(JSON.parse(JSON.parse(await readFile(path.join(repo, '.mrmak/ui-studio/state.json'), 'utf8')).draft.doc).projectName, 'Persisted Game');
  await page.reload();
  ({ origin: studioOrigin, frame: studio } = await studioFrame(false));
  await expect(editor.locator('#chat-project-badge')).toHaveText('Persisted Game');

  // Sending to a chat needs the owner's Send in the Workspace window; Cancel sends nothing.
  const message = 'Add a Back button to the pause menu';
  const cancelled = ask(studio, 'start', { agent: 'claude', cwd: 'projects/Sample Game', effort: 'high', name: 'UI Studio Sample Game', text: message }, 20000);
  const dialog = page.getByRole('dialog', { name: 'Start a studio chat' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Message to send')).toHaveText(message);
  await expect(dialog.getByText('UI Studio Sample Game')).toBeVisible();
  await expect(dialog.getByText(path.join(repo, 'projects', 'Sample Game'))).toBeVisible();
  await page.screenshot({ path: path.join(repo, 'confirm-start.png') });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const refused = await cancelled;
  assert.equal(refused?.ok, false);
  assert.match(refused.error, /nothing was sent/);
  await expect(dialog).toHaveCount(0);
  assert.deepEqual(started, [], 'Cancel starts no chat');

  // The frame cannot answer the confirmation itself: Send is outside it.
  const approved = ask(studio, 'start', { agent: 'claude', cwd: 'projects/Sample Game', effort: 'high', name: 'UI Studio Sample Game', text: message }, 40000);
  await expect(dialog).toBeVisible();
  assert.equal(await studio.evaluate(() => document.querySelector('[role="dialog"][aria-labelledby="studio-confirm-title"]')), null);
  await dialog.getByRole('button', { name: 'Send' }).click();
  const chat = await approved;
  assert.equal(chat?.ok, true, chat?.error);
  assert.equal(chat.value.sent, true);
  assert.equal(started.length, 1);
  assert.equal(started[0].bypass, false);
  assert.equal(started[0].background, true);
  await expect.poll(() => typed(chat.value.id)).toContain(message);

  // A later message to the same chat asks again; Escape cancels it.
  const second = ask(studio, 'send', { id: chat.value.id, text: 'Now remove the HUD' }, 20000);
  const sendDialog = page.getByRole('dialog', { name: 'Send to the studio chat' });
  await expect(sendDialog.getByLabel('Message to send')).toHaveText('Now remove the HUD');
  await page.keyboard.press('Escape');
  assert.equal((await second)?.ok, false);
  assert.ok(!typed(chat.value.id).includes('Now remove the HUD'), 'a cancelled message never reaches the chat');

  // Reads go through without asking.
  const listed = await ask(studio, 'list', { path: 'projects' });
  assert.deepEqual(listed.value.entries.map(entry => entry.name), ['Sample Game']);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A frame on another origin gets no reply, even in the studio's place.
  const report = (await (await fetch(service.origin + '/api/content/resolve', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: `${service.contentOrigin}/view/${service.files.repoGrant}/workspace/notes/report.html` }) })).json());
  assert.notEqual(report.origin, studioOrigin);
  await studio.goto(report.url);
  await page.frameLocator('iframe[title="Game UI Studio"]').getByRole('heading', { name: 'Notes report' }).waitFor();
  const foreign = page.frames().find(frame => frame.url().startsWith(report.origin));
  assert.equal(await ask(foreign, 'hello', {}, 2500), null, 'a report in the studio frame gets no reply');
  assert.equal(await ask(foreign, 'list', { path: 'projects' }, 1500), null);
  // A frame inside the report, and the Workspace page itself, get no reply either.
  await foreign.evaluate(url => new Promise(resolve => { const inner = document.createElement('iframe'); inner.src = url; inner.onload = resolve; document.body.append(inner); }), report.url);
  const nested = page.frames().find(frame => frame.parentFrame() === foreign);
  assert.equal(await ask(nested, 'hello', {}, 1500), null, 'a frame nested in the studio frame gets no reply');
  assert.equal(await page.evaluate(() => new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 1500);
    window.addEventListener('message', event => { if (event.data?.type === 'mrmak:studio-response') { clearTimeout(timer); resolve(event.data) } });
    window.postMessage({ type: 'mrmak:studio-request', id: 'self', action: 'hello', payload: {} }, '*');
  })), null);

  // An ordinary report in the Workspace is not the studio and gets no reply.
  await page.evaluate(() => { location.hash = '#/notes'; });
  await page.frameLocator('iframe.report-frame').getByRole('heading', { name: 'Notes report' }).waitFor();
  const reportFrame = page.frames().find(frame => frame !== page.mainFrame() && frame.url().includes('/workspace/notes/report.html'));
  assert.equal(await ask(reportFrame, 'hello', {}, 1500), null, 'a Workspace report gets no studio reply');
  assert.deepEqual(errors, []);
  console.log(`UI Studio UI checks passed. Screenshot: ${path.join(repo, 'confirm-start.png')}`);
} finally {
  await browser?.close();
  await service.close();
}
