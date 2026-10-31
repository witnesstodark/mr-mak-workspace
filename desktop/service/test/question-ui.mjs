// A phone answers Claude's question dialog: a stub Claude chat, the real hook
// script and the built mobile UI at 390 and 768 px. No CLI, account, personal
// conversation, paid request or Tailscale configuration is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createService } from '../server.mjs';
import { HOOK_SCRIPT } from '../claude-questions.mjs';
import { transcriptMessages } from '../mobile-transcript.mjs';
import { launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/question-ui-'));
await mkdir(path.join(repo, 'workspace'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
for (const name of ['mak-nose.svg', 'mak-nose-chats.svg', 'mak-mobile-192.png', 'mak-mobile-512.png']) await copyFile(path.join(root, 'public/assets', name), path.join(repo, 'ui/assets', name));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
const dictation = { status: async () => ({ available: false, provider: null, maxSeconds: 0, maxBytes: 0 }), close() {}, revoke() {} };
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport, dictation }, mcpOptions: { home: repo, env: {} } });
service.sessions.beginDiscovery = () => {};

const id = randomUUID(), writes = [];
const session = service.sessions.make({ id, name: 'Banner design', agent: 'claude', status: 'running', open: true, cols: 100, rows: 28, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cwd: repo, nativeId: randomUUID() });
session.process = { write: data => writes.push(data), resize() {} };
service.sessions.items.set(id, session); await service.sessions.hydrate(session);
const at = second => new Date(Date.now() - (60 - second) * 1000).toISOString();
const QUESTIONS = [
  { question: 'Which colour should the banner use?', header: 'Colour', multiSelect: false, options: [{ label: 'Warm red (Recommended)', description: 'Matches the logo and reads well on both themes.' }, { label: 'Calm blue', description: 'Quieter, but close to the link colour.' }] },
  { question: 'Which extras do you want on the banner?', header: 'Extras', multiSelect: true, options: [{ label: 'Shadow', description: 'A soft drop shadow under the title.' }, { label: 'Border', description: 'A thin border around the banner.' }, { label: 'Glow', description: 'An outer glow on hover.' }] },
];
const records = [
  { type: 'user', uuid: 'u1', timestamp: at(1), message: { content: 'Make the release banner for the landing page.' } },
  { type: 'assistant', uuid: 'a1', timestamp: at(5), message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'text', text: 'I will check the existing banner styles first.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'rg --files src/styles | rg banner', description: 'Find banner styles' } }] } },
  { type: 'user', uuid: 'r1', timestamp: at(6), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'src/styles/banner.css\nsrc/styles/banner-dark.css' }] } },
  { type: 'assistant', uuid: 'a2', timestamp: at(8), message: { id: 'm2', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'C:/Projects/site/src/styles/banner.css' } }] } },
  { type: 'user', uuid: 'r2', timestamp: at(9), message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: '.banner { padding: 24px; border-radius: 12px; }\n.banner h1 { font-size: 2rem; }' }] } },
  { type: 'assistant', uuid: 'a3', timestamp: at(12), message: { id: 'm3', stop_reason: 'tool_use', content: [{ type: 'text', text: 'Two choices are yours to make before I write it.' }, { type: 'tool_use', id: 't3', name: 'AskUserQuestion', input: { questions: QUESTIONS } }] } },
];
let transcript = records;
service.mobile.transcripts.read = async () => ({ supported: true, activity: [], messages: transcriptMessages(transcript, 'claude') });

// Claude starts the hook exactly so: JSON on stdin, the decision on stdout.
const launch = await service.sessions.questions.launch(id);
const hook = spawn(process.execPath, [HOOK_SCRIPT], { env: { ...process.env, ...launch.env }, stdio: ['pipe', 'pipe', 'inherit'] });
let hookOutput = '';
hook.stdout.on('data', chunk => { hookOutput += chunk; });
const hookDone = new Promise(resolve => hook.on('exit', resolve));
hook.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: QUESTIONS } }));
service.sessions.nativeEvent(session, { kind: 'question', toolUseId: 't3', text: 'Claude is asking you a question.' });

let browser;
const shots = [];
try {
  await service.mobile.enable();
  const api = async (route, data) => {
    const response = await fetch(`${service.mobile.origin}/mobile/api${route}`, { method: 'POST', headers: { Origin: service.mobile.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  const qr = await service.mobile.newPairing(), claim = (await api('/pair', { token: new URL(qr.url).hash.slice(6), name: 'Test phone' })).data;
  await service.mobile.approve(claim.id);
  const credential = (await api('/pair/finish', claim)).cookie.split('=')[1];
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addCookies([{ name: 'iaar_mobile', value: credential, domain: '127.0.0.1', path: '/mobile/', httpOnly: true, sameSite: 'Strict' }]);
  const phone = await context.newPage(); phone.setDefaultTimeout(12000);
  const errors = []; phone.on('pageerror', error => errors.push(error.message));
  const shoot = async name => { const file = path.join(repo, name); await phone.screenshot({ path: file }); shots.push(file); };
  // "Jump to latest" must never cover a visible option of an open question.
  const clear = async () => {
    await phone.waitForTimeout(150);
    return phone.evaluate(() => {
      if (!document.querySelector('.mobile-jump-latest')) return true;
      const button = document.querySelector('.mobile-jump-latest').getBoundingClientRect(), list = document.querySelector('.mobile-messages').getBoundingClientRect();
      // Only the part of an option inside the scrolled list is visible.
      return [...document.querySelectorAll('.mobile-question-option')].map(node => node.getBoundingClientRect()).filter(box => box.bottom > list.top && box.top < list.bottom)
        .map(box => ({ left: box.left, right: box.right, top: Math.max(box.top, list.top), bottom: Math.min(box.bottom, list.bottom) }))
        .every(box => box.right <= button.left || box.left >= button.right || box.bottom <= button.top || box.top >= button.bottom);
    });
  };
  const fits = async () => phone.evaluate(() => [document.documentElement.scrollWidth <= innerWidth, [...document.querySelectorAll('.mobile-messages, .mobile-question')].every(node => node.scrollWidth <= node.clientWidth + 1)]);
  await phone.goto(`${service.mobile.origin}/mobile/`);
  await phone.getByText('Needs your answer · question open').waitFor();
  await phone.getByRole('button', { name: /Banner design/ }).click();
  const card = phone.getByRole('form', { name: 'Claude is asking a question' });
  await card.getByText('Claude has 2 questions').waitFor();
  for (const text of ['Which colour should the banner use?', 'Matches the logo and reads well on both themes.', 'Choose any that apply', 'Choose one']) await card.getByText(text).waitFor();
  // Tool calls read like the terminal: one line each, with input and result when opened.
  await phone.getByText('rg --files src/styles | rg banner', { exact: true }).click();
  await phone.locator('.mobile-tool-call[open] pre').filter({ hasText: 'banner-dark.css' }).waitFor();
  assert.deepEqual(await fits(), [true, true]);
  await phone.locator('.mobile-messages').evaluate(node => { node.scrollTop = 0; });
  await shoot('phone-question-tools-390.png');
  await card.evaluate(node => node.scrollIntoView({ block: 'start' }));
  await phone.locator('.mobile-jump-latest').waitFor();
  assert.equal(await clear(), true, 'Jump to latest covers an option at 390 px');
  await shoot('phone-question-390.png');
  await phone.setViewportSize({ width: 768, height: 1024 });
  assert.deepEqual(await fits(), [true, true]);
  await card.evaluate(node => node.scrollIntoView({ block: 'start' }));
  assert.equal(await clear(), true, 'Jump to latest covers an option at 768 px');
  await shoot('phone-question-768.png');
  await phone.setViewportSize({ width: 390, height: 844 });

  const send = card.getByRole('button', { name: 'Send answers' });
  assert.equal(await send.isDisabled(), true, 'Every question needs an answer first');
  await card.getByText('Other', { exact: true }).first().click();
  await card.getByRole('textbox', { name: 'Your answer to: Colour' }).fill('Teal, with a gold edge');
  await card.getByText('Shadow', { exact: true }).click();
  await card.getByText('Glow', { exact: true }).click();
  await card.scrollIntoViewIfNeeded();
  await shoot('phone-question-filled-390.png');
  await send.click();
  await card.getByText('Answer delivered. Claude is continuing.').waitFor();
  assert.equal(await hookDone, 0);
  assert.deepEqual(JSON.parse(hookOutput).hookSpecificOutput.decision, { behavior: 'allow', updatedInput: { questions: QUESTIONS, answers: { [QUESTIONS[0].question]: 'Teal, with a gold edge', [QUESTIONS[1].question]: 'Shadow, Glow' } } });
  assert.deepEqual(writes, [], 'The answer goes through the hook, not typed keys');
  assert.equal(service.sessions.get(id).activity, 'working');

  // Claude records the answer; the card becomes a short record in the conversation.
  transcript = [...records, { type: 'user', uuid: 'r3', timestamp: at(30), toolUseResult: { questions: QUESTIONS, answers: JSON.parse(hookOutput).hookSpecificOutput.decision.updatedInput.answers }, message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'The user answered...' }] } }];
  await phone.getByText('Question answered').waitFor();
  await card.waitFor({ state: 'detached' });
  await phone.getByText('Teal, with a gold edge').waitFor();
  await shoot('phone-question-answered-390.png');

  // A fullscreen CLI keeps its own history: the terminal offers page keys for it.
  await new Promise(resolve => session.terminal.write('\x1b[?1049h\x1b[HFullscreen Claude view', resolve));
  await phone.getByRole('button', { name: 'Terminal', exact: true }).click();
  await phone.getByRole('button', { name: 'Page up in the CLI' }).click();
  for (let tries = 0; !writes.includes('\x1b[5~'); tries++) { assert.ok(tries < 100, 'Page up reached the CLI'); await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, screenshots: shots }, null, 2));
} finally {
  hook.kill(); await browser?.close();
  for (const item of service.sessions.items.values()) item.process = null;
  await service.close();
}
