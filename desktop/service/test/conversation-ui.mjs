// Real desktop UI and HTTP routes, with synthetic transcripts and terminals.
// No installed CLI, account or user conversation is started by this check.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/conversation-ui-'));
await mkdir(path.join(repo, 'workspace')); await mkdir(path.join(repo, '.mrmak'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
const ids = ['conversation-a', 'conversation-b', 'conversation-claude'];
await writeFile(path.join(repo, '.mrmak/sessions.json'), JSON.stringify(ids.map((id, tabOrder) => ({ id, tabOrder, name: `Review ${tabOrder + 1}`, agent: id === 'conversation-claude' ? 'claude' : 'codex', group: 'Game', cwd: repo, open: true, status: 'stopped', pinned: false, hasConversation: false, cols: 90, rows: 28, createdAt: '2026-10-18T08:00:00Z', updatedAt: '2026-10-18T08:00:00Z' }))));
let service, browser;
const writes = [], errors = [];
let command = 'echo first', option = 0, showPrompt = false, multiple = null, own = null;
// Claude Code's multiple choice: boxed options, an unnumbered button, then Chat about this.
const multipleScreen = () => ['│ Which fruits do you want?', '', ...['Apple', 'Banana', 'Grape', 'Type something'].map((label, i) => `${multiple.focus === i ? '❯' : ' '} ${i + 1}. [${multiple.checked[i] ? '✔' : ' '}] ${label}`), `${multiple.focus === 4 ? '❯' : ' '}    Next`, '──────────', `${multiple.focus === 5 ? '❯' : ' '} 5. Chat about this`, '', 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'].join('\n');
// Claude Code's single choice with its own-answer option, as Claude Code draws it.
const ownScreen = () => ['│ Which sound should the tree make?', '', ...['Generate in ElevenLabs', 'Keep the placeholder'].map((label, i) => `${own.focus === i ? '❯' : ' '} ${i + 1}. ${label}`), `${own.focus === 2 ? '❯' : ' '} 3. ${own.typed || 'Type something.'}`, '──────────', `${own.focus === 3 ? '❯' : ' '} 4. Chat about this`, '', `Enter to select · ↑/↓ to navigate${own.focus === 2 ? ' · ctrl+g to edit in Notepad' : ''} · Esc to cancel`].join('\n');
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
  service.sessions.launch = session => {
    session.status = 'running'; session.restoreError = null;
    session.process = { resize() {}, write(data) {
      writes.push({ id: session.id, data });
      if (own) {
        if (data === '\x1b[B') own.focus = Math.min(3, own.focus + 1);
        else if (data === '\x1b[A') own.focus = Math.max(0, own.focus - 1);
        else if (data === '\r' || data === '\x1b') showPrompt = false;
        else if (own.focus === 2) own.typed += data;
        return;
      }
      if (multiple) {
        if (data === '\x1b[B') multiple.focus = Math.min(5, multiple.focus + 1);
        if (data === '\x1b[A') multiple.focus = Math.max(0, multiple.focus - 1);
        if (data === ' ' && multiple.focus < 4) multiple.checked[multiple.focus] = !multiple.checked[multiple.focus];
        if ((data === '\r' && multiple.focus === 4) || data === '\x1b') showPrompt = false;
        return;
      }
      if (data === '\x1b[B') option++;
      if (data === '\x1b[A') option--;
      if (data === '\r' || data === '\x1b') showPrompt = false;
    }, kill() { session.process = null; } };
    service.sessions.changed(session);
  };
  for (const session of service.sessions.items.values()) {
    await service.sessions.hydrate(session); service.sessions.launch(session);
  }
  service.mobile.transcripts.read = async session => ({ supported: true, messages: [
    { id: 'user-1', role: 'user', text: `Review ${session.id}`, at: '2026-10-18T08:00:00Z' },
    { id: 'reply-1', role: 'assistant', text: '## Review ready\n\n**Verified** the character.\n\n[OpenAI](https://openai.com/)\n\n- Preserve the source\n- Review the result', at: '2026-10-18T08:00:10Z' },
  ], activity: [] });
  const originalRead = service.sessions.read.bind(service.sessions);
  service.sessions.read = async (id, lines) => showPrompt && own ? { screen: ownScreen() } : showPrompt && multiple ? { screen: multipleScreen() } : showPrompt ? { screen: ['Allow command?', `$ ${command}`, '', ...['Yes, proceed', 'Yes, always', 'No'].map((label, i) => `${i === option ? '>' : ' '} ${i + 1}. ${label}`), 'Press enter to confirm'].join('\n') } : originalRead(id, lines);
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.urls.chats);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review ready' })).toBeVisible();
  await expect(page.locator('.conversation-copy-text strong')).toHaveText('Verified');
  await expect(page.getByRole('link', { name: 'OpenAI', exact: true })).toHaveAttribute('target', '_blank');
  const input = page.getByRole('combobox', { name: 'Message Codex' });
  // Keep rendered history stable while typing and while an unchanged transcript
  // is polled. Recreating the link used to reparse the entire Markdown history.
  await page.getByRole('link', { name: 'OpenAI', exact: true }).evaluate(node => { window.historyLink = node; });
  await input.fill('Keep my draft');
  await expect.poll(() => input.inputValue()).toBe('Keep my draft');
  assert.ok(await page.getByRole('link', { name: 'OpenAI', exact: true }).evaluate(node => node === window.historyLink), 'typing must preserve the rendered history');
  await page.waitForResponse(response => /\/api\/sessions\/[^/]+\/messages$/.test(new URL(response.url()).pathname));
  await page.waitForTimeout(100);
  assert.ok(await page.getByRole('link', { name: 'OpenAI', exact: true }).evaluate(node => node === window.historyLink), 'an unchanged transcript poll must preserve rendered history');
  const historyRoute = '**/api/sessions/*/messages';
  await page.route(historyRoute, async route => {
    const response = await route.fetch(), value = await response.json();
    value.messages = value.messages.map(message => ({ ...message, text: message.text.replace('**Verified**', '**Updated**') }));
    await route.fulfill({ response, json: value });
  });
  await expect(page.locator('.conversation-copy-text strong')).toHaveText('Updated');
  await expect(input).toHaveValue('Keep my draft');
  await page.unroute(historyRoute);
  await expect(page.locator('.conversation-copy-text strong')).toHaveText('Verified');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(input).toHaveValue('Keep my draft');
  await page.locator(`[data-chat-tab="${ids[1]}"] [role=tab]`).click();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(input).toHaveValue('');
  await page.locator(`[data-chat-tab="${ids[0]}"] [role=tab]`).click();
  await expect(input).toHaveValue('Keep my draft');
  await input.fill('One line'); await input.press('End'); await input.press('Shift+Enter'); await input.pressSequentially('Second line');
  await expect(input).toHaveValue('One line\nSecond line');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(input).toHaveValue('');
  assert.ok(writes.some(item => item.data.includes('One line\nSecond line')));
  await expect.poll(() => writes.some(item => item.data === '\r')).toBe(true);

  // Keep an old rendered button while the CLI advances to a different command.
  showPrompt = true;
  await expect(page.locator('.conversation-prompt pre')).toHaveText('$ echo first');
  const messagesRoute = '**/api/sessions/*/messages';
  await page.route(messagesRoute, route => route.abort());
  const before = writes.length; command = 'echo second';
  await page.getByRole('button', { name: '1 Yes, proceed', exact: true }).click();
  await expect(page.locator('.desktop-error')).toContainText('prompt changed');
  assert.equal(writes.length, before, 'a stale approval sends no terminal keys');
  await page.unroute(messagesRoute);
  await expect(page.locator('.conversation-prompt pre')).toHaveText('$ echo second');
  await page.getByRole('button', { name: '3 No', exact: true }).click();
  await expect(page.locator('.conversation-prompt')).toHaveCount(0);
  assert.deepEqual(writes.slice(before).map(item => item.data), ['\x1b[B', '\x1b[B', '\r']);

  // Boxes change only in the page until the button sends the final choice.
  multiple = { focus: 0, checked: [false, true, false, false] }; showPrompt = true;
  await expect(page.getByRole('checkbox', { name: /Banana/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: /Type something/ })).toBeDisabled();
  const ticked = writes.length;
  await page.getByRole('checkbox', { name: /Apple/ }).click();
  await page.getByRole('checkbox', { name: /Banana/ }).click();
  await expect(page.getByRole('checkbox', { name: /Banana/ })).toHaveAttribute('aria-checked', 'false');
  assert.equal(writes.length, ticked, 'checking boxes in the page sends no keys');
  await page.getByRole('button', { name: 'Next · 1', exact: true }).click();
  await expect(page.locator('.conversation-prompt')).toHaveCount(0);
  assert.deepEqual(writes.slice(ticked).map(item => item.data), [' ', '\x1b[B', ' ', '\x1b[B', '\x1b[B', '\x1b[B', '\r']);
  assert.deepEqual(multiple.checked, [true, false, false, false]);
  multiple = null;

  // The own-answer option opens a field; the typed answer goes in its place, then Enter.
  own = { focus: 0, typed: '' }; showPrompt = true;
  const owned = writes.length;
  await page.getByRole('button', { name: '3 Type something.', exact: true }).click();
  assert.equal(writes.length, owned, 'opening the field sends no keys');
  await page.getByRole('textbox', { name: 'Your answer' }).fill('A creak, then the thud');
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(page.locator('.conversation-prompt')).toHaveCount(0);
  assert.deepEqual(writes.slice(owned).map(item => item.data), ['\x1b[B', '\x1b[B', 'A creak, then the thud', '\r']);
  own = null;

  // /model has its own menu in the footer, so it stays in Conversation.
  await input.fill('/model');
  await expect(page.getByRole('listbox', { name: 'Commands' })).toBeVisible();
  await input.press('Enter');
  await expect(page.locator('.desk-conversation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  assert.ok(writes.some(item => item.data.includes('/model')));
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(input).toHaveValue('');
  const submissions = [];
  page.on('request', request => { if (/\/api\/sessions\/[^/]+\/(send|rewind)$/.test(new URL(request.url()).pathname)) submissions.push(request.url()); });
  async function confirmComposition(editor, text) {
    await editor.fill(text);
    const before = submissions.length;
    await editor.dispatchEvent('compositionstart', { data: '' });
    await editor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true });
    // macOS WebKit can end composition before its confirming Enter keydown.
    await editor.dispatchEvent('compositionend', { data: text });
    await editor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: false });
    await editor.dispatchEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: false });
    // Give an accidental async send/rewind time to reach the HTTP service.
    await page.waitForTimeout(200);
    await expect(editor).toHaveValue(text);
    assert.equal(submissions.length, before, 'confirming IME composition must not send or rewind');
  }
  for (const [id, label] of [[ids[0], 'Codex'], [ids[2], 'Claude Code']]) {
    await page.locator(`[data-chat-tab="${id}"] [role=tab]`).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    const composer = page.getByRole('combobox', { name: `Message ${label}` });
    const text = `日本語の変換確定 ${label}`;
    await confirmComposition(composer, text);
    const before = writes.length;
    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    assert.ok(writes.slice(before).some(item => item.id === id && item.data.includes(text)), 'a subsequent ordinary Enter sends the text');
  }
  let rewinds = 0;
  await page.route('**/api/sessions/*/rewind', async route => { rewinds++; await route.fulfill({ json: {} }); });
  await page.getByRole('button', { name: 'Edit message', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
  await confirmComposition(editor, '日本語の編集を確定');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  assert.equal(rewinds, 1, 'an ordinary Enter rewinds once and sends the edit');
  assert.ok(writes.some(item => item.id === ids[2] && item.data.includes('日本語の編集を確定')));
  await page.locator(`[data-chat-tab="${ids[0]}"] [role=tab]`).click();
  await confirmComposition(input, '/mo');
  await input.fill('');
  for (const width of [500, 900]) {
    await page.setViewportSize({ width, height: 760 });
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    assert.equal(await page.locator('.desk-conversation').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(repo, 'conversation.png') });
  console.log(JSON.stringify({ ok: true, fixture: repo, checks: ['stable Markdown while typing and polling', 'changed Markdown refreshes without losing the draft', 'Markdown and links', 'independent drafts', 'Terminal toggle', 'soft line breaks and sending', 'stale prompt rejected without input', 'permission navigation and confirmation', 'multiple choice boxes and submit','command autocomplete and terminal handoff', '500/900px layout'] }));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(repo, 'failure.png') }).catch(() => {});
    await writeFile(path.join(repo, 'failure.txt'), await page.locator('body').innerText()).catch(() => {});
    console.error(JSON.stringify({ fixture: repo, writes }));
  }
  throw error;
} finally {
  await browser?.close();
  for (const session of service?.sessions.items.values() || []) session.process = null;
  await service?.close();
}
