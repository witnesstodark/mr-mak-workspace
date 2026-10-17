import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const sameFolder = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).replaceAll('\\', '/').toLowerCase() === path.resolve(b).replaceAll('\\', '/').toLowerCase();

// Metadata can contain large instructions. Read the whole first record, bounded,
// without loading the transcript or accepting a partially written JSON record.
export async function readCodexMetadata(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const chunks = [];
    for (let offset = 0; offset < 2 * 1024 * 1024;) {
      const buffer = Buffer.alloc(16384);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) return null;
      const end = buffer.subarray(0, bytesRead).indexOf(10);
      chunks.push(buffer.subarray(0, end < 0 ? bytesRead : end));
      if (end >= 0) {
        const record = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
        const meta = record.payload;
        if (record.type !== 'session_meta' || !uuid.test(meta?.id || '')) return null;
        return { id: meta.id, cwd: meta.cwd, source: meta.source, originator: meta.originator, threadSource: meta.thread_source, historyBase: meta.history_base };
      }
      offset += bytesRead;
    }
  } catch { /* Missing, migrating or incomplete metadata can be retried. */ }
  finally { await handle?.close(); }
  return null;
}

function recentFolders(home, timestamps) {
  const folders = new Set();
  for (const timestamp of timestamps) {
    if (!Number.isFinite(timestamp)) continue;
    // Codex uses local calendar dates. Include UTC and adjacent dates too, so
    // midnight, time-zone changes and long-running terminals cannot hide a chat.
    for (const day of [-1, 0, 1]) {
      const date = new Date(timestamp + day * 86400000);
      const local = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')];
      folders.add(path.join(home, 'sessions', ...local.map(String)));
      folders.add(path.join(home, 'sessions', ...date.toISOString().slice(0, 10).split('-')));
    }
  }
  return [...folders];
}

async function* transcriptFiles(folders, recursive) {
  const pending = [...folders];
  while (pending.length) {
    const folder = pending.pop();
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(folder, entry.name);
      if (recursive && entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield file;
    }
  }
}

// The per-terminal owner is proof. Never substitute another recent chat in the
// same folder, or a subagent, merely because its timestamp looks close.
const ownedBy = (meta, session) => meta?.originator === `mrmak_chat_${session.id}` && meta.source === 'cli' && (meta.threadSource ?? 'user') === 'user' && sameFolder(meta.cwd, session.cwd);
const byName = (a, b) => path.basename(a).toLowerCase().localeCompare(path.basename(b).toLowerCase());

export async function findCodexChat(session, { full = false, now = Date.now(), home = codexHome() } = {}) {
  const folders = full ? [path.join(home, 'sessions')] : recentFolders(home, [now, session.startedAt, Date.parse(session.createdAt)]);
  const matches = [];
  for await (const file of transcriptFiles(folders, full)) {
    const meta = await readCodexMetadata(file);
    if (ownedBy(meta, session)) matches.push({ ...meta, file });
  }
  // Rewind segments share their thread's ID; two different threads are ambiguous.
  if (new Set(matches.map(match => match.id.toLowerCase())).size !== 1) return null;
  return matches.sort((a, b) => byName(a.file, b.file)).at(-1);
}

// A Codex thread is its rollout file plus one file per rewind, named
// `…-<thread>_<segment>.jsonl`, which continues the previous segment's history up
// to its `history_base`. Oldest first; empty unless the original file is unique.
export async function codexSegments(nativeId, { home = codexHome() } = {}) {
  if (!uuid.test(nativeId || '')) return [];
  const id = nativeId.toLowerCase(), segment = new RegExp(`-${id}_[a-f0-9-]{36}\\.jsonl$`);
  const files = [];
  for await (const file of transcriptFiles([path.join(home, 'sessions')], true)) {
    const name = path.basename(file).toLowerCase();
    if (!name.endsWith(`-${id}.jsonl`) && !segment.test(name)) continue;
    const meta = await readCodexMetadata(file);
    if (meta?.id.toLowerCase() === id) files.push(file);
  }
  return files.filter(file => path.basename(file).toLowerCase().endsWith(`-${id}.jsonl`)).length === 1 ? files.sort(byName) : [];
}

export async function codexTranscript(nativeId, options) {
  return (await codexSegments(nativeId, options)).at(-1) || null;
}

// A rollout this chat's terminal started after `current`: a rewind segment of the
// same thread, or another thread from /new. Only today's folders are listed, and
// each new file's metadata is read once.
const metadataCache = new Map();
export async function newerCodexRollout(session, current, { now = Date.now(), home = codexHome() } = {}) {
  let newest = null;
  for await (const file of transcriptFiles(recentFolders(home, [now]), false)) {
    if (byName(file, newest?.file || current) <= 0) continue;
    let meta = metadataCache.get(file);
    if (!meta) {
      meta = await readCodexMetadata(file);
      if (!meta) continue;
      metadataCache.set(file, meta);
      if (metadataCache.size > 1000) metadataCache.delete(metadataCache.keys().next().value);
    }
    if (ownedBy(meta, session)) newest = { ...meta, file };
  }
  return newest;
}

// Folders where Codex ran recently, newest first. Bounded: only the latest day
// folders and files are opened, and only each file's first metadata record is read.
export async function codexProjects({ home = codexHome(), days = 60, files = 400 } = {}) {
  const names = async folder => (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).map(entry => entry.name).sort().reverse();
  const folders = [];
  for (const year of await names(path.join(home, 'sessions')))
    for (const month of await names(path.join(home, 'sessions', year)))
      for (const day of await names(path.join(home, 'sessions', year, month))) {
        if (folders.length >= days) break;
        folders.push(path.join(home, 'sessions', year, month, day));
      }
  const projects = new Map();
  let opened = 0;
  for (const folder of folders) {
    const transcripts = (await readdir(folder).catch(() => [])).filter(name => name.endsWith('.jsonl')).sort().reverse();
    for (const name of transcripts) {
      if (opened++ >= files) return [...projects.values()];
      const meta = await readCodexMetadata(path.join(folder, name));
      // File names begin rollout-YYYY-MM-DDTHH-MM-SS; newest files are read first.
      const stamp = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(name);
      if (typeof meta?.cwd === 'string' && !projects.has(meta.cwd)) projects.set(meta.cwd, { path: meta.cwd, source: 'codex', at: stamp ? new Date(`${stamp[1]}T${stamp[2]}:${stamp[3]}:${stamp[4]}`).toISOString() : null });
    }
  }
  return [...projects.values()];
}
