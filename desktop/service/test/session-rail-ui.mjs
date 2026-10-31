// Session Rail and /btw side questions in the real desktop UI, with synthetic Claude
// Code transcripts and a scripted terminal. No installed CLI or account is used.
// MRMAK_UI_DIR points at a built UI other than dist; MRMAK_UI_SHOTS saves screenshots.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/session-rail-ui-'));
const config = path.join(repo, 'claude-home');
process.env.CLAUDE_CONFIG_DIR = config;
const { createService } = await import('../server.mjs');
await mkdir(path.join(repo, 'workspace')); await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
const current = 'cccccccc-0000-4000-8000-000000000001', other = 'dddddddd-0000-4000-8000-000000000002';
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify([{ id: 'rail-chat', tabOrder: 0, name: 'Rail review', agent: 'claude', nativeId: current, cwd: repo, open: true, status: 'stopped', pinned: false, hasConversation: true, cols: 100, rows: 32, createdAt: '2026-10-28T08:00:00Z', updatedAt: '2026-10-28T08:00:00Z' }]));
const project = path.join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
await mkdir(project, { recursive: true });
const lines = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const turns = Array.from({ length: 10 }, (_, index) => [
  { type: 'user', uuid: `u${index + 1}`, timestamp: `2026-10-28T08:${String(index * 3).padStart(2, '0')}:00Z`, message: { content: `Step ${index + 1}: review the ${['menus', 'save files', 'audio bank', 'HUD', 'input map', 'shaders', 'AI', 'pathing', 'economy', 'tests'][index]}` } },
  { type: 'assistant', uuid: `a${index + 1}`, timestamp: `2026-10-28T08:${String(index * 3 + 1).padStart(2, '0')}:00Z`, message: { id: `m${index + 1}`, model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, cache_read_input_tokens: 42000, output_tokens: 900 }, content: [{ type: 'text', text: `Reviewed part ${index + 1}.\n\n${'The change keeps the existing behaviour and adds a check. '.repeat(14)}` }] } },
]).flat();
// The plan: two tasks, one in progress, and a scheduled follow-up.
const tool = (id, name, input) => ({ type: 'assistant', uuid: `t-${id}`, timestamp: '2026-10-28T08:31:00Z', message: { id: `tm-${id}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => ({ type: 'user', uuid: `r-${id}`, timestamp: '2026-10-28T08:31:01Z', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const plan = [tool('p1', 'TaskCreate', { subject: 'Review the HUD', activeForm: 'Reviewing the HUD' }), toolResult('p1', 'Task #1 created successfully: Review the HUD'),
  tool('p2', 'TaskCreate', { subject: 'Check the save files' }), toolResult('p2', 'Task #2 created successfully: Check the save files'),
  tool('p3', 'TaskUpdate', { taskId: '1', status: 'in_progress' }), { ...tool('p4', 'ScheduleWakeup', { delaySeconds: 3000, prompt: 'Check the nightly build' }), timestamp: new Date().toISOString() }];
await writeFile(path.join(project, `${current}.jsonl`), lines([...turns, ...plan, { type: 'ai-title', aiTitle: 'Rail review of the game' }]));
await writeFile(path.join(project, `${other}.jsonl`), lines([{ type: 'user', uuid: 'o1', timestamp: '2026-10-27T10:00:00Z', message: { content: 'Plan the menus' } }, { type: 'ai-title', aiTitle: 'Planejamento dos menus' }]));
await utimes(path.join(project, `${other}.jsonl`), new Date('2026-10-27T11:00:00Z'), new Date('2026-10-27T11:00:00Z'));

const shots = process.env.MRMAK_UI_SHOTS;
let service, browser;
const writes = [], errors = [];
// The terminal: Claude Code's prompt, or its /btw panel once a side question is submitted.
let btw = null;
const promptScreen = () => [' ▐▛███▛█   Claude Code v2.1.312', '', '● Reviewed part 10.', '', `${'─'.repeat(100)}`, '❯ ', `${'─'.repeat(100)}`, '  ⏵⏵ auto mode on (shift+tab to cycle)'].join('\n');
const panelScreen = () => [' ▐▛███▛█   Claude Code v2.1.312', '', '● Reviewed part 10.', '', `${'▔'.repeat(80)} ◐ medium · /effort ▔`, '', `    /btw ${btw.question}`, '',
  ...(btw.phase === 'answering' ? ['      ✽ Answering…'] : ['      It returns the parsed config, or null when the file is missing. Callers check the result', '      before use.']),
  '', btw.phase === 'answering' ? '    Esc to close' : '    ↑/↓ to scroll · c to copy · f to fork · Esc to close'].join('\n');
try {
  service = await createService({ repo, uiDir: process.env.MRMAK_UI_DIR || path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => {
    session.status = 'running'; session.restoreError = null; session.startedAt = Date.now();
    const exits = [];
    // Claude Code leaves on Ctrl+C, which is how Mr. Mak closes it.
    session.process = { resize() {}, kill() { session.process = null; }, onExit(callback) { exits.push(callback); return { dispose() {} }; }, write(data) {
      writes.push({ id: session.id, data });
      if (data === '\x03') { session.process = null; for (const exit of exits.splice(0)) exit({ exitCode: 0 }); return; }
      const paste = /\x1b\[200~\/btw ([\s\S]*?)\x1b\[201~/.exec(data);
      if (paste) btw = { question: paste[1], phase: 'typed' };
      if (data === '\r' && btw?.phase === 'typed') { btw.phase = 'answering'; setTimeout(() => { if (btw) btw.phase = 'answered'; }, 1200); }
      if (data === '\x1b') btw = null;
    } };
    service.sessions.changed(session);
  };
  for (const session of service.sessions.items.values()) { await service.sessions.hydrate(session); service.sessions.launch(session); }
  service.sessions.read = async () => ({ screen: btw && btw.phase !== 'typed' ? panelScreen() : promptScreen(), cols: 100 });

  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1150, height: 780 } });
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(page.getByText('Reviewed part 10.')).toBeVisible();

  // The header shows the plan's progress; the rail opens on the plan.
  const planButton = page.getByRole('button', { name: /Toggle plan panel/ });
  await expect(planButton).toContainText('0/2');
  await planButton.click();
  const rail = page.getByRole('complementary', { name: 'Session rail' });
  await expect(rail.getByRole('tab', { name: /Plan/ })).toHaveAttribute('aria-selected', 'true');
  // The rail lists the folder's conversations, this chat first.
  await rail.getByRole('tab', { name: /Sessions/ }).click();
  await expect(rail.locator('.session-rail-item')).toHaveCount(2);
  await expect(rail.locator('.session-rail-item').first()).toContainText('Rail review');
  await expect(rail.locator('.session-rail-item').first()).toContainText('This chat');
  await expect(rail.locator('.session-rail-item').first()).toContainText('43k context');
  await expect(rail.locator('.session-rail-item').nth(1)).toContainText('Planejamento dos menus');
  if (shots) await page.screenshot({ path: path.join(shots, 'rail-sessions.png') });

  // The prompt timeline jumps to a message in Conversation.
  await rail.getByRole('tab', { name: /Prompts/ }).click();
  await expect(rail.locator('.session-rail-prompt')).toHaveCount(10);
  await expect(rail.locator('.session-rail-prompt').first()).toContainText('Step 10');
  const first = page.locator('[data-message-id="u1"]');
  await expect(first).not.toBeInViewport();
  await rail.locator('.session-rail-prompt').last().click();
  await expect(first).toBeInViewport();
  await expect(first).toHaveClass(/conversation-jump-target/);
  if (shots) await page.screenshot({ path: path.join(shots, 'rail-prompts.png') });
  // The plan tab shows the live checklist and the scheduled follow-up.
  await rail.getByRole('tab', { name: /Plan/ }).click();
  await expect(rail.getByRole('tab', { name: /Plan/ })).toContainText('0/2');
  await expect(rail.locator('.session-rail-plan li')).toHaveCount(2);
  await expect(rail.locator('.session-rail-plan li.in_progress')).toContainText('Reviewing the HUD');
  await expect(rail.locator('.session-rail-schedule')).toContainText('Check the nightly build');
  await expect(rail.locator('.session-rail-schedule')).toContainText(/Resumes in [1-9][0-9]* min/);
  if (shots) await page.screenshot({ path: path.join(shots, 'rail-plan.png') });
  // The chat's plan file takes over: request, progress, next step and the owner's attention.
  await mkdir(path.join(repo, '.agents/plans'), { recursive: true });
  await writeFile(path.join(repo, '.agents/plans/rail-chat.md'), ['Request: Review the game before the playtest', 'Status: done', '- [x] Review the HUD', '- [x] Check the save files', '- [x] Run the tests', 'Next: wait for the playtest notes'].join('\n'));
  await expect(rail.locator('.plan-request')).toHaveText('Review the game before the playtest', { timeout: 15000 });
  await expect(rail.locator('.plan-progress-head')).toContainText('3/3');
  await expect(rail.locator('.plan-next')).toContainText('wait for the playtest notes');
  await expect(rail.locator('.plan-attention')).toHaveText('Plan done');
  await expect(planButton).toHaveClass(/attention/);
  if (shots) await page.screenshot({ path: path.join(shots, 'rail-plan-file.png') });
  await rail.getByRole('tab', { name: /Prompts/ }).click();
  // From the terminal, a prompt opens Conversation at that message.
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await rail.locator('.session-rail-prompt').nth(4).click();
  await expect(page.locator('[data-message-id="u6"]')).toBeInViewport();

  // Alt+Enter sends the draft as /btw; its answer sits beside the conversation.
  const input = page.getByRole('combobox', { name: 'Message Claude Code' });
  await input.fill('What does loadConfig return?');
  await input.press('Alt+Enter');
  await expect(input).toHaveValue('');
  await expect.poll(() => writes.some(item => item.data.includes('/btw What does loadConfig return?'))).toBe(true);
  const bubble = page.locator('.side-question').last();
  await expect(bubble).toContainText('What does loadConfig return?');
  await expect(bubble).toContainText('Answering…');
  await expect(bubble.locator('.side-question-answer')).toHaveText('It returns the parsed config, or null when the file is missing. Callers check the result before use.');
  await expect.poll(() => writes.filter(item => item.data === '\x1b').length).toBe(1);
  assert.equal(await page.locator('.conversation-column .side-question').count(), 0, 'the answer is not mixed into the conversation');
  if (shots) await page.screenshot({ path: path.join(shots, 'btw.png') });
  // A typed /btw takes the same path; the button needs text.
  await expect(page.getByRole('button', { name: 'Ask as a /btw side question' })).toBeDisabled();
  await input.fill('/btw And the default path?');
  await input.press('Enter');
  await expect(page.locator('.side-question').last()).toContainText('And the default path?');
  await expect.poll(() => writes.filter(item => item.data === '\x1b').length).toBe(2);

  // Another conversation of the folder resumes in its own tab through History.
  await rail.getByRole('tab', { name: /Sessions/ }).click();
  await rail.locator('.session-rail-item').nth(1).click();
  await expect.poll(() => service.sessions.list().find(item => item.nativeId === other)?.status).toBe('running');
  const opened = service.sessions.list().find(item => item.nativeId === other);
  assert.equal(opened.name, 'Planejamento dos menus');
  assert.equal(opened.open, true);
  // The new tab is selected, and the rail now marks that conversation as this chat.
  await expect(page.locator('.session-rail-entry.current .session-rail-item')).toContainText('Planejamento dos menus');
  await expect(page.locator('.session-rail-entry.current .session-rail-item')).toContainText('This chat');

  // A narrow window lays the rail over the chat.
  await page.setViewportSize({ width: 560, height: 760 });
  await expect(page.locator('.session-rail')).toHaveCSS('position', 'absolute');
  if (shots) await page.screenshot({ path: path.join(shots, 'rail-narrow.png') });
  // Workspace: project rules and the engines in the MCP panel.
  const workspace = await browser.newPage({ viewport: { width: 1150, height: 780 } });
  workspace.setDefaultTimeout(12000); workspace.on('pageerror', error => errors.push(error.message));
  await workspace.goto(service.urls.workspace);
  await workspace.getByRole('button', { name: 'Toggle rules' }).click();
  await expect(workspace.locator('.rules-empty')).toBeVisible();
  await workspace.getByRole('textbox', { name: 'New rule' }).fill('Keep every UI text in English.');
  await workspace.getByRole('button', { name: 'Add rule' }).click();
  await expect(workspace.locator('.rules-list li')).toHaveCount(1);
  assert.match(await readFile(path.join(repo, '.agents/rules.md'), 'utf8'), /^- Keep every UI text in English.$/m);
  await workspace.getByRole('button', { name: /Edit rule/ }).click();
  await workspace.getByRole('textbox', { name: 'Edit rule' }).fill('Keep all UI text in English.');
  await workspace.getByRole('button', { name: 'Save' }).click();
  await expect(workspace.locator('.rules-list li > p')).toHaveText('Keep all UI text in English.');
  if (shots) await workspace.screenshot({ path: path.join(shots, 'rules.png') });
  await workspace.getByRole('button', { name: 'Toggle mcp' }).click();
  await expect(workspace.locator('.mcp-engine')).toHaveCount(4);
  await expect(workspace.locator('.mcp-engine[data-engine="unity"]')).toContainText('No MCP server');
  if (shots) await workspace.screenshot({ path: path.join(shots, 'engines.png') });
  assert.deepEqual(errors, []);
  console.log('Session rail UI check passed.');
} finally {
  await browser?.close();
  await service?.close();
}
