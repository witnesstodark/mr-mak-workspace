import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { antigravityContext, unknownContext } from './native-context.mjs';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const nativeLine = new RegExp(`^[IWEF]\\d{4} \\d{2}:\\d{2}:\\d{2}\\.\\d+\\s+\\d+ [^\\]\\r\\n]+:\\d+\\] (?:Created|Resuming) conversation (${uuid})(?: \\([^)\\r\\n]*\\))?\\s*$`, 'i');
export const validAntigravityId = value => typeof value === 'string' && new RegExp(`^${uuid}$`, 'i').test(value);

export function antigravityLogPath(stateDir, chatId) {
  if (!validAntigravityId(chatId)) throw new Error('Invalid Antigravity chat ID.');
  return path.join(stateDir, 'antigravity', `${chatId}.log`);
}

// agy 1.3.4 writes these native lifecycle messages to --log-file. Each Mr. Mak
// tab owns its log; never guess from the workspace's shared "last conversation".
// Require the native logger prefix, not a UUID echoed by a prompt or tool.
export function antigravityConversation(text) {
  let id = null;
  for (const line of text.split(/\r?\n/)) {
    const match = nativeLine.exec(line);
    if (match) id = match[1].toLowerCase();
  }
  return id;
}

export async function readAntigravityConversation(stateDir, chatId) {
  try {
    const file = await open(antigravityLogPath(stateDir, chatId), 'r');
    try {
      const { size } = await file.stat();
      const head = Buffer.alloc(Math.min(size, 64 * 1024));
      await file.read(head, 0, head.length, 0);
      if (size <= head.length) return antigravityConversation(head.toString('utf8'));
      const tail = Buffer.alloc(Math.min(size - head.length, 256 * 1024));
      await file.read(tail, 0, tail.length, size - tail.length);
      // Discard a potentially partial first line of the tail.
      const text = tail.toString('utf8');
      return antigravityConversation(text.slice(text.indexOf('\n') + 1)) || antigravityConversation(head.toString('utf8'));
    } finally { await file.close(); }
  } catch { return null; }
}

export async function prepareAntigravityLog(stateDir, chatId) {
  const file = antigravityLogPath(stateDir, chatId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '', { mode: 0o600 });
  return file;
}

export function watchAntigravity(stateDir, chatId, onConversation) {
  let closed = false, reading = false, previous = '', nativeId;
  const tick = async () => {
    if (closed || reading) return;
    reading = true;
    try {
      const info = await stat(antigravityLogPath(stateDir, chatId));
      const signature = `${info.size}:${info.mtimeMs}`;
      if (signature === previous) return;
      previous = signature;
      const id = await readAntigravityConversation(stateDir, chatId);
      if (!closed && id && id !== nativeId) { nativeId = id; onConversation(id); }
    } catch { /* Login or initial setup may not have created a conversation. */ }
    finally { reading = false; }
  };
  const timer = setInterval(tick, 400); timer.unref(); void tick();
  return () => { closed = true; clearInterval(timer); };
}

// agy keeps each conversation in its own SQLite file. Mr. Mak opens it
// read-only and reads only the context metadata of the latest generation.
export const antigravityConversationFile = (id, home = os.homedir()) => path.join(home, '.gemini', 'antigravity-cli', 'conversations', `${id}.db`);

let sqlite;
const sqliteDatabase = () => sqlite ??= import('node:sqlite').then(module => module.DatabaseSync, () => null);

export async function readAntigravityContext(file) {
  const DatabaseSync = await sqliteDatabase();
  if (!DatabaseSync) return null;
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const row = database.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx DESC LIMIT 1').get();
    return row ? { index: Number(row.idx), usage: antigravityContext(row.data) || unknownContext('antigravity', 'unavailable') } : { index: -1, usage: null };
  } finally { database.close(); }
}

// Reports the latest generation once, and again only when another becomes
// latest (a new turn or a rewind), so a reread cannot undo a reset after input.
export function watchAntigravityContext(conversation, onContext, { file = antigravityConversationFile } = {}) {
  let closed = false, reading = false, watched = null, signature = '', index = -1;
  const tick = async () => {
    const id = conversation();
    if (closed || reading || !validAntigravityId(id)) return;
    reading = true;
    try {
      if (id !== watched) { watched = id; signature = ''; index = -1; }
      if (!(await sqliteDatabase())) { stop(); onContext(unknownContext('antigravity', 'unavailable')); return; }
      // The database uses WAL: a new turn may change only the -wal file.
      const info = await stat(file(id)), wal = await stat(`${file(id)}-wal`).catch(() => null);
      const next = `${info.size}:${info.mtimeMs}:${wal?.size}:${wal?.mtimeMs}`;
      if (next === signature) return;
      const latest = await readAntigravityContext(file(id));
      signature = next;
      if (latest.index !== index && !closed && id === conversation()) { index = latest.index; onContext(latest.usage || unknownContext('antigravity')); }
    } catch { /* The CLI may not have created the file yet, or holds a write lock. */ }
    finally { reading = false; }
  };
  const stop = () => { closed = true; clearInterval(timer); };
  const timer = setInterval(tick, 1000); timer.unref(); void tick();
  return stop;
}
