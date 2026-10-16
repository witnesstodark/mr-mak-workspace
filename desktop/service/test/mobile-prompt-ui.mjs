// A question and a plan approval that Claude shows only in its terminal, answered
// from the phone: the card's taps become key presses in the (fake) terminal.
import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createService } from '../server.mjs';
import { launchBrowser } from './browser.mjs';
import { FakePicker, FakePlan } from './fake-claude-prompts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const shots = process.env.MRMAK_SHOTS || null;
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/mobile-prompt-'));
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
for (const name of ['mak-nose.svg', 'mak-nose-chats.svg', 'mak-mobile-192.png', 'mak-mobile-512.png']) await copyFile(path.join(root, 'public/assets', name), path.join(repo, 'ui/assets', name));
const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mobileOptions: { transport }, mcpOptions: { home: repo, env: {} } });
service.sessions.beginDiscovery = () => {};
const id = randomUUID(), nativeId = randomUUID();
const session = service.sessions.make({ id, nativeId, name: 'Pet questions', agent: 'claude', status: 'running', open: true, pinned: false, cols: 90, rows: 40, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
service.sessions.items.set(id, session); await service.sessions.hydrate(session);
let terminal;
const draw = () => new Promise(resolve => session.terminal.write(`\x1b[H\x1b[2J${terminal.screen().replaceAll('\n', '\r\n')}`, resolve));
session.process = { write: data => { terminal.press(data); draw(); }, resize: () => {}, onExit: () => ({ dispose() {} }), kill: () => {} };
service.mobile.transcripts.read = async () => ({ supported: true, messages: [{ id: 'user', role: 'user', text: 'Help me choose a pet for the trip.', at: new Date().toISOString() }] });
async function ask(tool, input, fake) {
  terminal = fake; await draw();
  const toolId = `toolu_${randomUUID().slice(0, 8)}`, at = new Date().toISOString();
  await writeFile(path.join(service.sessions.prompts.dir, `${nativeId}.json`), JSON.stringify({ tool, id: toolId, input, at }));
  service.sessions.nativeEvent(session, { kind: 'asking', asking: { kind: tool === 'ExitPlanMode' ? 'plan' : 'question', id: toolId, at }, preview: 'Which pet?' });
}
const pet = { question: 'Which pet should come along?', header: 'Pet', multiSelect: false, options: [{ label: 'Dragon', description: 'Fast, warm, a little bit on fire.' }, { label: 'Giant owl', description: 'Quiet flyer, good at night.' }, { label: 'Moose', description: 'Slow, but very northern Swedish.' }] };
const snacks = { question: 'Which snacks should we pack?', header: 'Snacks', multiSelect: true, options: [{ label: 'Bread', description: 'A crusty loaf.' }, { label: 'Cheese', description: 'Something sharp.' }, { label: 'Fish', description: 'Smoked, for the owl.' }] };

let browser;
try {
  browser = await launchBrowser();
  await service.mobile.enable(); const pairing = await service.mobile.newPairing();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(pairing.url);
  await page.getByRole('button', { name: 'Request connection' }).click();
  await page.getByRole('heading', { name: 'Confirm on your computer' }).waitFor();
  await service.mobile.approve(service.mobile.status().pending[0].id);
  await page.getByRole('heading', { name: 'Chats', exact: true }).waitFor();

  const picker = new FakePicker([pet, snacks]);
  await ask('AskUserQuestion', { questions: [pet, snacks] }, picker);
  await page.getByText('Asking you a question').waitFor();
  if (shots) await page.screenshot({ path: path.join(shots, 'prompt-list.png') });
  await page.getByText('Pet questions').click();
  const card = page.locator('.mobile-prompt');
  await card.getByText('Claude asks you 2 questions').waitFor();
  if (shots) { await card.evaluate(element => element.scrollIntoView({ block: 'start' })); await page.screenshot({ path: path.join(shots, 'prompt-question-top.png') }); }
  const send = card.getByRole('button', { name: 'Send answers' });
  assert.equal(await send.isDisabled(), true, 'every question needs an answer first');
  await card.getByRole('button', { name: /Giant owl/ }).click();
  await card.getByRole('button', { name: /Moose/ }).click();
  assert.equal(await card.getByRole('button', { name: /Giant owl/ }).getAttribute('aria-pressed'), 'false', 'one pet only');
  await card.getByRole('button', { name: /Cheese/ }).click();
  await card.getByRole('button', { name: /Fish/ }).click();
  await card.getByRole('group', { name: /Snacks/ }).getByRole('button', { name: /Something else/ }).click();
  await card.getByRole('textbox', { name: 'Your answer to Snacks' }).fill('Lingonberry jam');
  if (shots) await page.screenshot({ path: path.join(shots, 'prompt-question.png'), fullPage: true });
  await send.click();
  await card.getByText('Answer sent. Claude carries on.').waitFor({ timeout: 20000 });
  assert.equal(picker.done, true); assert.deepEqual(picker.answers, ['Moose', 'Cheese, Fish, Lingonberry jam']);

  const plan = new FakePlan();
  await ask('ExitPlanMode', { plan: '# Plan: the trip\n\n## Steps\n1. Saddle the moose.\n2. Pack cheese, fish and jam.\n3. Ride north along the lake.\n\n' + Array.from({ length: 12 }, (_, index) => `- Check item ${index + 1} on the list.`).join('\n') }, plan);
  await page.getByText('Plan ready for your approval').waitFor();
  await card.getByText('Saddle the moose.').waitFor();
  if (shots) await page.screenshot({ path: path.join(shots, 'prompt-plan.png'), fullPage: true });
  await card.getByRole('textbox', { name: 'Tell Claude what to change' }).fill('Bring a tent as well.');
  await card.getByRole('button', { name: 'Send changes' }).click();
  await card.getByText('Answer sent. Claude carries on.').waitFor({ timeout: 20000 });
  assert.deepEqual(plan.done, { choice: 3, text: 'Bring a tent as well.' });

  // A question the terminal no longer shows can't be answered from the phone.
  await ask('AskUserQuestion', { questions: [pet] }, { screen: () => '❯ \n  ⏵⏵ auto mode on', press() {} });
  await card.getByText('Its terminal isn\'t showing this right now').waitFor();
  assert.deepEqual(errors, []);
  console.log('MOBILE PROMPT UI TEST PASSED');
} finally {
  await browser?.close();
  await service.close();
}
