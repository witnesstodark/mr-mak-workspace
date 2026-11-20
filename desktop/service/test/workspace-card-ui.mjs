// Real built UI and isolated service: cover, phase and progress on the Workspace home card
// (desktop) and on the phone's Workspace list. Never touches the user's Workspace.
// MRMAK_TEST_UI points at another build of the UI (default: dist).
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createService } from '../server.mjs';
import { localDay } from '../workspace.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache', 'workspace-card-ui-'));
const ui = process.env.MRMAK_TEST_UI || path.join(root, 'dist');
await cp(ui, path.join(repo, 'ui'), { recursive: true });
await cp(path.join(root, 'public', 'assets'), path.join(repo, 'ui', 'assets'), { recursive: true });

// A 640x256 gradient with a few bright shapes: busy enough to judge object-fit and contrast.
function picture(width = 640, height = 256) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = bytes => { let c = 0xffffffff; for (const byte of bytes) c = table[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + 1 + x * 3, disc = (x - 470) ** 2 + (y - 90) ** 2 < 2500, band = y > 190 && y < 215;
      raw[at] = disc ? 250 : band ? 240 : 40 + (x * 90) / width; raw[at + 1] = disc ? 200 : band ? 240 : 60 + (y * 80) / height; raw[at + 2] = disc ? 90 : band ? 240 : 120 + (x * 100) / width;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

await mkdir(path.join(repo, 'workspace', 'sample', 'media'), { recursive: true });
await writeFile(path.join(repo, 'workspace', 'sample', 'report.html'), '<h1>Project notes</h1>');
await writeFile(path.join(repo, 'workspace', 'sample', 'media', 'cover.png'), picture());
await writeFile(path.join(repo, 'workspace', 'sample', 'media', 'broken.png'), 'This is not an image.');
const today = localDay();
const card = { id: 'plain', title: 'Plain project', description: 'No cover, phase or progress.', category: 'game', type: 'group', folder: 'sample', status: 'active', created: today, updated: today, steps: [{ name: 'Notes', path: 'report.html' }] };
const entities = [
  { ...card, id: 'full', title: 'Global Empires', description: 'A grand strategy game across five eras.', cover: 'media/cover.png', progress: { done: 3, total: 8, label: 'Marco M1' }, phase: 'Fase 1 · Acervo' },
  { ...card, id: 'pinned', title: 'Pinned and complete', description: 'Amber edge over a cover.', pinned: true, cover: 'media/cover.png', progress: { done: 8, total: 8, label: 'Concluído' }, phase: 'Entrega' },
  { ...card, id: 'icon', title: 'Emblem and cover', description: 'The emblem stays beside the title.', icon: 'media/cover.png', cover: 'media/cover.png', phase: 'Roteiro' },
  { ...card, id: 'long', title: 'A project with a very long name that has to wrap inside the card without breaking it', description: 'Long phase and label.', progress: { done: 1, total: 3, label: 'A caption that is much longer than the card can show on one line' }, phase: 'A phase name that is much longer than the card can show on one line' },
  { ...card, id: 'bad', title: 'Unusable fields', description: 'Missing cover, impossible progress, blank phase.', cover: 'media/missing.png', progress: { done: 9, total: 8, label: 'x' }, phase: '   ' },
  { ...card, id: 'broken', title: 'Undecodable cover', description: 'The file exists but is not an image.', cover: 'media/broken.png', phase: 'Alpha' },
  card,
];
await writeFile(path.join(repo, 'workspace', 'workspace.json'), JSON.stringify({ entities }));
const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport }, mcpOptions: { home: repo, env: {} } });
let browser;
try {
  browser = await launchBrowser();
  const errors = [];

  // ── Desktop home grid ──
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.workspace);
  const wrap = id => page.locator(`.home [data-card="${id}"]`), link = id => wrap(id).locator('a.entity-card');
  await expect(wrap('full')).toBeVisible();
  const cover = wrap('full').locator('.card-cover img');
  await cover.scrollIntoViewIfNeeded();
  await expect.poll(() => cover.evaluate(image => image.complete && image.naturalWidth)).toBe(640);
  assert.equal(await cover.getAttribute('loading'), 'lazy'); assert.equal(await cover.getAttribute('alt'), '');
  assert.equal(await cover.evaluate(image => getComputedStyle(image).objectFit), 'cover');
  // The band is full-bleed inside the card edge, with a fixed height.
  const edge = await link('full').boundingBox(), band = await wrap('full').locator('.card-cover').boundingBox();
  for (const [name, actual, expected] of [['x', band.x, edge.x + 1], ['y', band.y, edge.y + 1], ['width', band.width, edge.width - 2], ['height', band.height, 128]]) assert.ok(Math.abs(actual - expected) < 1.5, `cover ${name}: ${actual} vs ${expected}`);
  await expect(wrap('full').locator('.chip-phase')).toHaveText('Fase 1 · Acervo');
  const bar = wrap('full').getByRole('progressbar');
  await expect(bar).toHaveAttribute('aria-valuenow', '3'); await expect(bar).toHaveAttribute('aria-valuemax', '8');
  await expect(bar).toHaveAttribute('aria-valuetext', '3 of 8 Marco M1');
  await expect(wrap('full').locator('.card-progress-text')).toHaveText('3/8Marco M1');
  assert.ok(Math.abs((await bar.locator('span').boundingBox()).width / (await bar.boundingBox()).width - 0.375) < 0.01, 'The fill is done/total of the track');
  const complete = wrap('pinned').getByRole('progressbar');
  assert.ok(Math.abs((await complete.locator('span').boundingBox()).width - (await complete.boundingBox()).width) < 1, 'A finished milestone fills the track');
  await expect(link('pinned')).toHaveClass(/pinned/);
  // The emblem stays beside the title, under the cover.
  await expect(wrap('icon').locator('.card-project-icon')).toBeVisible(); await expect(wrap('icon').locator('.card-cover')).toBeVisible();
  // The status dot stays readable over the picture and inside the card.
  const dot = wrap('full').getByRole('button', { name: /^Edit Global Empires:/ }), dotBox = await dot.boundingBox();
  assert.ok(dotBox.x + dotBox.width <= edge.x + edge.width && dotBox.y >= edge.y);
  assert.notEqual(await dot.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  // Fields that cannot be drawn leave the plain card, and a cover that fails to load leaves no band.
  await expect(wrap('broken').locator('.card-cover')).toHaveCount(0); await expect(wrap('broken')).not.toHaveClass(/has-cover/);
  await expect(wrap('broken').locator('.chip-phase')).toHaveText('Alpha');
  await expect(wrap('bad').locator('.card-cover')).toHaveCount(0);
  for (const id of ['bad', 'plain']) {
    assert.deepEqual(await link(id).evaluate(element => [...element.children].map(child => child.className)), ['card-top', 'card-project-title', 'card-desc', 'card-foot'], `${id} must keep today's markup`);
    await expect(wrap(id).getByRole('progressbar')).toHaveCount(0);
  }
  // Long text is cut inside the card instead of widening it.
  for (const id of ['full', 'pinned', 'icon', 'long', 'bad', 'broken', 'plain']) assert.ok(await link(id).evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${id} must not overflow`);
  await expect(wrap('long').locator('.chip-phase')).toHaveAttribute('title', /^A phase name/);
  assert.ok(await wrap('long').locator('.chip-phase > span').evaluate(element => element.scrollWidth > element.clientWidth), 'The long phase is cut with an ellipsis');
  // Keyboard: the card is still one tab stop with a visible focus ring, and Enter opens it.
  await page.mouse.move(2, 2);
  for (let press = 0; press < 40 && await page.evaluate(() => document.activeElement?.dataset.entity !== 'full'); press++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.entity), 'full');
  assert.ok(await page.evaluate(() => document.activeElement.matches(':focus-visible')));
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow), 'none');
  await page.keyboard.press('Tab'); await expect(dot).toBeFocused();
  assert.match(await dot.evaluate(element => getComputedStyle(element).outlineStyle), /solid|auto/);
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('full');
  await page.evaluate(() => { history.pushState(null, '', location.pathname + location.search); dispatchEvent(new HashChangeEvent('hashchange')); });
  await expect(wrap('full')).toBeVisible();
  // Theme and width: screenshots, no page-level horizontal scroll.
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.workspaceTheme = theme, theme);
    await page.waitForTimeout(700); // Let the card background transition finish before the screenshots.
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const id of ['full', 'long', 'plain', 'broken']) await wrap(id).scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => [...document.images].filter(image => image.closest('.card-cover')).every(image => image.complete && image.naturalWidth > 0))).toBe(true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}px must not scroll sideways`);
      await page.evaluate(() => document.querySelector('.content, .home')?.scrollTo?.(0, 0));
      await page.screenshot({ path: path.join(repo, `home-${theme}-${width}.png`), fullPage: false });
      await wrap('full').screenshot({ path: path.join(repo, `card-full-${theme}-${width}.png`) });
      await wrap('long').screenshot({ path: path.join(repo, `card-long-${theme}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1100, height: 900 });

  // ── Phone Workspace list ──
  await service.mobile.enable();
  const address = service.mobile.origin, request = async (route, data, cookie) => fetch(`${address}/mobile/api${route}`, { method: 'POST', headers: { Origin: address, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(data) });
  const token = new URL((await service.mobile.newPairing()).url).hash.slice(6);
  const pending = await (await request('/pair', { token, name: 'Test phone' })).json();
  await service.mobile.approve(pending.id);
  const finished = await request('/pair/finish', pending), credential = finished.headers.get('set-cookie').split(';')[0];
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phoneContext.addCookies([{ name: credential.split('=')[0], value: credential.slice(credential.indexOf('=') + 1), url: `${address}/mobile/` }]);
  const phone = await phoneContext.newPage(); phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(`${address}/mobile/`);
  await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await phone.getByRole('heading', { name: 'Workspace', exact: true }).waitFor();
  const row = title => phone.locator('.mobile-result-card', { hasText: title });
  const image = row('Global Empires').locator('.mobile-result-cover');
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth)).toBe(640);
  assert.equal(await image.getAttribute('loading'), 'lazy'); assert.equal(await image.getAttribute('alt'), '');
  const cardBox = await row('Global Empires').boundingBox(), photoBox = await image.boundingBox();
  assert.ok(Math.abs(photoBox.x - (cardBox.x + 1)) < 1.5 && Math.abs(photoBox.width - (cardBox.width - 2)) < 1.5 && Math.abs(photoBox.y - (cardBox.y + 1)) < 1.5, JSON.stringify({ cardBox, photoBox }));
  await expect(row('Global Empires').locator('.mobile-result-phase')).toHaveText('Fase 1 · Acervo');
  await expect(row('Global Empires').locator('.mobile-result-progress-text')).toHaveText('3/8Marco M1');
  const fill = await row('Global Empires').locator('.mobile-result-progress-bar > span').boundingBox(), track = await row('Global Empires').locator('.mobile-result-progress-bar').boundingBox();
  assert.ok(Math.abs(fill.width / track.width - 0.375) < 0.01);
  await expect(row('Undecodable cover').locator('.mobile-result-cover')).toHaveCount(0); await expect(row('Undecodable cover')).not.toHaveClass(/has-cover/);
  await expect(row('Undecodable cover').locator('.mobile-result-phase')).toHaveText('Alpha');
  // Impossible progress and a missing cover never reach the phone.
  for (const title of ['Unusable fields', 'Plain project']) {
    assert.deepEqual(await row(title).evaluate(element => [...element.children].map(child => child.tagName)), ['SPAN', 'svg'], `${title} keeps today's markup`);
    await expect(row(title).locator('.mobile-result-progress, .mobile-result-phase')).toHaveCount(0);
  }
  for (const title of ['Global Empires', 'A project with a very long name', 'Plain project']) await row(title).scrollIntoViewIfNeeded();
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.mobile-result-card')].every(element => element.scrollWidth <= element.clientWidth + 1)), 'The phone list must not scroll sideways');
  await phone.locator('.mobile-results-list').evaluate(element => element.scrollTo(0, 0));
  await phone.screenshot({ path: path.join(repo, 'phone-list.png') });
  await row('A project with a very long name').scrollIntoViewIfNeeded(); await phone.screenshot({ path: path.join(repo, 'phone-list-long.png') });
  // A card with a cover still opens its report.
  await row('Global Empires').click();
  await phone.getByRole('heading', { name: 'Global Empires', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`Workspace card passed: cover, phase and progress on desktop and phone, plain/invalid/failed-cover fallback, keyboard focus, dark/light and 390px layout. Screenshots: ${repo}`);
} finally { await browser?.close(); await service.close(); }
