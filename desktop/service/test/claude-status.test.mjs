import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { claudeModels, claudeUsage, readStatus, reporterCommand, statusFolder, statusSettings } from '../claude-status.mjs';
import { applyChoice, cacheWarning, liveStats, rememberedChoice, switchingModel } from '../chat-models.mjs';
import { inventory, terminalCommand } from '../agents.mjs';
import { terminalPrompt } from '../terminal-prompt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reporter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../claude-statusline.mjs');
const temp = async prefix => { await mkdir(path.join(root, '.cache'), { recursive: true }); return mkdtemp(path.join(root, '.cache', prefix)); };

// The status line payload documented at https://code.claude.com/docs/en/statusline.
const payload = (fiveHour = 23.5, resetsAt = Math.floor(Date.now() / 1000) + 3600) => ({
  session_id: 'abc', transcript_path: '/secret/path.jsonl', cwd: '/private/project', version: '2.1.312',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' }, effort: { level: 'high' },
  cost: { total_cost_usd: 1.2345 },
  context_window: { total_input_tokens: 15500, total_output_tokens: 1200, context_window_size: 1000000, used_percentage: 2, current_usage: { input_tokens: 8500, output_tokens: 1200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 2000 } },
  rate_limits: { five_hour: { used_percentage: fiveHour, resets_at: resetsAt }, seven_day: { used_percentage: 41.2, resets_at: resetsAt + 86400 } },
});

async function report(file, value) {
  const child = execFile(process.execPath, [reporter, file]);
  const done = new Promise((resolve, reject) => child.on('exit', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  child.stdin.end(JSON.stringify(value));
  await done;
}

test('the status line reporter saves plan limits, context, model and effort, and nothing private', async () => {
  const state = await temp('claude-status-');
  const folder = statusFolder(state);
  await mkdir(folder, { recursive: true });
  await report(path.join(folder, 'chat.json'), payload());
  const { chat, account } = await readStatus(state, 'chat');
  assert.equal(chat.model.id, 'claude-opus-5-5');
  assert.equal(chat.effort, 'high');
  assert.equal(chat.context.size, 1000000);
  assert.equal(chat.rateLimits.five_hour.used_percentage, 23.5);
  assert.equal(account.rateLimits.seven_day.used_percentage, 41.2);
  const saved = await readFile(path.join(folder, 'chat.json'), 'utf8');
  assert.doesNotMatch(saved, /secret|private/);
  // A payload before the first reply has no limits and leaves the account's.
  await report(path.join(folder, 'other.json'), { ...payload(), rate_limits: undefined });
  assert.equal((await readStatus(state, 'other')).account.rateLimits.five_hour.used_percentage, 23.5);
});

test('Claude usage shows the 5-hour and weekly windows, and unknown or reset ones as null', () => {
  const now = Date.now(), soon = Math.floor(now / 1000) + 3600;
  const chat = { at: now, model: { id: 'claude-opus-5-5' }, effort: 'high', context: { size: 1000000, usedPercent: 2, input: 15500, output: 1200, fresh: 8500, cacheRead: 2000, cacheWrite: 5000 }, costUSD: 1.2345, rateLimits: { five_hour: { used_percentage: 23.5, resets_at: soon }, seven_day: { used_percentage: 41.2, resets_at: soon + 86400 } } };
  const usage = claudeUsage({ chat, account: null }, null, { plan: 'Max 20x', now });
  assert.equal(usage.source, 'statusline');
  assert.deepEqual(usage.rateLimits.primary, { usedPercent: 23.5, windowMinutes: 300, resetsAt: soon });
  assert.equal(usage.rateLimits.secondary.usedPercent, 41.2);
  assert.equal(usage.rateLimits.planType, 'Max 20x');
  assert.equal(usage.tokens.contextWindow, 1000000);
  assert.equal(usage.tokens.contextPercent, 2);
  assert.equal(usage.costUSD, 1.235);

  // A window whose reset time has passed no longer says how much is used.
  const reset = claudeUsage({ chat: { ...chat, rateLimits: { ...chat.rateLimits, five_hour: { used_percentage: 99, resets_at: Math.floor(now / 1000) - 60 } } }, account: null }, null, { now });
  assert.equal(reset.rateLimits.primary, null);
  assert.equal(reset.rateLimits.secondary.usedPercent, 41.2);

  // Without the status line, the transcript's tokens stay, the context size comes only
  // from the model catalog, and no limit is invented.
  const fallback = { agent: 'claude', at: '2026-10-28T10:00:00.000Z', tokens: { current: 50000, cumulative: 50000, input: 10, cached: 49000, output: 990, contextWindow: 200000, contextPercent: 25 }, costUSD: null, rateLimits: null, rateLimitsList: [] };
  const unknown = claudeUsage({ chat: null, account: null }, fallback, { model: 'claude-opus-5-5' });
  assert.equal(unknown.rateLimitsList.length, 0);
  assert.equal(unknown.tokens.contextWindow, null);
  assert.equal(unknown.tokens.contextPercent, null);
  assert.equal(unknown.at, fallback.at);
  const catalog = claudeUsage({ chat: null, account: null }, fallback, { model: 'claude-opus-5-5-20261001', models: [{ id: 'claude-opus-5-5', contextWindow: 1000000 }] });
  assert.equal(catalog.tokens.contextPercent, 5);
  // The newest of the chat's report and another chat's account report wins.
  const newer = claudeUsage({ chat, account: { at: now + 1000, rateLimits: { five_hour: { used_percentage: 30, resets_at: soon } } } }, null, { now });
  assert.equal(newer.rateLimits.primary.usedPercent, 30);
  assert.equal(newer.rateLimits.secondary, null);
});

test('the status line command survives Git Bash, PowerShell and paths with spaces', () => {
  const file = 'D:\\Mr. Mak\\state\\claude-status\\a.json';
  assert.match(reporterCommand(file, { node: 'C:\\node\\node.exe', windows: true, bash: false }), /^C:\/node\/node\.exe "[^"]+claude-statusline\.mjs" "D:\/Mr\. Mak\/state\/claude-status\/a\.json"$/);
  assert.match(reporterCommand(file, { node: '\\\\?\\D:\\Mr. Mak Workspace\\runtime\\node.exe', windows: true, bash: true }), /^"D:\/Mr\. Mak Workspace\/runtime\/node\.exe" "/);
  assert.match(reporterCommand(file, { node: 'D:\\Mr. Mak Workspace\\runtime\\node.exe', windows: true, bash: false }), /^& 'D:\/Mr\. Mak Workspace\/runtime\/node\.exe' '/);
  assert.equal(reporterCommand("D:\\it's\\a.json", { node: 'C:\\node.exe', windows: true, bash: true }), null);
});

test('a Claude chat starts with the reporter unless the person has their own status line', async () => {
  const state = await temp('claude-status-settings-');
  const home = await temp('claude-status-home-');
  const project = await temp('claude-status-project-');
  const session = { id: 'chat-1', agent: 'claude', cwd: project };
  const env = { ...process.env, CLAUDE_CONFIG_DIR: home };
  const file = await statusSettings(state, session, env);
  assert.match(JSON.parse(await readFile(file, 'utf8')).statusLine.command, /claude-statusline\.mjs["'] ["'][^"']*chat-1\.json["']$/);
  await mkdir(path.join(project, '.claude'));
  await writeFile(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({ statusLine: { type: 'command', command: 'my-line' } }));
  assert.equal(await statusSettings(state, session, env), null);
  assert.equal(await statusSettings(state, { ...session, agent: 'codex' }, env), null);
  // The model and settings come before --add-dir, which takes every argument after it.
  if (!inventory().find(item => item.id === 'claude')?.available) return;
  const command = terminalCommand('claude', { model: 'claude-opus-5-5', settings: file, readDir: project });
  const script = process.platform === 'win32' ? Buffer.from(command.args.at(-1), 'base64').toString('utf16le') : command.args.join(' ');
  assert.ok(script.indexOf('--model') > 0 && script.indexOf('--model') < script.indexOf('--settings') && script.indexOf('--settings') < script.indexOf('--add-dir'));
  assert.throws(() => terminalCommand('claude', { model: '--dangerously-skip-permissions' }), /listed models/);
});

test('the model list comes from Claude Code\'s catalog cache, with aliases as the fallback', async () => {
  const home = await temp('claude-catalog-');
  assert.deepEqual((await claudeModels({ CLAUDE_CONFIG_DIR: home })).map(item => item.id), ['opus', 'sonnet', 'haiku']);
  await mkdir(path.join(home, 'cache', 'model-catalog'), { recursive: true });
  await writeFile(path.join(home, 'cache', 'model-catalog', 'org-cc.json'), JSON.stringify({ catalog: { config: { models: [
    { id: 'claude-opus-5-5', name: 'Opus 5.5', short_name: 'Opus', section: 'main', runtime: { max_input_tokens: 1000000, effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'], default_effort: 'medium' } },
    { id: 'claude-opus-4-6', name: 'Opus 4.6', short_name: 'Opus', section: 'overflow' },
  ] } } }));
  const models = await claudeModels({ CLAUDE_CONFIG_DIR: home });
  assert.deepEqual(models, [{ id: 'claude-opus-5-5', name: 'Opus 5.5', shortName: 'Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', contextWindow: 1000000 }]);
});

// A terminal whose screen the test controls, with the session API the model menu uses.
function fakeChat({ cwd, onInput }) {
  const session = { id: 'chat', agent: 'claude', cwd, process: {}, model: undefined, effort: 'xhigh' };
  const fake = { screen: 'Claude Code\n\n❯ \n', typed: [], keys: [] };
  fake.sessions = {
    get: () => session,
    read: async () => ({ screen: fake.screen }),
    input: (id, text) => { fake.typed.push(text); setTimeout(() => onInput(fake, text), 700); return { delivered: true }; },
    keys: (id, key) => { fake.keys.push(key); if (key === '\r') fake.screen = `${fake.base}\n  ⎿  Set model to Sonnet 5.5 and saved as your default for new sessions\n\n❯ \n`; },
    changed: () => {},
  };
  fake.base = 'Claude Code\n> Earlier work';
  return { session, fake };
}
const confirm = (subtitle = 'Your next response will be slower and use more tokens') => ['Claude Code', '> Earlier work', '▔'.repeat(60), ' Switch model?', ` ${subtitle}`, '', ' This conversation is cached for the current model. Switching to Sonnet 5.5 means the full history gets re-read.', '', ' ❯ 1. Yes, switch to Sonnet 5.5', '   2. No, go back', ''].join('\n');

test('Claude Code\'s cache warning is read as a prompt and recognised as the switch warning', () => {
  const prompt = terminalPrompt(confirm());
  assert.equal(prompt.question, 'Switch model?');
  assert.deepEqual(prompt.options, ['Yes, switch to Sonnet 5.5', 'No, go back']);
  assert.ok(cacheWarning(prompt));
  assert.ok(!cacheWarning(terminalPrompt(confirm('A PreModelSwitch hook asked you to confirm'))));
});

test('the footer menu applies a model and effort with no question left in the chat', async () => {
  const state = await temp('chat-models-');
  const cwd = await temp('chat-models-project-');
  const { session, fake } = fakeChat({ cwd, onInput: (chat, text) => {
    chat.screen = text.startsWith('/model') ? confirm() : `${chat.screen.replace(/\n❯ \n$/, '')}\n  ⎿  Set effort level to high (saved as your default for new sessions)\n\n❯ \n`;
  } });
  const result = await applyChoice(fake.sessions, state, 'chat', { model: 'claude-sonnet-5-5', effort: 'high' });
  assert.deepEqual(fake.typed, ['/model claude-sonnet-5-5', '/effort high']);
  assert.deepEqual(fake.keys, ['\r']);
  assert.equal(result.applied, true);
  assert.equal(result.model, 'claude-sonnet-5-5');
  assert.equal(result.effort, 'high');
  assert.equal(session.model, 'claude-sonnet-5-5');
  assert.equal(session.effort, 'high');
  assert.equal(switchingModel('chat'), false);
  assert.deepEqual(await rememberedChoice(state, cwd, 'claude'), { model: 'claude-sonnet-5-5', effort: 'high' });
  // The stats report the applied choice until the status line reports a newer one.
  const stats = await liveStats(session, { supported: true, model: 'claude-opus-5-5', effort: 'xhigh', usage: null }, state);
  assert.equal(stats.model, 'claude-sonnet-5-5');
  assert.equal(stats.effort, 'high');
});

test('a switch confirmation a PreModelSwitch hook asks for stays with the person', async () => {
  const state = await temp('chat-models-hook-');
  const cwd = await temp('chat-models-hook-project-');
  const { session, fake } = fakeChat({ cwd, onInput: chat => { chat.screen = confirm('A PreModelSwitch hook asked you to confirm'); } });
  const result = await applyChoice(fake.sessions, state, 'chat', { model: 'claude-sonnet-5-5', effort: 'high' });
  assert.equal(result.applied, false);
  assert.deepEqual(fake.typed, ['/model claude-sonnet-5-5']);
  assert.deepEqual(fake.keys, []);
  assert.equal(session.model, undefined);
  // An open question blocks a new change until it is answered.
  await assert.rejects(applyChoice(fake.sessions, state, 'chat', { effort: 'low' }), /Answer the question/);
  await assert.rejects(applyChoice(fake.sessions, state, 'chat', { model: '--bad' }), /listed models/);
  await assert.rejects(applyChoice({ ...fake.sessions, get: () => ({ ...session, agent: 'codex' }) }, state, 'chat', { effort: 'low' }), /own terminal picker/);
});
