// The phone's chat details (plan, plan limits, prompt cache, changed files with a
// diff), a marked rule and local file links, with the real service wiring.
// No personal conversations or Tailscale configuration are touched.
// MRMAK_UI_SHOTS saves screenshots.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';
import { planFile } from '../chat-plan.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/mobile-extras-ui-'));
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await mkdir(path.join(repo, 'workspace/report'), { recursive: true });
await writeFile(path.join(repo, 'workspace/report/index.html'), '<!doctype html><h1>Report ready</h1>');
await writeFile(path.join(repo, 'workspace/report/extra.md'), '# Extra notes\n\nRead on the phone.');
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{ id: 'mobile-report', title: 'A useful report', folder: 'report', category: 'dev', created: '2026-10-29', steps: [{ name: 'Report', path: 'index.html' }] }] }));
// The chat's own project, with one committed file changed and one new file.
const project = path.join(repo, 'project');
await mkdir(project);
const git = (...args) => run('git', ['-C', project, ...args]);
await git('init', '-q'); await git('config', 'user.email', 'test@example.com'); await git('config', 'user.name', 'Test');
await writeFile(path.join(project, 'combat.js'), 'const damage = 1;\n');
await git('add', '.'); await git('commit', '-qm', 'start');
await writeFile(path.join(project, 'combat.js'), 'const damage = 2;\nconst armor = 1;\n');
await writeFile(path.join(project, 'notes.txt'), 'new file\n');

const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport }, mcpOptions: { home: repo, env: {} } });
service.sessions.beginDiscovery = () => {};
const id = randomUUID(), writes = [];
const session = service.sessions.make({ id, name: 'Combat review', agent: 'claude', status: 'running', open: true, pinned: false, cols: 100, rows: 28, cwd: project, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
session.process = { write: data => writes.push(data), resize: () => {}, onExit: () => ({ dispose() {} }), kill: () => {} };
service.sessions.items.set(id, session); await service.sessions.hydrate(session);
const typeInput = service.sessions.input.bind(service.sessions);
service.sessions.input = (target, data) => { writes.push(data); return typeInput(target, data); };
await mkdir(path.dirname(planFile(project, id)), { recursive: true });
await writeFile(planFile(project, id), 'Request: Rebalance combat\nStatus: working\n\n- [x] Read the combat code\n- [>] Change the damage\n- [ ] Run the tests\n\nNext: Run the tests\n');
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const reportLink = path.join(repo, 'workspace/report/index.html').replaceAll('\\', '/');
const extraLink = path.join(repo, 'workspace/report/extra.md').replaceAll('\\', '/');
const now = Date.now() / 1000, lastReply = ago(120);
service.mobile.transcripts.read = async () => ({ supported: true, activity: [], messages: [
  { id: 'u1', role: 'user', text: 'Review the combat code', at: ago(130) },
  { id: 'a1', role: 'assistant', text: `Done. See [the report](${reportLink}) and [extra notes](${extraLink}).`, at: lastReply },
], files: [], cache: { at: lastReply, tokens: 152805, model: 'claude-opus-5-5' }, usage: { agent: 'claude', tokens: { input: 0, output: 0, contextPercent: 40 }, rateLimitsList: [{ limitId: 'general', isExclusive: false, primary: { usedPercent: 42, windowMinutes: 300, resetsAt: now + 7200 }, secondary: { usedPercent: 81, windowMinutes: 10080, resetsAt: now + 86400 * 3 } }] } });
service.mobile.transcripts.prompts = async () => ({ supported: true, truncated: false, prompts: [{ id: 'u2', text: 'lembre: rode os testes antes de cada commit', at: new Date().toISOString() }] });

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

  // One line of chips under the chat's tools.
  const strip = phone.getByRole('group', { name: 'Chat details' });
  await expect(strip.getByRole('button', { name: 'Plan', exact: true })).toContainText('1/3');
  await expect(strip.getByRole('button', { name: 'Plan', exact: true })).toContainText('Next: Run the tests');
  await expect(strip.getByRole('button', { name: /Plan usage/ })).toHaveText('5h 42% · Wk 81%');
  await expect(strip.locator('.cache-chip.cold')).toHaveText('Cache cold');
  await expect(strip.getByRole('button', { name: '3 changed files' })).toContainText('+2');
  const box = await strip.boundingBox();
  assert.ok(box.height < 40, 'the details take one short line');
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page-wide horizontal scroll');
  if (shots) await phone.screenshot({ path: path.join(shots, 'mobile-strip.png') });

  await strip.getByRole('button', { name: 'Plan', exact: true }).click();
  const plan = phone.getByRole('dialog', { name: 'Plan' });
  await expect(plan).toContainText('Rebalance combat');
  await expect(plan.locator('.mobile-plan-steps li')).toHaveText(['✓Read the combat code', '›Change the damage', '○Run the tests']);
  if (shots) await phone.screenshot({ path: path.join(shots, 'mobile-plan.png') });
  await plan.getByRole('button', { name: 'Close plan' }).click();

  await strip.getByRole('button', { name: /Plan usage/ }).click();
  const usage = phone.getByRole('dialog', { name: 'Plan usage' });
  await expect(usage).toContainText('81% used');
  await usage.getByRole('button', { name: 'Close plan usage' }).click();

  await strip.getByRole('button', { name: '3 changed files' }).click();
  const changes = phone.getByRole('dialog', { name: 'Changed files' });
  await changes.getByRole('button', { name: /combat\.js/ }).click();
  await expect(phone.locator('.mobile-sheet .diff-line.add')).toHaveText(['+const damage = 2;', '+const armor = 1;']);
  if (shots) await phone.screenshot({ path: path.join(shots, 'mobile-diff.png') });
  await phone.getByRole('button', { name: /Close combat\.js/ }).click();

  // The marked rule; saving it adds it to the project's rules.
  const band = phone.getByRole('region', { name: 'Rule to save' });
  await expect(band).toContainText('rode os testes antes de cada commit');
  await band.getByRole('button', { name: 'Save to project' }).click();
  await expect(band).toHaveCount(0);
  assert.match(await readFile(path.join(project, '.agents/rules.md'), 'utf8'), /^- rode os testes antes de cada commit$/m);

  // A link to a Workspace report page opens that report; another file opens in the viewer.
  await phone.getByRole('link', { name: 'extra notes' }).click();
  const viewer = phone.getByRole('dialog', { name: 'extra.md' });
  await expect(viewer.getByRole('heading', { name: 'Extra notes' })).toBeVisible();
  if (shots) await phone.screenshot({ path: path.join(shots, 'mobile-file.png') });
  await viewer.getByRole('button', { name: 'Close file' }).click();
  await phone.getByRole('link', { name: 'the report' }).click();
  await expect(phone.locator('.mobile-header h1')).toHaveText('A useful report');
  await expect(phone.frameLocator('iframe').getByRole('heading', { name: 'Report ready' })).toBeVisible();

  // The first message to the cold chat is held once with its cost, then goes through.
  await phone.getByRole('button', { name: 'Chats', exact: true }).click();
  const card = phone.getByRole('button', { name: /Combat review/ });
  if (await card.isVisible()) await card.click();
  const input = phone.getByRole('textbox', { name: 'Message this chat' });
  await input.fill('Continue the review');
  await phone.locator('.mobile-send').click();
  await expect(phone.getByRole('status').filter({ hasText: 'prompt cache went cold' })).toBeVisible();
  assert.ok(!writes.some(data => String(data).includes('Continue the review')), 'the held message was not typed');
  await phone.locator('.mobile-send').click();
  await expect.poll(() => writes.some(data => String(data).includes('Continue the review'))).toBe(true);
  assert.deepEqual(errors, []);
  console.log('Mobile extras UI check passed.');
} finally {
  await browser?.close();
  await service.close();
}
