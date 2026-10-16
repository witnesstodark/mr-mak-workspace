import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';

export const platform = process.platform;
export const isWindows = platform === 'win32';
export const isLinux = platform === 'linux';
export const isMacOS = platform === 'darwin';

export function shellLabel() {
  return isWindows ? 'PowerShell' : 'Shell';
}

export function shellCommand(env = process.env) {
  if (isWindows) return { file: path.join(env.SystemRoot || env.WINDIR || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile'] };
  const shell = env.SHELL || (isMacOS ? '/bin/zsh' : '/bin/sh');
  // Terminal.app and iTerm start login shells, so ~/.zprofile and ~/.bash_profile apply.
  return { file: shell, args: isMacOS ? ['-l'] : [] };
}

// A Mac app started from Finder or the Dock inherits no locale, and macOS sets
// its UTF-8 fallback only in /etc/zprofile. Without one, children run in the
// US-ASCII C locale and garble non-ASCII names and input. Keep a user locale.
export function macLocale(env = process.env) {
  if (!isMacOS) return {};
  const set = Object.fromEntries(['LANG', 'LC_ALL', 'LC_CTYPE'].filter(name => env[name]).map(name => [name, env[name]]));
  return Object.keys(set).length ? set : { LANG: 'en_US.UTF-8' };
}

export function commandSearchRoots(env = process.env, home = os.homedir()) {
  const roots = [];
  if (isWindows && env.APPDATA) roots.push(path.join(env.APPDATA, 'npm'));
  if (isWindows) roots.push(path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'agy', 'bin'));
  roots.push(path.join(home, '.opencode', 'bin'), path.join(home, '.kimi-code', 'bin'), path.join(home, '.local', 'bin'));
  return roots;
}

export function commandExtensions() {
  return isWindows ? ['.exe', '.cmd', '.bat', '.ps1', ''] : [''];
}

// Like a POSIX shell, skip folders and files without the execute bit.
export function isExecutable(file) {
  if (isWindows) {
    // App Execution Aliases (WindowsApps\python.exe) exist but cannot be stat'ed.
    try { return !statSync(file).isDirectory(); } catch { return existsSync(file); }
  }
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch { return false; }
}

export function resolveCommand(name, env = process.env, home = os.homedir()) {
  if (path.isAbsolute(name) && isExecutable(name)) return name;
  // Empty or relative PATH entries would resolve against the service's own folder.
  const folders = String(env.PATH || env.Path || '').split(path.delimiter).filter(folder => folder && path.isAbsolute(folder));
  for (const folder of [...folders, ...commandSearchRoots(env, home)]) {
    for (const ext of commandExtensions()) {
      const candidate = path.join(folder, name.toLowerCase().endsWith(ext) && ext ? name : name + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

export function ptyOptions({ cwd, env, cols, rows }) {
  const options = { name: 'xterm-256color', cwd, env, cols, rows };
  if (isWindows) return { ...options, useConpty: true, useConptyDll: true };
  return options;
}

export function processSpawnOptions() {
  return isWindows ? { windowsHide: true } : {};
}

export function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return isWindows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function invalidFilename(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[\x00-\x1f]/.test(name)) return true;
  if (name === '.' || name === '..' || /[/\\]/.test(name)) return true;
  if (!isWindows) return false;
  return /[<>:"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

export async function terminateProcessTree(pid, { force = false } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (isWindows) {
    await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], processSpawnOptions(), () => resolve()));
    return;
  }
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try { process.kill(-pid, signal); return; } catch { /* Not a process-group leader. */ }
  // Children spawned without `detached` share the service's group. Collect the
  // tree before signalling: once a launcher (npx, uvx, a script) dies, its
  // server is reparented to init and can no longer be found.
  const tree = await descendants(pid).catch(() => []);
  const send = (target, name) => { try { process.kill(target, name); } catch { /* already stopped */ } };
  // Stopped processes cannot fork while the tree is signalled.
  for (const target of [pid, ...tree]) send(target, 'SIGSTOP');
  for (const target of [...tree].reverse()) send(target, signal);
  send(pid, signal);
  if (!force) for (const target of [pid, ...tree]) send(target, 'SIGCONT');
}

async function descendants(pid) {
  const stdout = await new Promise((resolve, reject) => execFile('ps', ['-A', '-o', 'pid=,ppid='], (error, output) => error ? reject(error) : resolve(output)));
  const children = new Map();
  for (const line of stdout.split('\n')) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (child > 0 && parent > 0) children.set(parent, [...children.get(parent) || [], child]);
  }
  const result = [];
  for (let index = -1; index < result.length; index++) {
    for (const child of children.get(index < 0 ? pid : result[index]) || []) if (child !== process.pid && !result.includes(child)) result.push(child);
  }
  return result;
}

export function revealCommand(file) {
  if (isWindows) return { file: 'explorer.exe', args: [file] };
  if (isMacOS) return { file: 'open', args: [file] };
  return { file: 'xdg-open', args: [file] };
}

export function browserCommand(url) {
  if (isWindows) return { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (isMacOS) return { file: 'open', args: [url] };
  return { file: 'xdg-open', args: [url] };
}
