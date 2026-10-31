import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWindows, resolveCommand } from './platform.mjs';

// Claude Code reports its plan limits (the 5-hour session and weekly windows), the
// live context window, model, effort and cost only to a status line command
// (https://code.claude.com/docs/en/statusline). Mr. Mak starts each Claude chat with
// claude-statusline.mjs as that command and reads what it saved. The rest of the CLI's
// configuration is untouched, and a status line the person set up themselves wins.
const reporter = fileURLToPath(new URL('./claude-statusline.mjs', import.meta.url));
export const statusFolder = stateDir => path.join(stateDir, 'claude-status');
const claudeHome = env => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const readJsonFile = async file => { try { return JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')); } catch { return null; } };

// Claude Code runs status line commands through Git Bash on Windows when it is
// installed, otherwise PowerShell (and sh elsewhere). Forward slashes survive both.
// A first word in quotes is a string, not a command, in PowerShell, so a Node path
// with spaces needs the shell's own syntax.
function gitBash(env) {
  if (env.CLAUDE_CODE_GIT_BASH_PATH) return existsSync(env.CLAUDE_CODE_GIT_BASH_PATH);
  const git = resolveCommand('git', env);
  return !!git && [path.join(path.dirname(git), '..', 'bin', 'bash.exe'), path.join(path.dirname(git), '..', '..', 'bin', 'bash.exe'), path.join(path.dirname(git), 'bash.exe')].some(file => existsSync(file));
}
export function reporterCommand(file, { env = process.env, node = process.execPath, windows = isWindows, bash } = {}) {
  // The desktop app starts Node by an extended path (\\?\D:\...), which no shell reads.
  const parts = [node, reporter, file].map(value => value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '').replaceAll('\\', '/'));
  if (parts.some(value => /["'`$\r\n]/.test(value))) return null;
  const [program, script, target] = parts;
  if (!/\s/.test(program)) return `${program} "${script}" "${target}"`;
  if (!windows || (bash ?? gitBash(env))) return `"${program}" "${script}" "${target}"`;
  return `& '${program}' '${script}' '${target}'`;
}

// A status line from managed, user or project settings: Mr. Mak's --settings would
// replace it, so the chat then starts without one and its limits stay unknown.
async function ownStatusLine(cwd, env) {
  for (const file of [path.join(claudeHome(env), 'settings.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')]) {
    if ((await readJsonFile(file))?.statusLine) return true;
  }
  return false;
}

// The --settings file for one chat, or null when the person has their own status line.
export async function statusSettings(stateDir, session, env = process.env) {
  if (session.agent !== 'claude' || await ownStatusLine(session.cwd, env)) return null;
  const folder = statusFolder(stateDir);
  await mkdir(folder, { recursive: true });
  const command = reporterCommand(path.join(folder, `${session.id}.json`), { env });
  if (!command) return null;
  const file = path.join(folder, `${session.id}.settings.json`);
  await writeFile(file, JSON.stringify({ statusLine: { type: 'command', command } }, null, 2) + '\n');
  return file;
}

export async function readStatus(stateDir, sessionId) {
  const folder = statusFolder(stateDir);
  const [chat, account] = await Promise.all([readJsonFile(path.join(folder, `${sessionId}.json`)), readJsonFile(path.join(folder, 'account.json'))]);
  return { chat, account };
}

// The plan name Claude Code keeps for the signed-in account, as "Max 20x" or "Pro".
// Only the tier is read; the account's other details stay in its config.
let planCache = { at: 0, value: null };
export async function claudePlan(env = process.env) {
  if (Date.now() - planCache.at < 5 * 60_000) return planCache.value;
  const file = env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');
  const account = (await readJsonFile(file))?.oauthAccount || {};
  const tier = `${account.userRateLimitTier || ''} ${account.organizationRateLimitTier || ''} ${account.organizationType || ''}`.toLowerCase();
  const max = /max_(\d+x)/.exec(tier);
  const value = max ? `Max ${max[1]}` : /max/.test(tier) ? 'Max' : /pro/.test(tier) ? 'Pro' : /team/.test(tier) ? 'Team' : /enterprise/.test(tier) ? 'Enterprise' : null;
  planCache = { at: Date.now(), value };
  return value;
}

// Claude Code's own model catalog cache: the models its /model picker offers, their
// effort levels and context size. Unknown formats fall back to the CLI's aliases.
const fallbackModels = [
  { id: 'opus', name: 'Opus', shortName: 'Opus' }, { id: 'sonnet', name: 'Sonnet', shortName: 'Sonnet' }, { id: 'haiku', name: 'Haiku', shortName: 'Haiku' },
].map(model => ({ ...model, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: null, contextWindow: null }));
export async function claudeModels(env = process.env) {
  const folder = path.join(claudeHome(env), 'cache', 'model-catalog');
  const files = await Promise.all((await readdir(folder).catch(() => [])).filter(name => /-cc\.json$/.test(name)).map(async name => ({ name, at: (await stat(path.join(folder, name)).catch(() => null))?.mtimeMs || 0 })));
  for (const { name } of files.sort((a, b) => b.at - a.at)) {
    const models = (await readJsonFile(path.join(folder, name)))?.catalog?.config?.models;
    if (!Array.isArray(models)) continue;
    const list = models.filter(model => typeof model?.id === 'string' && /^[a-z0-9][a-z0-9.\-[\]]{0,80}$/i.test(model.id) && model.section === 'main').map(model => ({
      id: model.id, name: String(model.name || model.id), shortName: String(model.short_name || model.name || model.id),
      efforts: Array.isArray(model.runtime?.effort_levels) ? model.runtime.effort_levels.filter(level => /^[a-z]+$/.test(level)) : [],
      defaultEffort: typeof model.runtime?.default_effort === 'string' ? model.runtime.default_effort : null,
      contextWindow: Number.isInteger(model.runtime?.max_input_tokens) ? model.runtime.max_input_tokens : null,
    }));
    if (list.length) return list;
  }
  return fallbackModels;
}

// "claude-opus-5-5-20261001[1m]" and "claude-opus-5-5" name the same catalog entry.
export const sameModel = (a, b) => !!a && !!b && a.toLowerCase().replace(/\[1m\]$/, '').replace(/-\d{8}$/, '') === b.toLowerCase().replace(/\[1m\]$/, '').replace(/-\d{8}$/, '');

// A window the CLI reported, or null when it is unknown or has reset since.
function limitWindow(value, minutes, now) {
  const used = value?.used_percentage;
  if (typeof used !== 'number') return null;
  const resetsAt = typeof value.resets_at === 'number' ? Math.round(value.resets_at) : Math.floor(Date.parse(value.resets_at) / 1000) || 0;
  if (resetsAt && resetsAt * 1000 <= now) return null;
  return { usedPercent: Math.round(used * 10) / 10, windowMinutes: minutes, resetsAt };
}

// The footer's usage for a Claude chat: status line data where Claude Code reported
// it, otherwise the transcript's token counts. A value nothing reported stays null.
export function claudeUsage({ chat, account }, fallback, { plan = null, models = [], model = null, now = Date.now() } = {}) {
  const limits = [chat, account].filter(item => item?.rateLimits).sort((a, b) => b.at - a.at)[0];
  const general = limits ? {
    limitId: 'claude_general', limitName: 'Plan', isExclusive: false, planType: plan,
    primary: limitWindow(limits.rateLimits.five_hour, 300, now), secondary: limitWindow(limits.rateLimits.seven_day, 10080, now),
  } : null;
  const known = (fallback?.rateLimitsList || []).filter(item => item.isExclusive || !general);
  const rateLimitsList = [...(general ? [general] : []), ...known.map(item => ({ ...item, planType: item.isExclusive ? item.planType : plan || null }))];
  const context = chat?.context;
  // The status line knows the context size; otherwise only the CLI's model catalog does.
  const size = context?.size ?? models.find(item => sameModel(item.id, model))?.contextWindow ?? null;
  // The status line's context counts once its report is newer than the transcript's last
  // request; right after /compact it has no counts, and the transcript's are used.
  const reported = typeof context?.input === 'number' && context.input > 0 && !(Date.parse(fallback?.at || '') > chat.at);
  const tokens = reported ? {
    current: context.input, cumulative: context.input + (context.output || 0),
    input: context.fresh ?? context.input, cached: (context.cacheRead || 0) + (context.cacheWrite || 0), output: context.output || 0,
    contextWindow: size, contextPercent: typeof context.usedPercent === 'number' ? Math.round(context.usedPercent) : size ? Math.min(100, Math.round(context.input / size * 100)) : null,
  } : fallback?.tokens ? {
    ...fallback.tokens,
    contextWindow: size, contextPercent: size ? Math.min(100, Math.round((fallback.tokens.current || 0) / size * 100)) : null,
  } : null;
  if (!tokens && !rateLimitsList.length) return fallback || null;
  return {
    // Other readers of the transcript's usage, such as its last request time, keep it.
    ...fallback,
    agent: 'claude',
    tokens: tokens || { current: 0, cumulative: 0, input: 0, cached: 0, output: 0, contextWindow: size, contextPercent: null },
    costUSD: typeof chat?.costUSD === 'number' ? Math.round(chat.costUSD * 1000) / 1000 : fallback?.costUSD ?? null,
    rateLimits: rateLimitsList[0] || null, rateLimitsList,
    fetchedAt: limits?.at || fallback?.fetchedAt || null,
    source: limits ? 'statusline' : fallback?.rateLimitsList?.length ? 'cache' : null,
  };
}
