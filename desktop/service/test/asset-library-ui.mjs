// Run after npm run build. A card's asset library in the real Workspace window:
// isolated repository and browser, fake agent chats, no agent login touched.
// The card page loads on its folder's redirected origin; only that frame on that
// origin is answered, the chat comes from the card's project in workspace.json,
// and nothing reaches a chat without the owner's Send.
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { localDay } from '../workspace.mjs';
import { launchBrowser, desktopAuth } from './browser.mjs';
import { build } from '../../../workspace/_shared/asset-library/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache', 'asset-library-ui-'));
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await cp(path.join(root, 'public/assets'), path.join(repo, 'ui/assets'), { recursive: true });
// The shared report files and the generator, as a repository has them.
await cp(path.join(root, 'workspace/_shared'), path.join(repo, 'workspace/_shared'), { recursive: true });
// A 1x1 PNG.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const card = path.join(repo, 'workspace/sample-assets');
await mkdir(path.join(card, 'media'), { recursive: true });
for (const name of ['hero-v02.png', 'hero-v02-back.png', 'hero-v01.png']) await writeFile(path.join(card, 'media', name), png);
await writeFile(path.join(card, 'assets.json'), JSON.stringify({ title: 'Sample Game assets', items: [
  { id: 'hero', name: 'Hero', category: 'characters', family: 'heroes', status: 'review', version: 2, thumbnail: 'media/hero-v02.png', views: [{ label: 'Back', file: 'media/hero-v02-back.png' }], original: 'Art/Hero.psd', prompt: 'A brave hero', generation: { provider: 'fal', job: 'job-42', model: 'flux' }, history: [{ version: 1, thumbnail: 'media/hero-v01.png' }] },
] }));
const built = build(card);
assert.deepEqual(built.errors, []);
await mkdir(path.join(repo, 'workspace/notes'), { recursive: true });
await writeFile(path.join(repo, 'workspace/notes/report.html'), '<!doctype html><html><head></head><body><h1>Notes report</h1></body></html>');
await mkdir(path.join(repo, 'projects/Sample Game'), { recursive: true });
await mkdir(path.join(repo, 'projects/Other Game'), { recursive: true });
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [
  { id: 'sample-assets', title: 'Sample Game', folder: 'sample-assets', project: 'projects/Sample Game', type: 'standalone', category: 'project', status: 'active', created: localDay(), steps: [{ name: 'Assets', path: 'assets.html' }] },
  { id: 'notes', title: 'Notes', folder: 'notes', type: 'standalone', category: 'dev', status: 'active', created: localDay(), steps: [{ name: 'Notes', path: 'report.html' }] },
] }));
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });

// Chats are fake terminals: what they receive is recorded, nothing runs.
const received = new Map();
async function fakeChat(id, name, cwd) {
  const session = service.sessions.make({ id, name, agent: 'claude', cwd, effort: 'high', bypass: false, status: 'running', open: true, pinned: false, createdAt: new Date().toISOString(), cols: 90, rows: 30 });
  service.sessions.items.set(id, session); await service.sessions.hydrate(session);
  const writes = []; received.set(id, writes);
  session.process = { write: data => writes.push(data), resize() {}, kill() {}, onExit: () => ({ dispose() {} }) };
}
const typed = id => (received.get(id) || []).join('');
await fakeChat('game-chat', 'Game chat', path.join(repo, 'projects', 'Sample Game'));
await fakeChat('other-chat', 'Other chat', path.join(repo, 'projects', 'Other Game'));
const authorized = (route, data) => fetch(service.origin + route, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(response => response.json());
// The selected chat works on another project, so it must not be chosen.
await authorized('/api/sessions/other-chat/focus', {});

let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await desktopAuth(context, service.urls.workspace);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${service.urls.workspace}#/sample-assets`);
  const element = page.locator('iframe.report-frame');
  await element.waitFor();
  const uiOrigin = new URL(service.urls.workspace).origin;
  // The frame opens the shared content port, which redirects the page to the card folder's own port.
  assert.equal(new URL(await element.getAttribute('src')).origin, service.contentOrigin);
  const pageUrl = `${service.contentOrigin}/view/${service.files.repoGrant}/workspace/sample-assets/assets.html`;
  const libraryOrigin = (await authorized('/api/content/resolve', { url: pageUrl })).origin;
  assert.notEqual(libraryOrigin, uiOrigin);
  assert.notEqual(libraryOrigin, service.contentOrigin);
  await expect.poll(() => page.frames().some(item => item.url().startsWith(`${libraryOrigin}/`))).toBe(true);
  const view = page.frameLocator('iframe.report-frame');
  await expect(view.getByRole('heading', { name: 'Sample Game assets' })).toBeVisible();
  const frame = () => page.frames().find(item => item.url().startsWith(libraryOrigin) && item.parentFrame() === page.mainFrame());
  await expect.poll(() => !!frame()).toBe(true);

  // A request from a frame: its replies (the "waiting" notice, then the result) within `wait` ms.
  const ask = (target, request, wait = 3000) => target.evaluate(({ request, wait }) => new Promise(resolve => {
    const id = `test-${Math.random().toString(36).slice(2)}`, replies = [];
    const done = () => resolve(replies.length ? replies : null);
    let timer = setTimeout(done, wait);
    window.addEventListener('message', event => {
      if (event.data?.type !== 'mrmak:asset-response' || event.data.id !== id) return;
      replies.push({ ...event.data, origin: event.origin });
      if (!event.data.waiting) { clearTimeout(timer); done(); }
      else { clearTimeout(timer); timer = setTimeout(done, wait); }
    });
    window.parent.postMessage({ type: 'mrmak:asset-request', id, ...request }, '*');
  }), { request, wait });

  // The page's own button: the owner sees the chat of the card's project and the exact text, and Cancel sends nothing.
  await view.locator('#item-hero').getByRole('button', { name: 'Send to chat' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send an asset to a chat' });
  await expect(dialog).toBeVisible();
  await expect(view.locator('#item-hero [data-al-notice]')).toHaveText('Confirm or cancel in Mr. Mak.');
  const message = await dialog.getByLabel('Message to send').textContent();
  assert.match(message, /^Workspace asset from Sample Game: "Hero" \(id hero, v02, characters\/heroes, review\)\./);
  assert.ok(message.includes(`Asset library: ${path.join(repo, 'workspace', 'sample-assets', 'assets.json')}`));
  assert.match(message, /Generation: fal job job-42, model flux\./);
  await expect(dialog.getByText('Game chat', { exact: true })).toBeVisible();
  await expect(dialog.getByText(path.join(repo, 'projects', 'Sample Game'), { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('Other chat')).toHaveCount(0);
  await page.screenshot({ path: path.join(repo, 'confirm-asset.png') });
  // The frame cannot answer the confirmation itself: it is drawn outside it.
  assert.equal(await frame().evaluate(() => document.querySelector('.confirm-send')), null);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(view.locator('#item-hero [data-al-notice]')).toHaveText('Not sent: Cancelled in Mr. Mak; nothing was sent.');
  await expect(dialog).toHaveCount(0);
  assert.equal(typed('game-chat'), '', 'Cancel sends nothing');
  assert.equal(typed('other-chat'), '');

  // A request answered on the redirected origin. The frame names another project; the card's project wins.
  const pendingSend = ask(frame(), { action: 'variation', item: 'hero', project: 'projects/Other Game', repositorio: path.join(repo, 'projects', 'Other Game') }, 20000);
  const variation = page.getByRole('dialog', { name: 'Ask a chat for a variation' });
  await expect(variation).toBeVisible();
  await expect(variation.getByText('Game chat', { exact: true })).toBeVisible();
  const text = await variation.getByLabel('Message to send').textContent();
  assert.match(text, /Generate a new variation of this asset/);
  await variation.getByRole('button', { name: 'Send' }).click();
  const replies = await pendingSend;
  assert.ok(replies, 'the asset request gets replies on its redirected origin');
  assert.deepEqual(replies.map(reply => reply.origin), [uiOrigin, uiOrigin]);
  assert.equal(replies[0].waiting, true);
  assert.equal(replies[1].ok, true, replies[1].error);
  assert.equal(replies[1].text, 'Sent to the chat Game chat.');
  await expect.poll(() => typed('game-chat')).toContain('Generate a new variation of this asset');
  assert.ok(typed('game-chat').includes(text.split('\n')[0]), 'the chat receives the text that was shown');
  assert.equal(typed('other-chat'), '', 'the frame cannot choose the chat');

  // Escape cancels.
  const escaped = ask(frame(), { action: 'send', item: 'hero' }, 20000);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  const cancelled = await escaped;
  assert.equal(cancelled.at(-1).ok, false);
  assert.match(cancelled.at(-1).error, /nothing was sent/);
  assert.ok(!typed('game-chat').includes('Wait for my instructions'), 'a cancelled message never reaches the chat');

  // An item the card's assets.json does not have gets an error, without asking.
  const unknown = await ask(frame(), { action: 'send', item: 'ghost' });
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].error, /no item "ghost"/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A frame inside the card page gets no reply.
  const notes = await authorized('/api/content/resolve', { url: `${service.contentOrigin}/view/${service.files.repoGrant}/workspace/notes/report.html` });
  assert.notEqual(notes.origin, libraryOrigin);
  await frame().evaluate(url => new Promise(resolve => { const inner = document.createElement('iframe'); inner.src = url; inner.onload = resolve; document.body.append(inner); }), frame().url());
  const nested = page.frames().find(item => item.parentFrame() === frame());
  assert.equal(await ask(nested, { action: 'send', item: 'hero' }, 1500), null, 'a frame nested in the card page gets no reply');
  // Another origin in the card's frame gets no reply.
  await frame().goto(notes.url);
  await view.getByRole('heading', { name: 'Notes report' }).waitFor();
  const foreign = page.frames().find(item => item.url().startsWith(notes.origin));
  assert.equal(await ask(foreign, { action: 'send', item: 'hero' }, 2500), null, 'a page of another folder in the card frame gets no reply');
  // The Workspace page itself gets no reply either.
  assert.equal(await page.evaluate(() => new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 1500);
    window.addEventListener('message', event => { if (event.data?.type === 'mrmak:asset-response') { clearTimeout(timer); resolve(event.data) } });
    window.postMessage({ type: 'mrmak:asset-request', id: 'self', action: 'send', item: 'hero' }, '*');
  })), null);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.ok(!typed('game-chat').includes('Wait for my instructions'));

  // Outside the app, the page says where it works.
  const resolved = await authorized('/api/content/resolve', { url: pageUrl });
  const alone = await context.newPage();
  await alone.goto(resolved.url);
  await alone.locator('#item-hero').getByRole('button', { name: 'Send to chat' }).click();
  await expect(alone.locator('#item-hero [data-al-notice]')).toHaveText('Open this card in the Mr. Mak desktop app to send it to a chat.');
  // Filters and comparison work in the page.
  await alone.getByRole('button', { name: /^Discarded/ }).click();
  await expect(alone.locator('[data-al-empty]')).toBeVisible();
  await alone.getByRole('button', { name: /^Any status/ }).click();
  await alone.locator('#item-hero').getByRole('button', { name: 'Compare' }).click();
  await expect(alone.getByRole('group', { name: 'Compare views of Hero' })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(`Asset library UI checks passed. Screenshot: ${path.join(repo, 'confirm-asset.png')}`);
} finally {
  await browser?.close();
  await service.close();
}
