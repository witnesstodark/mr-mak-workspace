import { execFile } from 'node:child_process';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

// What the Files tab shows beside the tree: each file's state in Git with its
// changed lines, a file's diff, a folder's size map, and what the selected chat's
// agent read and wrote. Everything here only reads.
const run = promisify(execFile);
const git = (cwd, args, maxBuffer = 8 * 1024 * 1024) => run('git', ['-c', 'core.quotepath=off', '-C', cwd, ...args], { windowsHide: true, timeout: 15000, maxBuffer }).then(result => result.stdout);
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
    const [status, numstat] = await Promise.all([
      git(top, ['status', '--porcelain=v1', '-z', '-b', '--untracked-files=normal']),
      git(top, ['diff', 'HEAD', '--numstat']).catch(() => ''),
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
    const actual = path.resolve(file);
    const folder = path.dirname(actual);
    const top = await git(folder, ['rev-parse', '--show-toplevel']).then(value => value.trim(), () => '');
    if (!top) throw new Error('This file is not in a Git repository.');
    const relative = slash(path.relative(top, actual));
    let text = await git(top, ['diff', 'HEAD', '--no-color', '--', relative], 2 * 1024 * 1024).catch(() => '');
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
  async function measure(target, depth) {
    if (files >= maxFiles || Date.now() - started > maxMs || depth > 30) { complete = false; return { size: 0, files: 0 }; }
    const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
    let size = 0, count = 0;
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === '.git') continue;
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) { const inner = await measure(full, depth + 1); size += inner.size; count += inner.files; }
      else if (entry.isFile()) { files++; count++; size += (await lstat(full).catch(() => null))?.size || 0; }
    }
    return { size, files: count };
  }
  const entries = await readdir(actual, { withFileTypes: true });
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

