import { execFile } from 'node:child_process';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

// What the Files tab shows beside the tree: each file's state in Git with its
// changed lines, a file's diff, a folder's size map, and what the selected chat's
// agent read and wrote. Everything here only reads.
const run = promisify(execFile);
// No shell, and nothing a repository's own config could run or write: no
// fsmonitor hook, no external diff or textconv driver, no index refresh lock.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, args, maxBuffer = 8 * 1024 * 1024, env = GIT_ENV) => run('git', ['--no-optional-locks', '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { windowsHide: true, timeout: 15000, maxBuffer, env }).then(result => result.stdout);
// Status and diff pass a file whose timestamp moved through its clean filter, a
// command the repository's config names. Every configured filter is blanked for
// them; the environment form carries driver names a `-c` argument cannot.
// Submodules are not entered (--ignore-submodules=dirty): their config is not read here.
async function inertEnv(top) {
  const config = await git(top, ['config', '-z', '--get-regexp', '^filter\\.']).catch(() => '');
  const names = new Set(config.split('\0').map(entry => entry.split('\n')[0]).filter(key => key.lastIndexOf('.') > 7).map(key => key.slice(7, key.lastIndexOf('.'))));
  const pairs = [...names].flatMap(name => [[`filter.${name}.clean`, ''], [`filter.${name}.smudge`, ''], [`filter.${name}.process`, ''], [`filter.${name}.required`, 'false']]);
  return { ...GIT_ENV, GIT_CONFIG_COUNT: String(pairs.length), ...Object.fromEntries(pairs.flatMap(([key, value], index) => [[`GIT_CONFIG_KEY_${index}`, key], [`GIT_CONFIG_VALUE_${index}`, value]])) };
}
const slash = value => value.replace(/\\/g, '/');

// Porcelain v1 with -z: "XY path\0", and a rename's source path after its own \0.
export function parseStatus(output) {
  const files = [], parts = output.split('\0');
  for (let index = 0; index < parts.length; index++) {
    const item = parts[index];
    if (item.length < 4) continue;
    const x = item[0], y = item[1], file = item.slice(3);
    if (x === 'R' || x === 'C') index++;
    const code = x === '?' ? 'untracked' : x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D') ? 'conflict'
      : x === 'D' || y === 'D' ? 'deleted' : x === 'A' ? 'added' : x === 'R' || x === 'C' ? 'renamed' : 'modified';
    files.push({ path: file, status: code, staged: x !== ' ' && x !== '?' });
  }
  return files;
}

// "added\tremoved\tpath"; binary files report "-".
export function parseNumstat(output) {
  const lines = new Map();
  for (const line of output.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!match) continue;
    // A rename shows as "old => new" or "dir/{old => new}/file".
    const file = match[3].replace(/\{[^}]* => ([^}]*)\}/g, '$1').replace(/^.* => /, '');
    lines.set(file, { added: match[1] === '-' ? null : Number(match[1]), removed: match[2] === '-' ? null : Number(match[2]) });
  }
  return lines;
}

// "## main...origin/main [ahead 1, behind 2]"
export function parseBranch(line) {
  const match = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/.exec(line || '');
  if (!match) return null;
  return { name: match[1], upstream: match[2] || null, ahead: Number(/ahead (\d+)/.exec(match[3] || '')?.[1] || 0), behind: Number(/behind (\d+)/.exec(match[3] || '')?.[1] || 0) };
}

export class FileInsights {
  cache = new Map();
  // The Git state of the repository holding `folder`, keyed by absolute path.
  async status(folder) {
    const actual = await realpath(path.resolve(folder));
    const top = await git(actual, ['rev-parse', '--show-toplevel']).then(value => value.trim(), () => '');
    if (!top) return { repository: null, branch: null, files: [] };
    const cached = this.cache.get(top);
    if (cached && Date.now() - cached.at < 2500) return cached.value;
    const env = await inertEnv(top);
    const [status, numstat] = await Promise.all([
      git(top, ['status', '--porcelain=v1', '-z', '-b', '--untracked-files=normal', '--ignore-submodules=dirty'], undefined, env),
      git(top, ['diff', 'HEAD', '--numstat', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty'], undefined, env).catch(() => ''),
    ]);
    const [head, ...rest] = status.split('\0');
    const lines = parseNumstat(numstat);
    const files = parseStatus(rest.join('\0')).slice(0, 5000).map(item => ({ ...item, path: path.join(top, item.path), ...(lines.get(item.path) || {}) }));
    const value = { repository: top, branch: parseBranch(head), files };
    this.cache.set(top, { at: Date.now(), value });
    if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  // One file's changes against HEAD; an untracked file is shown as all added.
  async diff(file) {
    const actual = await realpath(path.resolve(file));
    const folder = path.dirname(actual);
    const top = await git(folder, ['rev-parse', '--show-toplevel']).then(value => value.trim(), () => '');
    if (!top) throw new Error('This file is not in a Git repository.');
    const relative = slash(path.relative(top, actual));
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('This file is not in a Git repository.');
    // Past its buffer execFile fails but keeps what it read: that is the cut diff, not "no changes".
    let text = await git(top, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--', relative], 2 * 1024 * 1024, await inertEnv(top))
      .catch(error => error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && typeof error.stdout === 'string' ? error.stdout : '');
    if (!text) {
      const tracked = await git(top, ['ls-files', '--error-unmatch', '--', relative]).then(() => true, () => false);
      if (tracked) return { path: actual, name: path.basename(actual), text: '', untracked: false };
      const info = await stat(actual).catch(() => null);
      if (!info?.isFile() || info.size > 1024 * 1024) throw new Error('This file has no diff to show.');
      const body = (await readFile(actual, 'utf8')).split(/\r?\n/);
      if (body.at(-1) === '') body.pop();
      text = [`new file ${relative}`, `@@ -0,0 +1,${body.length} @@`, ...body.map(line => `+${line}`)].join('\n');
    }
    return { path: actual, name: path.basename(actual), text: text.length > 1024 * 1024 ? text.slice(0, 1024 * 1024) : text, untracked: false, truncated: text.length > 1024 * 1024 };
  }
}

// The size of each entry of a folder, its folders measured through their files.
// Bounded, so a huge tree answers with what it reached instead of hanging.
export async function folderMap(folder, { maxFiles = 40000, maxMs = 4000 } = {}) {
  const actual = await realpath(path.resolve(folder));
  const started = Date.now();
  let files = 0, complete = true;
  const spent = () => files >= maxFiles || Date.now() - started > maxMs;
  async function measure(target, depth) {
    if (spent() || depth > 30) { complete = false; return { size: 0, files: 0 }; }
    const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
    let size = 0, count = 0;
    for (const entry of entries) {
      // Checked per entry too: one flat folder can hold far more files than the limit.
      if (spent()) { complete = false; break; }
      if (entry.isSymbolicLink() || entry.name === '.git') continue;
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) { const inner = await measure(full, depth + 1); size += inner.size; count += inner.files; }
      else if (entry.isFile()) { files++; count++; size += (await lstat(full).catch(() => null))?.size || 0; }
    }
    return { size, files: count };
  }
  const entries = await readdir(actual, { withFileTypes: true });
  if (entries.length > 400) complete = false;
  const children = [];
  for (const entry of entries.slice(0, 400)) {
    if (entry.isSymbolicLink() || entry.name === '.git') continue;
    const full = path.join(actual, entry.name);
    if (entry.isDirectory()) children.push({ name: entry.name, path: full, directory: true, ...await measure(full, 1) });
    else if (entry.isFile()) { files++; children.push({ name: entry.name, path: full, directory: false, size: (await lstat(full).catch(() => null))?.size || 0, files: 1 }); }
  }
  children.sort((a, b) => b.size - a.size);
  return { path: actual, name: path.basename(actual), parent: path.dirname(actual), size: children.reduce((sum, item) => sum + item.size, 0), children, complete };
}

// The files an agent read and wrote, newest last, from its transcript records.
// Claude names them in its tools; Codex names the files its patches change.
const READS = new Set(['Read', 'NotebookRead']), WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export function fileActivity(records, agent, cwd) {
  const events = [];
  const add = (file, kind, at) => { if (typeof file === 'string' && file.trim() && file.length < 1000) events.push({ path: path.resolve(cwd, file.trim()), kind, at: at || '' }); };
  for (const record of records) {
    if (record.isSidechain) continue;
    if (agent === 'claude') for (const part of Array.isArray(record.message?.content) ? record.message.content : []) {
      if (part?.type !== 'tool_use') continue;
      const input = part.input || {}, name = String(part.name || '');
      if (READS.has(name)) add(input.file_path || input.notebook_path, 'read', record.timestamp);
      else if (WRITES.has(name)) add(input.file_path || input.notebook_path, 'write', record.timestamp);
    }
    const payload = record.payload;
    if (agent === 'codex' && record.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(payload?.type)) {
      const patch = typeof payload.input === 'string' ? payload.input : typeof payload.arguments === 'string' ? payload.arguments : '';
      for (const match of patch.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n\\"]+)/g)) add(match[1], 'write', record.timestamp);
    }
  }
  return events.slice(-80);
}

