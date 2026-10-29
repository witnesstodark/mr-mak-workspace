import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const nativeLine = new RegExp(`^[IWEF]\\d{4} \\d{2}:\\d{2}:\\d{2}\\.\\d+\\s+\\d+ [^\\]\\r\\n]+:\\d+\\] (?:Created|Resuming) conversation (${uuid})\\s*$`, 'i');
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
// read-only and reads only the latest step.
export const antigravityConversationFile = (id, home = os.homedir()) => path.join(home, '.gemini', 'antigravity-cli', 'conversations', `${id}.db`);

let sqlite;
const sqliteDatabase = () => sqlite ??= import('node:sqlite').then(module => module.DatabaseSync, () => null);

// Reads protobuf wire format into field number -> values (numbers or bytes).
// Malformed data returns null, so a changed schema stays unknown.
function protobuf(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  const fields = new Map();
  let offset = 0;
  const varint = () => {
    let value = 0;
    for (let shift = 0; shift < 70; shift += 7) {
      if (offset >= bytes.length) throw new Error('Truncated varint');
      const byte = bytes[offset++];
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return value;
    }
    throw new Error('Invalid varint');
  };
  try {
    while (offset < bytes.length) {
      const key = varint(), field = Math.floor(key / 8), type = key % 8;
      if (field < 1) return null;
      let value;
      if (type === 0) value = varint();
      else if (type === 2) { const length = varint(); if (offset + length > bytes.length) return null; value = bytes.subarray(offset, offset + length); offset += length; }
      else if (type === 1 || type === 5) { offset += type === 1 ? 8 : 4; if (offset > bytes.length) return null; continue; }
      else return null;
      fields.set(field, [...(fields.get(field) || []), value]);
    }
  } catch { return null; }
  return fields;
}

// agy 1.4.7 stores a model step with its planner response in field 20: the
// reply text in field 1 and each tool call in field 7.
export function antigravityReply(payload) {
  const value = protobuf(payload)?.get(20)?.at(-1), response = value instanceof Uint8Array ? protobuf(value) : null;
  if (!response) return null;
  const text = response.get(1)?.at(-1);
  return { text: text instanceof Uint8Array ? Buffer.from(text).toString('utf8') : '', toolCalls: response.get(7)?.length || 0 };
}

// Step types and the done status in agy 1.4.7. Other step types are ignored.
const userStep = 14, modelStep = 15, toolStep = 132, doneStatus = 3, stoppedStatuses = [6, 7];

// A turn ends with a finished model step that calls no tool, and stops with a
// cancelled or failed step. Any other latest step means the agent works.
export async function readAntigravityTurn(file) {
  const DatabaseSync = await sqliteDatabase();
  if (!DatabaseSync) return null;
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const row = database.prepare(`SELECT idx, step_type, status, step_payload FROM steps WHERE step_type IN (${userStep}, ${modelStep}, ${toolStep}) ORDER BY idx DESC LIMIT 1`).get();
    if (!row) return null;
    const step = Number(row.idx), reply = row.step_type === modelStep && row.status === doneStatus ? antigravityReply(row.step_payload) : null;
    if (reply && !reply.toolCalls) return { kind: 'turn-completed', step, reply: reply.text };
    return { kind: stoppedStatuses.includes(row.status) ? 'turn-interrupted' : 'turn-started', step };
  } finally { database.close(); }
}

// Reports each change of the bound conversation's turn state. The state of a
// conversation bound at start is history, so a resumed chat does not report it.
export function watchAntigravityTurns(conversation, onTurn, { file = antigravityConversationFile } = {}) {
  const initial = conversation();
  let closed = false, reading = false, watched = null, signature = '', last;
  const tick = async () => {
    const id = conversation();
    if (closed || reading || !validAntigravityId(id)) return;
    reading = true;
    try {
      if (id !== watched) { watched = id; signature = ''; last = id === initial ? null : ''; }
      if (!(await sqliteDatabase())) { stop(); return; }
      const info = await stat(file(id)), wal = await stat(`${file(id)}-wal`).catch(() => null);
      const next = `${info.size}:${info.mtimeMs}:${wal?.size}:${wal?.mtimeMs}`;
      if (next === signature) return;
      const turn = await readAntigravityTurn(file(id));
      signature = next;
      if (!turn || closed || id !== conversation()) return;
      const key = `${turn.kind}:${turn.step}`;
      if (last === null) last = key;
      else if (key !== last) { last = key; onTurn({ ...turn, id: `${id}:${turn.step}` }); }
    } catch { /* The CLI may not have created the file yet, or holds a write lock. */ }
    finally { reading = false; }
  };
  const stop = () => { closed = true; clearInterval(timer); };
  const timer = setInterval(tick, 1000); timer.unref(); void tick();
  return stop;
}
