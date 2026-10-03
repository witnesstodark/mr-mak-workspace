import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { commandPath, wrapCommand } from './agents.mjs';
import { validSessionId } from './opencode/observer.mjs';

const execute = promisify(execFile);
const versions = new Map();
export const opencodeStatePath = (stateDir, chatId) => path.join(stateDir, `opencode-${chatId}.json`);

export async function opencodeVersion(env) {
  const file = commandPath('opencode', env);
  if (!file) throw new Error('OpenCode is not installed. Install it and connect a provider in OpenCode first.');
  const key = `${file}:${(await stat(file)).mtimeMs}`;
  if (!versions.has(key)) {
    const command = wrapCommand(file, ['--version']);
    const result = await execute(command.file, command.args, { env, windowsHide: true, timeout: 15000, maxBuffer: 64000 });
    const match = /(?:^|\s)(?:v)?(\d+)\.\d+\.\d+/.exec(result.stdout.trim());
    if (!match || ![1, 2].includes(Number(match[1]))) throw new Error('This OpenCode version is not supported yet. Mr. Mak supports OpenCode 1.x and 2.x.');
    versions.set(key, Number(match[1]));
  }
  return versions.get(key);
}

export function opencodeEnvironment(env, { stateDir, session, major, launchId = randomUUID() }) {
  if (session.nativeId && !validSessionId(session.nativeId)) throw new Error('Use an OpenCode session ID starting with ses_.');
  let config;
  try { config = env.OPENCODE_CONFIG_CONTENT ? JSON.parse(env.OPENCODE_CONFIG_CONTENT) : {}; }
  catch { throw new Error('OPENCODE_CONFIG_CONTENT must contain valid JSON before starting OpenCode in Mr. Mak.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('OPENCODE_CONFIG_CONTENT must be a JSON object.');
  const key = major >= 2 ? 'plugins' : 'plugin';
  if (config[key] !== undefined && !Array.isArray(config[key])) throw new Error(`OpenCode ${key} must be an array.`);
  const plugin = new URL(major === 2 ? './opencode/v2/' : './opencode/v1.mjs', import.meta.url).href;
  return {
    ...env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, [key]: [...(config[key] || []), plugin] }),
    MRMAK_OPENCODE_STATE: opencodeStatePath(stateDir, session.id),
    MRMAK_OPENCODE_CHAT_ID: session.id,
    MRMAK_OPENCODE_LAUNCH_ID: launchId,
    MRMAK_OPENCODE_SESSION_ID: session.nativeId || '',
    MRMAK_OPENCODE_STARTED_AT: String(Date.now()),
  };
}

export async function readOpencodeState(stateDir, chatId) {
  try {
    const file = opencodeStatePath(stateDir, chatId);
    if ((await stat(file)).size > 4096) return null;
    const state = JSON.parse(await readFile(file, 'utf8'));
    return state.chatId === chatId && validSessionId(state.nativeId) ? state : null;
  } catch { return null; }
}

export function watchOpencode(stateDir, session, launchId, update) {
  let stopped = false, busy = false, revision = -1;
  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const state = await readOpencodeState(stateDir, session.id);
      if (!stopped && state?.launchId === launchId && Number.isInteger(state.revision) && state.revision > revision) {
        revision = state.revision; update(state);
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => void poll(), 300);
  timer.unref(); void poll();
  return () => { stopped = true; clearInterval(timer); };
}
