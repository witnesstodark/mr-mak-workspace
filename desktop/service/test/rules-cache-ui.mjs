// Rules marked in a chat ("lembre:", "remember:"), global rules, and the cold
// cache guard in the real desktop UI, with a synthetic Claude Code transcript.
// MRMAK_UI_DIR points at a built UI other than dist; MRMAK_UI_SHOTS saves screenshots.
import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/rules-cache-ui-'));
const config = path.join(repo, 'claude-home');
process.env.CLAUDE_CONFIG_DIR = config;
const { createService } = await import('../server.mjs');
// The built UI leaves out the brand assets the installer copies (desktop/prepare.mjs).
const uiDir = process.env.MRMAK_UI_DIR || path.join(root, 'dist');
await cp(path.join(root, 'public/assets'), path.join(uiDir, 'assets'), { recursive: true });
await mkdir(path.join(repo, 'workspace')); await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
const nativeId = 'ffffffff-0000-4000-8000-000000000004';
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify([{ id: 'rules-chat', tabOrder: 0, name: 'Rules check', agent: 'claude', nativeId, cwd: repo, open: true, status: 'stopped', pinned: false, hasConversation: true, cols: 100, rows: 32, createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T08:00:00Z' }]));
const project = path.join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
await mkdir(project, { recursive: true });
const transcript = path.join(project, `${nativeId}.jsonl`);
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const line = record => JSON.stringify(record) + '\n';
// A long conversation whose last reply was two hours ago, then a marked rule.
await writeFile(transcript, line({ type: 'user', uuid: 'u1', timestamp: ago(130), message: { content: 'Review the combat code' } })
  + line({ type: 'assistant', uuid: 'a1', timestamp: ago(120), message: { id: 'm1', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 5, cache_read_input_tokens: 150000, cache_creation_input_tokens: 2000, output_tokens: 800 }, content: [{ type: 'text', text: 'Reviewed the combat code.' }] } })
  + line({ type: 'user', uuid: 'u2', timestamp: ago(1), message: { content: 'lembre: rode os testes antes de cada commit' } }));

const shots = process.env.MRMAK_UI_SHOTS;
let service, browser;
const writes = [], errors = [];
try {
  service = await createService({ repo, uiDir, mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => {
    session.status = 'running'; session.startedAt = Date.now();
    session.process = { resize() {}, kill() { session.process = null; }, onExit() { return { dispose() {} }; }, write(data) { writes.push(data); } };
    service.sessions.changed(session);
  };
  service.sessions.read = async () => ({ screen: ['● Reviewed the combat code.', '', '─'.repeat(100), '❯ ', '─'.repeat(100)].join('\n'), cols: 100 });
  for (const session of service.sessions.items.values()) { await service.sessions.hydrate(session); service.sessions.launch(session); }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1150, height: 780 } });
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();

  // The marked rule waits in a band; saving it adds it to the project's rules.
  const band = page.getByRole('region', { name: 'Rules to save' });
  await expect(band).toContainText('rode os testes antes de cada commit');
  if (shots) await page.screenshot({ path: path.join(shots, 'rule-band.png') });
  await band.getByRole('button', { name: 'Save to project' }).click();
  await expect(band).toHaveCount(0);
  assert.match(await readFile(path.join(repo, '.agents/rules.md'), 'utf8'), /^- rode os testes antes de cada commit$/m);
  // An edited rule saved for every chat.
  await appendFile(transcript, line({ type: 'user', uuid: 'u3', timestamp: new Date().toISOString(), message: { content: 'remember: answer in short paragraphs' } }));
  await expect(band).toContainText('answer in short paragraphs', { timeout: 15000 });
  await band.getByRole('button', { name: 'Edit' }).click();
  await band.getByRole('textbox', { name: 'Edit the rule' }).fill('Answer in short paragraphs.');
  await band.getByRole('button', { name: 'Save as global' }).click();
  await expect(band).toHaveCount(0);
  assert.match(await readFile(path.join(repo, '.agents/global-rules.md'), 'utf8'), /^# Global rules[\s\S]*^- Answer in short paragraphs\.$/m);

  // The footer shows the cold cache; the first message is held once with its cost.
  await expect(page.locator('.cache-chip.cold')).toHaveText('Cache cold');
  const input = page.getByRole('combobox', { name: 'Message Claude Code' });
  await input.fill('Continue with the combat review');
  await input.press('Enter');
  // The held message waits in the chat with three ways on: send, compact first or summarize.
  const offer = page.locator('.conversation-cold');
  await expect(offer).toContainText(/prompt cache went cold/);
  await expect(offer).toContainText(/152,805 tokens, about \$1\.22/);
  await expect(offer.getByRole('button', { name: 'Compact first' })).toBeVisible();
  await expect(offer.getByRole('button', { name: 'Summarize and continue' })).toBeVisible();
  await expect(page.locator('.conversation-message.user.pending')).toContainText('Continue with the combat review');
  await expect(input).toHaveValue('');
  assert.ok(!writes.some(data => data.includes('Continue with the combat review')), 'the held message was not typed into the chat');
  if (shots) await page.screenshot({ path: path.join(shots, 'cold-guard.png') });
  await offer.getByRole('button', { name: 'Send anyway' }).click();
  await expect.poll(() => writes.some(data => data.includes('Continue with the combat review'))).toBe(true);
  await expect(offer).toHaveCount(0);

  // The cache chip opens the Session Rail's Cache view with this chat's figures.
  const chip = page.locator('button.cache-chip');
  await expect(chip).toHaveAttribute('title', /99% of input read from the cache over 1 replies\. No full rewrites\./);
  await chip.click();
  const rail = page.getByRole('complementary', { name: 'Session rail' });
  await expect(rail.getByRole('tab', { name: 'Cache' })).toHaveAttribute('aria-selected', 'true');
  await expect(rail.locator('.cache-panel-now')).toContainText('Cold');
  await expect(rail.locator('.cache-panel-figures')).toContainText('Read from cache');
  await expect(rail.locator('.cache-panel-figures')).toContainText('99% · 150k');
  await expect(rail).toContainText('None yet.');
  if (shots) await page.screenshot({ path: path.join(shots, 'cache-rail.png') });

  // Pause with a summary: an icon beside the composer's dictation button. The handoff
  // is written now and nothing opens; on return the chat offers both ways on.
  await appendFile(transcript, line({ type: 'assistant', uuid: 'a2', timestamp: new Date().toISOString(), message: { id: 'm2', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 5, cache_read_input_tokens: 1000, output_tokens: 20 }, content: [{ type: 'text', text: 'Continued the combat review.' }] } }));
  await expect(page.getByText('Continued the combat review.')).toBeVisible({ timeout: 15000 });
  const pause = page.locator('.conversation-actions .terminal-dictation + button');
  await expect(pause).toHaveAttribute('aria-label', 'Pause with a summary');
  await expect(page.locator('.conversation-read-aloud').getByRole('button', { name: 'Pause with a summary' })).toHaveCount(0);
  await expect(pause).toHaveText('');
  await pause.click();
  await expect.poll(() => writes.some(data => data.includes('the owner is pausing'))).toBe(true);
  await expect(page.locator('.handoff-offer')).toContainText('writing a handoff for your break');
  if (shots) await page.screenshot({ path: path.join(shots, 'pause-bubble.png') });
  await appendFile(transcript, line({ type: 'user', uuid: 'u4', timestamp: new Date().toISOString(), message: { content: 'Mr. Mak handoff request: the owner is pausing.' } })
    + line({ type: 'assistant', uuid: 'a3', timestamp: new Date().toISOString(), message: { id: 'm3', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 5, cache_read_input_tokens: 1000, output_tokens: 20 }, content: [{ type: 'text', text: '# Handoff\n## Next\nFinish the combat review' }] } }));
  const chat = service.sessions.get('rules-chat'); chat.completionVersion = (chat.completionVersion || 0) + 1; service.sessions.changed(chat);
  const paused = page.locator('.handoff-offer');
  await expect(paused).toContainText(/Paused at .* with a handoff/);
  assert.match(await readFile(service.handoffs.state('rules-chat').file, 'utf8'), /Finish the combat review/);
  if (shots) await page.screenshot({ path: path.join(shots, 'pause-return.png') });
  await paused.getByRole('button', { name: 'Keep this chat' }).click();
  await expect(page.getByText(/Paused at .* with a handoff/)).toHaveCount(0);

  // The Rules panel shows the global rules.
  const workspace = await browser.newPage({ viewport: { width: 1150, height: 780 } });
  workspace.on('pageerror', error => errors.push(error.message));
  await workspace.goto(service.urls.workspace);
  await workspace.getByRole('button', { name: 'Toggle rules' }).click();
  await workspace.getByRole('combobox', { name: 'Project for these rules' }).selectOption('global');
  await expect(workspace.locator('.rules-list li > p')).toHaveText(['Answer in short paragraphs.']);
  await expect(workspace.getByRole('button', { name: 'Find skill ideas' })).toHaveCount(0);
  await workspace.getByRole('combobox', { name: 'Project for these rules' }).selectOption({ index: 1 });
  await expect(workspace.getByRole('button', { name: 'Find skill ideas' })).toBeVisible();
  if (shots) await workspace.screenshot({ path: path.join(shots, 'rules-global.png') });
  assert.deepEqual(errors, []);
  console.log('Rules and cache UI check passed.');
} finally {
  await browser?.close();
  await service?.close();
}
