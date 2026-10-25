import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse as parseEnv } from 'dotenv';
import { isWindows, macLocale, powerShellLiteral, resolveCommand, shellCommand, shellLabel } from './platform.mjs';
import { validAntigravityId } from './antigravity.mjs';
import { piExtension, validPiSessionId } from './pi.mjs';

export { shellCommand };

export function wrapCommand(file, args = []) {
  if (!isWindows || /\.exe$/i.test(file)) return { file, args };
  const script = `[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); & ${[file, ...args].map(powerShellLiteral).join(' ')}; exit $LASTEXITCODE`;
  return { file: shellCommand().file, args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}

export const AGENTS = [
  { id: 'codex', label: 'Codex', color: '#88d8bf', command: 'codex', subscription: true },
  { id: 'claude', label: 'Claude Code', color: '#dba68c', command: 'claude', subscription: true },
  { id: 'antigravity', label: 'Antigravity', color: '#8ab4f8', command: 'agy', subscription: true },
  { id: 'opencode', label: 'OpenCode', color: '#c8d2dc', command: 'opencode', subscription: false },
  { id: 'kimi', label: 'Kimi', color: '#b3a3f7', command: 'kimi', subscription: true },
  { id: 'pi', label: 'Pi', color: '#f0b86e', command: 'pi', subscription: false },
  { id: 'shell', label: shellLabel(), color: '#89b7ed', command: 'shell', subscription: false },
];

export function commandPath(name, env = process.env, home) {
  return resolveCommand(name, env, home);
}

export function inventory(env = process.env) {
  const shell = shellCommand(env);
  const shellAvailable = path.isAbsolute(shell.file) ? existsSync(shell.file) : !!commandPath(shell.file, env);
  return AGENTS.map(agent => ({ ...agent, available: agent.id === 'shell' ? shellAvailable : !!commandPath(agent.command, env) }));
}

// Resolve the real Codex binary when available so JSON-RPC does not pass through a shell.
export function codexBinary(env = process.env) {
  if (!isWindows) {
    const executable = commandPath('codex', env);
    if (executable) return { file: executable, args: [] };
    throw new Error('Codex CLI is not installed. Install it and sign in once to use Mr. Mak.');
  }
  const npmRoot = path.join(env.APPDATA || '', 'npm', 'node_modules', '@openai');
  const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const platformPackage = `codex-win32-${process.arch}`;
  for (const root of [path.join(npmRoot, 'codex', 'node_modules', '@openai', platformPackage), path.join(npmRoot, platformPackage), path.join(npmRoot, 'codex')]) {
    for (const directory of ['bin', 'codex']) {
      const candidate = path.join(root, 'vendor', triple, directory, 'codex.exe');
      if (existsSync(candidate)) return { file: candidate, args: [] };
    }
  }
  const js = path.join(npmRoot, 'codex', 'bin', 'codex.js');
  if (existsSync(js)) return { file: process.execPath, args: [js] };
  const executable = commandPath('codex', env);
  if (executable && !/\.(cmd|bat|ps1)$/i.test(executable)) return { file: executable, args: [] };
  throw new Error('Codex CLI is not installed. Install it and sign in once to use Mr. Mak.');
}

// Conversation IDs become CLI arguments. One shaped like an option would be
// parsed as an option, for example a CLI's own permission-bypass flag.
export function nativeConversationId(value) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error('This conversation ID is not valid. Copy it again from the CLI.');
  return value;
}

// A first prompt becomes a CLI argument: one line, no control characters, and
// never shaped like an option. No double quotes either: Claude Code on Windows
// cut the argument at an escaped quote.
export function initialPromptArgument(value) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 4000 || /[\x00-\x1f\x7f"]/.test(value) || /^\s*-/.test(value) || !value.trim()) throw new Error('The first message for a new chat is not valid.');
  return value;
}

// Codex 0.163 added the shared background server and --no-daemon; an older Codex
// rejects the option. Checked once per installed binary.
const codexHelp = new Map();
export function codexSupportsNoDaemon(env = process.env) {
  const file = commandPath('codex', env);
  if (!file) return Promise.resolve(false);
  let key = file;
  try { key += `:${statSync(file).mtimeMs}`; } catch { /* A bare command name is checked once. */ }
  if (!codexHelp.has(key)) {
    const command = wrapCommand(file, ['--help']);
    codexHelp.set(key, promisify(execFile)(command.file, command.args, { env, windowsHide: true, timeout: 15000, maxBuffer: 512000 }).then(result => /--no-daemon\b/.test(result.stdout), () => false));
  }
  return codexHelp.get(key);
}

export function terminalCommand(agent, { bypass = false, resumeId, nativeId, effort, opencodeMajor = 1, antigravityLog, initialPrompt, readDir, noDaemon = false } = {}) {
  if (!AGENTS.some(item => item.id === agent)) throw new Error('Unknown agent');
  resumeId = nativeConversationId(resumeId); nativeId = nativeConversationId(nativeId);
  initialPrompt = initialPromptArgument(initialPrompt);
  if (initialPrompt && (resumeId || !['codex', 'claude'].includes(agent))) throw new Error('Only a new Codex or Claude chat can start with a message.');
  if (readDir != null && (typeof readDir !== 'string' || !path.isAbsolute(readDir) || /[\x00-\x1f]/.test(readDir))) throw new Error('Choose an absolute folder.');
  const command = agent === 'shell' ? shellCommand() : { file: commandPath(AGENTS.find(item => item.id === agent).command), args: [] };
  if (!command || !command.file) throw new Error(`${agent} is not installed on this computer`);
  if (agent === 'shell' && (path.isAbsolute(command.file) ? !existsSync(command.file) : !commandPath(command.file))) throw new Error('The local shell is not available on this computer');
  const args = [];
  if (agent === 'codex') {
    if (resumeId) args.push('resume', resumeId);
    // Inline mode retains xterm scrollback for new and resumed conversations.
    args.push('--no-alt-screen');
    // The shared background server keeps its own originator, so the terminal could
    // not be matched to its rollout. Run Codex in this terminal's process instead.
    if (noDaemon) args.push('--no-daemon');
    if (bypass) args.push('--dangerously-bypass-approvals-and-sandbox');
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
    // Codex reads outside its working folder by default.
    if (initialPrompt) args.push(initialPrompt);
  } else if (agent === 'claude') {
    // The prompt comes first: --add-dir takes every following argument.
    if (initialPrompt) args.push(initialPrompt);
    if (resumeId) args.push('--resume', resumeId);
    else if (nativeId) args.push('--session-id', nativeId);
    if (bypass) args.push('--dangerously-skip-permissions');
    if (effort) args.push('--effort', effort);
    if (readDir) args.push('--add-dir', readDir);
  } else if (agent === 'antigravity') {
    if (resumeId && !validAntigravityId(resumeId)) throw new Error('Use the Antigravity conversation UUID from its /resume picker.');
    if (resumeId) args.push('--conversation', resumeId);
    if (bypass) args.push('--dangerously-skip-permissions');
    if (effort) args.push('--effort', effort);
    if (antigravityLog) args.push('--log-file', antigravityLog);
  } else if (agent === 'kimi') {
    if (resumeId) args.push('--session', resumeId);
    if (bypass) args.push('--yolo');
  } else if (agent === 'opencode') {
    // A private v2 server keeps each tab's observer and native session separate.
    if (opencodeMajor >= 2) args.push('--standalone');
    if (resumeId) args.push('--session', resumeId);
    if (bypass) args.push('--auto');
  } else if (agent === 'pi') {
    // Pi has no permission prompts, so there is nothing to bypass. --session-id
    // opens the exact project session or creates it with the assigned ID.
    const id = resumeId || nativeId;
    if (id && !validPiSessionId(id)) throw new Error('Use the Pi session ID shown by /session.');
    args.push('--extension', piExtension);
    if (id) args.push('--session-id', id);
    if (effort) args.push('--thinking', effort);
  }
  if (!isWindows || agent === 'shell') return { file: command.file || command, args: [...(command.args || []), ...args] };
  // No -NoExit: stale coordinator input cannot become shell commands after the agent exits.
  return wrapCommand(command.file, [...(command.args || []), ...args]);
}

export function childEnvironment(repo) {
  const env = { ...process.env, ...macLocale(), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  // Forward only explicitly named MCP credentials. Voice and unrelated API keys
  // stay private to the service; CLI subscription authentication is unchanged.
  if (repo) {
    const values = parseEnv(readDotEnv(path.join(repo, '.env')));
    for (const [name, value] of Object.entries(values)) if (/^MRMAK_MCP_[A-Z0-9_]+$/.test(name) && !env[name]) env[name] = value;
  }
  // Drop host-agent identity from the parent so every terminal is an independent CLI.
  for (const key of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CODEX_THREAD_ID|CODEX_TURN_ID|CODEX_SHELL|ANTIGRAVITY_AGENT|AI_AGENT|PI_CODING_AGENT|PI_SESSION_ID|PI_SESSION_FILE|PI_PROVIDER|PI_MODEL|PI_REASONING_LEVEL|MRMAK_TOKEN|MRMAK_PARENT_PID)$/.test(key) || key.startsWith('MRMAK_OPENCODE_') || key.startsWith('MRMAK_PI_')) delete env[key];
  }
  return env;
}

export function readDotEnv(file) {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}
