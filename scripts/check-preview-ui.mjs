// Exercise browser-only preview with the real predev setup, including a failed lazy import.
// No desktop service, CLI sessions, or user profile is opened.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Setup.ps1 -Mode Preview runs npm run dev, which creates this public junction.
// Omitting it hides CSS module failures caused by Vite's public-file middleware.
await import('./ensure-workspace-link.mjs');
const { entities } = JSON.parse(await readFile(path.join(root, 'workspace/workspace.json')));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false, watch: null, hmr: false } });
let browser;
try {
  await server.listen();
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.MRMAK_TEST_BROWSER || 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  let steps = 0;
  for (const entity of entities) {
    await page.locator(`.entity-card[data-entity="${entity.id}"]`).click();
    await page.getByRole('tab', { name: entity.steps[entity.defaultStep ?? entity.steps.length - 1].name, exact: true }).waitFor();
    for (const [index, step] of entity.steps.entries()) {
      await page.locator('.step-tab').nth(index).click();
      if (/\.html$/i.test(step.path)) {
        await page.locator('.report-document[aria-busy=false]').waitFor();
        await page.frameLocator('iframe.report-frame').locator('h1:visible').first().waitFor();
        if (entity.id === 'my-dream-game') {
          for (const id of ['intro', 'character', 'locations', 'development']) {
            const frame = page.frameLocator('iframe.report-frame');
            await frame.locator(`[data-page="${id}"]`).click();
            await frame.locator(`#${id}:visible`).waitFor();
          }
        }
      } else {
        await page.locator('.mak-markdown h1').waitFor();
      }
      steps++;
    }
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.locator('.entity-card').first().waitFor();
  }
  assert.deepEqual(errors, []);

  // Exercise Markdown images as well as links against a root-relative document.
  const mdEntity = entities.find(entity => entity.steps.some(step => /\.md$/i.test(step.path)));
  const mdIndex = mdEntity.steps.findIndex(step => /\.md$/i.test(step.path));
  const mdPath = `/workspace/${mdEntity.folder}/${mdEntity.steps[mdIndex].path}`;
  await page.route(new URL('../reference.png', new URL(mdPath, url)).href, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="pink"/></svg>',
  }));
  await page.route(new URL(mdPath, url).href, route => route.fulfill({
    contentType: 'text/plain',
    body: '# Relative references\n\n[Local file](../notes.md)\n\n[External](https://example.com/)\n\n![Reference](../reference.png)',
  }));
  await page.goto(`${url}#/${mdEntity.id}/${mdIndex}`);
  await page.locator('.mak-markdown h1').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Local file', exact: true }).getAttribute('href'), new URL('../notes.md', new URL(mdPath, url)).href);
  assert.equal(await page.getByRole('link', { name: 'External', exact: true }).getAttribute('href'), 'https://example.com/');
  assert.equal(await page.getByRole('img', { name: 'Reference', exact: true }).getAttribute('src'), new URL('../reference.png', new URL(mdPath, url)).href);
  // The shared stylesheet must still style the app's image dialog after bundling.
  await page.getByRole('img', { name: 'Reference', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Image preview', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(12, 13, 17)');
  assert.equal(await dialog.evaluate(node => getComputedStyle(node).display), 'flex');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);

  // Browser-only Settings use local storage and style embedded reports too.
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  await page.getByLabel('Workspace theme', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-workspace-theme'), 'light');
  assert.equal(await page.locator('.mak-markdown h1').evaluate(node => getComputedStyle(node).color), 'rgb(17, 21, 33)');
  await page.getByRole('img', { name: 'Reference', exact: true }).click();
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(242, 244, 247)');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto(`${url}#/creative-mcp/0`);
  await page.locator('.report-document[aria-busy=false]').waitFor();
  const report = page.frameLocator('iframe.report-frame');
  assert.equal(await report.locator('html').getAttribute('data-mrmak-theme'), 'light');
  assert.equal(await report.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
  await page.reload();
  await page.locator('.report-document[aria-busy=false]').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-workspace-theme'), 'light');
  assert.deepEqual(errors, []);

  // A blocked module used to unmount the entire React tree. Keep navigation,
  // show the actual error, and let a reload recover once the block is gone.
  const failed = await browser.newPage();
  failed.setDefaultTimeout(15000);
  await failed.route('**/src/components/ReportViewer.tsx*', route => route.abort('failed'));
  await failed.goto(url);
  await failed.locator('.entity-card').first().click();
  await failed.getByRole('alert').waitFor();
  assert.equal(await failed.getByRole('button', { name: 'Workspace', exact: true }).count(), 1);
  await failed.getByRole('button', { name: 'Back to Workspace', exact: true }).click();
  await failed.locator('.entity-card').first().waitFor();
  await failed.locator('.entity-card').first().click();
  await failed.getByRole('alert').waitFor();
  await failed.unroute('**/src/components/ReportViewer.tsx*');
  await failed.getByRole('button', { name: 'Reload page', exact: true }).click();
  await failed.locator('.report-document[aria-busy=false]').waitFor();
  assert.equal(await failed.getByRole('alert').count(), 0);
  console.log(`Browser preview passed: ${entities.length} cards, ${steps} steps, game sections and failed-module recovery.`);
} finally {
  await browser?.close();
  await server.close();
}
