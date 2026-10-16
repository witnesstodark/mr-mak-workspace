import { open, readdir, realpath } from 'node:fs/promises';
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
        return { id: meta.id, cwd: meta.cwd, source: meta.source, originator: meta.originator };
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

export async function findCodexChat(session, { full = false, now = Date.now(), home = codexHome() } = {}) {
  const folders = full ? [path.join(home, 'sessions')] : recentFolders(home, [now, session.startedAt, Date.parse(session.createdAt)]);
  // Codex records getcwd(). Chats saved before working folders were stored
  // resolved may still hold a symlinked or differently normalised spelling.
  const cwds = [session.cwd];
  if (process.platform !== 'win32' && typeof session.cwd === 'string') cwds.push(await realpath(session.cwd).catch(() => session.cwd));
  const matches = [];
  for await (const file of transcriptFiles(folders, full)) {
    const meta = await readCodexMetadata(file);
    // The per-terminal owner is proof. Never substitute another recent chat in
    // the same folder, or a subagent, merely because its timestamp looks close.
    if (meta?.originator === `mrmak_chat_${session.id}` && meta.source === 'cli' && cwds.some(cwd => sameFolder(meta.cwd, cwd))) matches.push({ ...meta, file });
  }
  return matches.length === 1 ? matches[0] : null;
}

export async function codexTranscript(nativeId, { home = codexHome() } = {}) {
  if (!uuid.test(nativeId || '')) return null;
  const matches = [];
  for await (const file of transcriptFiles([path.join(home, 'sessions')], true)) {
    if (!file.toLowerCase().endsWith(`-${nativeId.toLowerCase()}.jsonl`)) continue;
    const meta = await readCodexMetadata(file);
    if (meta?.id.toLowerCase() === nativeId.toLowerCase()) matches.push(file);
  }
  return matches.length === 1 ? matches[0] : null;
}
