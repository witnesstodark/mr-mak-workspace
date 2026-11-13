// Local file links in a phone chat: a Workspace report page opens as that report,
// another file opens in the file viewer, with the real service wiring.
// No personal conversations or Tailscale configuration are touched.
// MRMAK_UI_SHOTS saves screenshots.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/mobile-links-ui-'));
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await mkdir(path.join(repo, 'workspace/report'), { recursive: true });
await writeFile(path.join(repo, 'workspace/report/index.html'), '<!doctype html><h1>Report ready</h1>');
await writeFile(path.join(repo, 'workspace/report/extra.md'), '# Extra notes\n\nRead on the phone.');
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'mobile-report', title: 'A useful report', folder: 'report', category: 'dev', created: '2026-10-29', steps: [{ name: 'Report', path: 'index.html' }] }] }));
const project = path.join(repo, 'project');
await mkdir(project);

const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport }, mcpOptions: { home: repo, env: {} } });
service.sessions.beginDiscovery = () => {};
const id = randomUUID();
const session = service.sessions.make({ id, name: 'Combat review', agent: 'claude', status: 'running', open: true, pinned: false, cols: 100, rows: 28, cwd: project, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
session.process = { write: () => {}, resize: () => {}, onExit: () => ({ dispose() {} }), kill: () => {} };
service.sessions.items.set(id, session); await service.sessions.hydrate(session);
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const reportLink = path.join(repo, 'workspace/report/index.html').replaceAll('\\', '/');
const extraLink = path.join(repo, 'workspace/report/extra.md').replaceAll('\\', '/');
const lastReply = ago(120);
service.mobile.transcripts.read = async () => ({ supported: true, activity: [], messages: [
  { id: 'u1', role: 'user', text: 'Review the combat code', at: ago(130) },
  { id: 'a1', role: 'assistant', text: `Done. See [the report](${reportLink}) and [extra notes](${extraLink}).`, at: lastReply },
] });

const shots = process.env.MRMAK_UI_SHOTS;
let browser;
const errors = [];
try {
  await service.mobile.enable();
  const pairing = await service.mobile.newPairing();
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const phone = await context.newPage(); phone.setDefaultTimeout(12000); phone.on('pageerror', error => errors.push(error.message));
  const pairResponse = phone.waitForResponse(response => response.url().endsWith('/mobile/api/pair'));
  await phone.goto(pairing.url);
  await phone.getByRole('button', { name: 'Request connection' }).click();
  await service.mobile.approve((await (await pairResponse).json()).id);
  await phone.getByRole('heading', { name: 'Chats', exact: true }).waitFor();
  await phone.getByRole('button', { name: /Combat review/ }).click();

  // A link to a Workspace report page opens that report; another file opens in the viewer.
  await phone.getByRole('link', { name: 'extra notes' }).click();
  const viewer = phone.getByRole('dialog', { name: 'extra.md' });
  await expect(viewer.getByRole('heading', { name: 'Extra notes' })).toBeVisible();
  if (shots) await phone.screenshot({ path: path.join(shots, 'mobile-file.png') });
  await viewer.getByRole('button', { name: 'Close file' }).click();
  await phone.getByRole('link', { name: 'the report' }).click();
  await expect(phone.locator('.mobile-header h1')).toHaveText('A useful report');
  await expect(phone.frameLocator('iframe').getByRole('heading', { name: 'Report ready' })).toBeVisible();

  assert.deepEqual(errors, []);
  console.log('Mobile links UI check passed.');
} finally {
  await browser?.close();
  await service.close();
}
