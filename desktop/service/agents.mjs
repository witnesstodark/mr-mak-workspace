import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseEnv } from 'dotenv';
import { isWindows, resolveCommand, shellCommand, shellLabel } from './platform.mjs';
import { validAntigravityId } from './antigravity.mjs';

export { shellCommand };

export function wrapCommand(file, args = []) {
  if (!isWindows || /\.exe$/i.test(file)) return { file, args };
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = `[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); & ${[file, ...args].map(quote).join(' ')}; exit $LASTEXITCODE`;
  return { file: shellCommand().file, args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}

export const AGENTS = [
  { id: 'codex', label: 'Codex', color: '#88d8bf', command: 'codex', subscription: true },
  { id: 'claude', label: 'Claude Code', color: '#dba68c', command: 'claude', subscription: true },
  { id: 'antigravity', label: 'Antigravity', color: '#8ab4f8', command: 'agy', subscription: true },
  { id: 'opencode', label: 'OpenCode', color: '#c8d2dc', command: 'opencode', subscription: false },
  { id: 'kimi', label: 'Kimi', color: '#b3a3f7', command: 'kimi', subscription: true },
  { id: 'cursor', label: 'Cursor', color: '#f0d7a2', command: 'cursor-agent', subscription: true },
  { id: 'shell', label: shellLabel(), color: '#89b7ed', command: 'shell', subscription: false },
];

// The official install provides `cursor-agent`. Accept `agent` only when it sits
// beside that binary, so an unrelated program named agent is never launched.
export function cursorBinary(env = process.env, home) {
  const named = commandPath('cursor-agent', env, home);
  if (named) return named;
  const alias = commandPath('agent', env, home);
  if (!alias) return null;
  const dir = path.dirname(alias);
  const official = path.basename(dir).toLowerCase() === 'cursor-agent'
    || ['cursor-agent', 'cursor-agent.exe', 'cursor-agent.cmd'].some(name => existsSync(path.join(dir, name)));
  return official ? alias : null;
}

export function cursorInvocation(args, env = process.env) {
  const file = cursorBinary(env);
  if (!file) return null;
  if (!isWindows || /\.exe$/i.test(file)) return { file, args };
  return wrapCommand(file, args);
}

export function commandPath(name, env = process.env, home) {
  return resolveCommand(name, env, home);
}

export function inventory(env = process.env) {
  const shell = shellCommand(env);
  const shellAvailable = path.isAbsolute(shell.file) ? existsSync(shell.file) : !!commandPath(shell.file, env);
  return AGENTS.map(agent => ({ ...agent, available: agent.id === 'shell' ? shellAvailable : agent.id === 'cursor' ? !!cursorBinary(env) : !!commandPath(agent.command, env) }));
}

// Resolve the real Codex binary when available so JSON-RPC does not pass through a shell.
export function codexBinary(env = process.env) {
  if (!isWindows) {
    const executable = commandPath('codex', env);
    if (executable) return { file: executable, args: [] };
    throw new Error('Codex CLI is not installed. Install it and sign in once to use Iaar.');
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
  throw new Error('Codex CLI is not installed. Install it and sign in once to use Iaar.');
}

// Conversation IDs become CLI arguments. One shaped like an option would be
// parsed as an option, for example a CLI's own permission-bypass flag.
export function nativeConversationId(value) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error('This conversation ID is not valid. Copy it again from the CLI.');
  return value;
}

export function terminalCommand(agent, { bypass = false, resumeId, nativeId, effort, opencodeMajor = 1, antigravityLog, settings } = {}) {
  if (!AGENTS.some(item => item.id === agent)) throw new Error('Unknown agent');
  resumeId = nativeConversationId(resumeId); nativeId = nativeConversationId(nativeId);
  const command = agent === 'shell' ? shellCommand() : agent === 'cursor' ? { file: cursorBinary(), args: [] } : { file: commandPath(AGENTS.find(item => item.id === agent).command), args: [] };
  if (!command || !command.file) throw new Error(`${agent} is not installed on this computer`);
  if (agent === 'shell' && (path.isAbsolute(command.file) ? !existsSync(command.file) : !commandPath(command.file))) throw new Error('The local shell is not available on this computer');
  const args = [];
  if (agent === 'codex') {
    if (resumeId) args.push('resume', resumeId);
    // Inline mode retains xterm scrollback for new and resumed conversations.
    args.push('--no-alt-screen');
    if (bypass) args.push('--dangerously-bypass-approvals-and-sandbox');
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  } else if (agent === 'claude') {
    if (resumeId) args.push('--resume', resumeId);
    else if (nativeId) args.push('--session-id', nativeId);
    if (bypass) args.push('--dangerously-skip-permissions');
    if (effort) args.push('--effort', effort);
    // Iaar's question hook: hooks from --settings are added to the user's own.
    if (settings) args.push('--settings', settings);
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
  } else if (agent === 'cursor') {
    if (resumeId) args.push('--resume', resumeId);
    if (bypass) args.push('--force');
  }
  if (!isWindows || agent === 'shell') return { file: command.file || command, args: [...(command.args || []), ...args] };
  // No -NoExit: stale coordinator input cannot become shell commands after the agent exits.
  return wrapCommand(command.file, [...(command.args || []), ...args]);
}

export function childEnvironment(repo) {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  // Forward only explicitly named MCP credentials. Voice and unrelated API keys
  // stay private to the service; CLI subscription authentication is unchanged.
  if (repo) {
    const values = parseEnv(readDotEnv(path.join(repo, '.env')));
    for (const [name, value] of Object.entries(values)) if (/^IAAR_MCP_[A-Z0-9_]+$/.test(name) && !env[name]) env[name] = value;
  }
  // Drop host-agent identity from the parent so every terminal is an independent CLI.
  for (const key of Object.keys(env)) {
    // A Claude child-session marker would also turn off the chat's transcript.
    if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_CHILD_SESSION|CLAUDE_CODE_SESSION_ID|CLAUDE_CODE_SESSION_ATTENDED|CLAUDE_CODE_MESSAGING_SOCKET|CLAUDE_CODE_MESSAGING_TOKEN|CLAUDE_PID|CODEX_THREAD_ID|CODEX_TURN_ID|CODEX_SHELL|ANTIGRAVITY_AGENT|IAAR_TOKEN|IAAR_PARENT_PID|CURSOR_AGENT|CURSOR_CONVERSATION_ID|CURSOR_REQUEST_ID|CURSOR_LAYOUT|CURSOR_WORKSPACE_LABEL|CURSOR_RIPGREP_PATH|AGENT_TRANSCRIPTS)$/.test(key) || key.startsWith('IAAR_OPENCODE_') || key.startsWith('CURSOR_AGENT_STORE_') || key.startsWith('__CURSOR_')) delete env[key];
  }
  return env;
}

export function readDotEnv(file) {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}
