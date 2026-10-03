import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export const platform = process.platform;
export const isWindows = platform === 'win32';
export const isLinux = platform === 'linux';
export const isMacOS = platform === 'darwin';

export function shellLabel() {
  return isWindows ? 'PowerShell' : 'Shell';
}

export function shellCommand(env = process.env) {
  if (isWindows) return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] };
  const shell = env.SHELL || (isMacOS ? '/bin/zsh' : '/bin/sh');
  return { file: shell, args: [] };
}

export function commandSearchRoots(env = process.env, home = os.homedir()) {
  const roots = [];
  if (isWindows && env.APPDATA) roots.push(path.join(env.APPDATA, 'npm'));
  roots.push(path.join(home, '.opencode', 'bin'), path.join(home, '.kimi-code', 'bin'), path.join(home, '.local', 'bin'));
  return roots;
}

export function commandExtensions() {
  return isWindows ? ['.exe', '.cmd', '.bat', '.ps1', ''] : [''];
}

export function resolveCommand(name, env = process.env, home = os.homedir()) {
  if (path.isAbsolute(name) && existsSync(name)) return name;
  for (const folder of [...String(env.PATH || env.Path || '').split(path.delimiter), ...commandSearchRoots(env, home)]) {
    for (const ext of commandExtensions()) {
      const candidate = path.join(folder, name.toLowerCase().endsWith(ext) && ext ? name : name + ext);
      if (existsSync(candidate)) return candidate;
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
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* already stopped */ } }
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
