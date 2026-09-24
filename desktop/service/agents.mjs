import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseEnv } from 'dotenv';

const isWindows = process.platform === 'win32';

export const AGENTS = [
  { id: 'codex', label: 'Codex', color: '#88d8bf', command: 'codex', subscription: true },
  { id: 'claude', label: 'Claude Code', color: '#dba68c', command: 'claude', subscription: true },
  { id: 'kimi', label: 'Kimi', color: '#b3a3f7', command: 'kimi', subscription: true },
  { id: 'shell', label: isWindows ? 'PowerShell' : path.basename(process.env.SHELL || '/bin/bash'), color: '#89b7ed', command: isWindows ? 'powershell.exe' : process.env.SHELL || '/bin/bash', subscription: false },
];

export { isWindows };

export function commandPath(name, env = process.env) {
  if (path.isAbsolute(name) && existsSync(name)) return name;
  const extra = [];
  if (env.APPDATA) extra.push(path.join(env.APPDATA, 'npm'));
  extra.push(path.join(os.homedir(), '.kimi-code', 'bin'), path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.npm-global', 'bin'));
  const extensions = isWindows ? ['.exe', '.cmd', '.bat', '.ps1', ''] : [''];
  for (const folder of [...String(env.PATH || env.Path || '').split(path.delimiter), ...extra]) {
    for (const ext of extensions) {
      const candidate = path.join(folder, name.toLowerCase().endsWith(ext) && ext ? name : name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function inventory(env = process.env) {
  return AGENTS.map(agent => ({ ...agent, available: !!commandPath(agent.command, env) }));
}

// Resolve the real Codex binary when available so JSON-RPC does not pass through a shell.
export function codexBinary(env = process.env) {
  const npmRoots = [];
  if (env.APPDATA) npmRoots.push(path.join(env.APPDATA, 'npm', 'node_modules', '@openai'));
  for (const base of [path.join(os.homedir(), '.npm-global', 'lib', 'node_modules'), '/usr/local/lib/node_modules', '/usr/lib/node_modules']) {
    npmRoots.push(path.join(base, '@openai'));
  }
  const triples = {
    'win32-x64': ['x86_64-pc-windows-msvc', 'codex-win32-x64', 'codex.exe'],
    'win32-arm64': ['aarch64-pc-windows-msvc', 'codex-win32-arm64', 'codex.exe'],
    'linux-x64': ['x86_64-unknown-linux-musl', 'codex-linux-x64', 'codex'],
    'linux-arm64': ['aarch64-unknown-linux-musl', 'codex-linux-aarch64', 'codex'],
    'darwin-x64': ['x86_64-apple-darwin', 'codex-darwin-x64', 'codex'],
    'darwin-arm64': ['aarch64-apple-darwin', 'codex-darwin-arm64', 'codex'],
  };
  const [triple, platformPackage, binary] = triples[`${process.platform}-${process.arch}`] || [];
  for (const npmRoot of npmRoots) {
    for (const root of triple ? [path.join(npmRoot, 'codex', 'node_modules', '@openai', platformPackage), path.join(npmRoot, platformPackage), path.join(npmRoot, 'codex')] : [path.join(npmRoot, 'codex')]) {
      for (const directory of ['bin', 'codex']) {
        const candidate = path.join(root, 'vendor', triple, directory, binary);
        if (existsSync(candidate)) return { file: candidate, args: [] };
      }
    }
    const js = path.join(npmRoot, 'codex', 'bin', 'codex.js');
    if (existsSync(js)) return { file: process.execPath, args: [js] };
  }
  const executable = commandPath('codex', env);
  if (executable && !/\.(cmd|bat|ps1)$/i.test(executable)) return { file: executable, args: [] };
  throw new Error('Codex CLI is not installed. Install it and sign in once to use Mr. Mak.');
}

export function terminalCommand(agent, { bypass = false, resumeId, nativeId, effort } = {}) {
  if (!AGENTS.some(item => item.id === agent)) throw new Error('Unknown agent');
  const command = commandPath(AGENTS.find(item => item.id === agent).command);
  if (!command) throw new Error(`${agent} is not installed on this computer`);
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
  } else if (agent === 'kimi') {
    if (resumeId) args.push('--session', resumeId);
    if (bypass) args.push('--yolo');
  } else if (isWindows) {
    args.push('-NoLogo');
  }
  if (!isWindows || agent === 'shell') return { file: command, args };
  // An encoded PowerShell script preserves spaces, Unicode and quotes. No -NoExit:
  // after the agent exits, stale coordinator input cannot become shell commands.
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = `[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); & ${[command, ...args].map(quote).join(' ')}; exit $LASTEXITCODE`;
  return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}

export function childEnvironment(repo) {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  // Forward only explicitly named MCP credentials. Voice and unrelated API keys
  // stay private to the service; CLI subscription authentication is unchanged.
  if (repo) {
    const values = parseEnv(readDotEnv(path.join(repo, '.env')));
    for (const [name, value] of Object.entries(values)) if (/^MRMAK_MCP_[A-Z0-9_]+$/.test(name) && !env[name]) env[name] = value;
  }
  // Drop host-agent identity from the parent so every terminal is an independent CLI.
  for (const key of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CODEX_THREAD_ID|CODEX_TURN_ID|CODEX_SHELL|MRMAK_TOKEN|MRMAK_PARENT_PID)$/.test(key)) delete env[key];
  }
  return env;
}

export function readDotEnv(file) {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}
