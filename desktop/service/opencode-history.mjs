import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { validSessionId } from './opencode/observer.mjs';

// OpenCode keeps every session in one SQLite store in its XDG data folder, the
// same path on Windows: ~/.local/share/opencode/opencode.db. OpenCode 1.x writes
// `session`, `message` and `part` rows; 2.x writes `session_v2` and
// `session_message` rows, and copies the 1.x sessions there when it first opens
// the store. Mr. Mak only opens it read-only, never while holding a transaction.
export const opencodeDataDir = (env = process.env, home = os.homedir()) => path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode');

let sqlite;
// node:sqlite ships unflagged from Node 22.13. Without it the chat stays terminal-only.
const database = () => sqlite ??= import('node:sqlite').then(module => module.DatabaseSync, () => null);

// The default store first; other release channels write opencode-<channel>.db.
async function stores(env, home) {
  const folder = opencodeDataDir(env, home), named = env.OPENCODE_DB;
  const files = (await readdir(folder).catch(() => [])).filter(name => /^opencode(?:-[\w.-]+)?\.db$/i.test(name))
    .sort((a, b) => Number(b === 'opencode.db') - Number(a === 'opencode.db') || a.localeCompare(b));
  return [...new Set([...(named && named !== ':memory:' ? [path.resolve(folder, named)] : []), ...files.map(name => path.join(folder, name))])];
}

// A table another OpenCode version has not created yet reads as empty.
const rows = (db, sql, ...params) => { try { return db.prepare(sql).all(...params); } catch { return []; } };
const parse = text => { try { return JSON.parse(text); } catch { return null; } };
const iso = ms => Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '';
const str = value => typeof value === 'string' ? value : '';
const each = (statement, ...params) => typeof statement.iterate === 'function' ? statement.iterate(...params) : statement.all(...params);
const modelOf = (provider, id, variant) => typeof provider === 'string' && typeof id === 'string' && provider && id
  ? { model: `${provider}/${id}`, effort: typeof variant === 'string' && variant && variant !== 'default' ? variant : null } : {};

// Images recorded as file parts: a data URL OpenCode read the file into, or a file URL.
function images(list) {
  return (Array.isArray(list) ? list : []).flatMap(file => {
    let source = file?.uri ?? file?.url ?? file?.source?.path ?? file?.path;
    if (typeof source !== 'string' || !(String(file.mime ?? file.mediaType ?? '').startsWith('image/') || source.startsWith('data:image/'))) return [];
    if (/^file:/i.test(source)) { try { source = fileURLToPath(source); } catch { return []; } }
    return source.length <= 5 * 1024 * 1024 ? [source] : [];
  });
}

// A failed reply is shown as a notice; an interruption the user asked for is not.
function failure(error) {
  if (!error || typeof error !== 'object' || /abort|interrupt|cancel/i.test(`${error.type ?? ''} ${error.name ?? ''}`)) return null;
  const detail = str(error.message) || str(error.data?.message) || str(error.type) || str(error.name);
  return detail ? `OpenCode error: ${detail}` : null;
}

// Records in the shape transcriptMessages reads for 'opencode': role, text, images,
// tool calls and the model. Reasoning is not shown, as for the other CLIs. Text
// OpenCode itself adds to the conversation is a user-turn record with a non-human
// origin, which the transcript shows as a notice.
const notice = (uuid, timestamp, text) => ({ uuid, timestamp, role: 'user', origin: { kind: 'opencode' }, text });
const toolStatus = status => status === 'completed' ? 'completed' : status === 'error' ? 'failed' : 'running';

function fromV2(row) {
  const data = parse(row.data) || {}, uuid = row.id, timestamp = iso(data.time?.created ?? row.created);
  if (row.type === 'user') return [{ uuid, timestamp, role: 'user', text: str(data.text), imageRefs: images(data.files) }];
  if (row.type === 'synthetic') return [notice(uuid, timestamp, str(data.text))];
  if (row.type === 'compaction') return data.summary ? [{ uuid, timestamp, role: 'user', isCompactSummary: true, text: str(data.summary) }] : [];
  if (row.type === 'model-switched') return [{ uuid, timestamp, ...modelOf(data.model?.providerID, data.model?.id, data.model?.variant) }];
  // `system` rows are instructions OpenCode loaded; `idle` rows mark the end of a run.
  if (row.type !== 'assistant') return [];
  const content = Array.isArray(data.content) ? data.content : [], tools = content.filter(part => part?.type === 'tool');
  const records = [{
    uuid, timestamp, role: 'assistant',
    text: content.filter(part => part?.type === 'text').map(part => str(part.text)).filter(Boolean).join('\n'),
    imageRefs: tools.flatMap(part => images(part.state?.content)),
    tools: tools.map(part => ({ id: str(part.id), name: part.name, status: toolStatus(part.state?.status), at: iso(part.time?.created) || timestamp })),
    ...modelOf(data.model?.providerID, data.model?.id, data.model?.variant),
  }];
  const error = failure(data.error);
  if (error) records.push(notice(`${uuid}-error`, iso(data.time?.completed) || timestamp, error));
  return records;
}

function fromV1(message, partRows) {
  const info = parse(message.data) || {}, uuid = message.id, timestamp = iso(info.time?.created ?? message.created);
  const parts = partRows.map(row => parse(row.data)).filter(Boolean);
  const texts = parts.filter(part => part.type === 'text' && !part.ignored), written = texts.filter(part => !part.synthetic);
  const text = written.map(part => str(part.text)).filter(Boolean).join('\n');
  if (info.role === 'user') {
    // Synthetic parts carry an attached file's contents; a turn of only synthetic text came from OpenCode.
    if (!written.length && texts.length) return [notice(uuid, timestamp, texts.map(part => str(part.text)).join('\n'))];
    return [{ uuid, timestamp, role: 'user', text, imageRefs: images(parts.filter(part => part.type === 'file')), ...modelOf(info.model?.providerID, info.model?.modelID) }];
  }
  if (info.role !== 'assistant') return [];
  if (info.summary === true) return text ? [{ uuid, timestamp, role: 'user', isCompactSummary: true, text }] : [];
  const tools = parts.filter(part => part.type === 'tool');
  const records = [{
    uuid, timestamp, role: 'assistant', text,
    imageRefs: [...images(parts.filter(part => part.type === 'file')), ...tools.flatMap(part => images(part.state?.attachments))],
    tools: tools.map(part => ({ id: str(part.callID) || str(part.id), name: part.tool, status: toolStatus(part.state?.status), at: iso(part.state?.time?.start) || timestamp })),
    ...modelOf(info.providerID, info.modelID),
  }];
  const error = failure(info.error);
  if (error) records.push(notice(`${uuid}-error`, iso(info.time?.completed) || timestamp, error));
  return records;
}

// The newest `budget` characters of stored records, like the newest 4 MB of a
// transcript file. Messages an /undo reverted are hidden, as OpenCode hides them.
function readV2(db, id, revert, budget) {
  const boundary = revert?.messageID ? rows(db, 'select seq from session_message where id = ? and session_id = ?', revert.messageID, id)[0]?.seq : undefined;
  const picked = [];
  let used = 0, truncated = false;
  for (const row of each(db.prepare('select id, type, seq, time_created as created, data from session_message where session_id = ? order by seq desc'), id)) {
    if (Number.isInteger(boundary) && row.seq >= boundary) continue;
    if (used >= budget) { truncated = true; break; }
    used += row.data.length; picked.push(row);
  }
  return { records: picked.reverse().flatMap(fromV2), truncated };
}

function readV1(db, id, revert, budget) {
  const parts = db.prepare('select id, data from part where message_id = ? order by id');
  const picked = [];
  let used = 0, truncated = false;
  for (const message of rows(db, 'select id, time_created as created, data from message where session_id = ? order by id desc', id)) {
    if (typeof revert?.messageID === 'string' && message.id >= revert.messageID) continue;
    if (used >= budget) { truncated = true; break; }
    const list = parts.all(message.id);
    used += message.data.length + list.reduce((sum, part) => sum + part.data.length, 0);
    picked.push([message, list]);
  }
  return { records: picked.reverse().flatMap(([message, list]) => fromV1(message, list)), truncated };
}

function readStore(db, file, id, previous, budget) {
  const session = rows(db, 'select time_updated as updated, revert from session_v2 where id = ?', id)[0], legacySession = rows(db, 'select time_updated as updated, revert from session where id = ?', id)[0];
  if (!session && !legacySession) return null;
  const current = rows(db, 'select count(*) as count, max(time_updated) as updated, max(seq) as seq from session_message where session_id = ?', id)[0];
  const legacy = rows(db, 'select count(*) as count, max(time_updated) as updated from message where session_id = ?', id)[0];
  const legacyParts = rows(db, 'select count(*) as count, max(time_updated) as updated from part where session_id = ?', id)[0];
  // 2.x copies a 1.x session once; a 1.x CLI that continues it writes only its own tables.
  const v1 = !session || (!!legacySession && !!legacy?.count && (!current?.count || Math.max(legacy.updated || 0, legacyParts?.updated || 0) > (current.updated || 0)));
  const owner = v1 ? legacySession || session : session || legacySession;
  const key = JSON.stringify([file, v1, current, legacy, legacyParts, owner.updated, owner.revert]);
  if (key === previous) return { key };
  const revert = parse(owner.revert);
  return { key, ...(v1 ? readV1(db, id, revert, budget) : readV2(db, id, revert, budget)) };
}

// The chat's records, or only its key when nothing changed since `previous`.
// Null when node:sqlite is missing or no store holds this session yet.
const located = new Map();
export async function readOpencodeSession(nativeId, previous, { env = process.env, home = os.homedir(), budget = 4 * 1024 * 1024 } = {}) {
  if (!validSessionId(nativeId)) return null;
  const Database = await database();
  if (!Database) return null;
  const candidates = await stores(env, home), known = located.get(nativeId);
  for (const file of candidates.includes(known) ? [known, ...candidates.filter(item => item !== known)] : candidates) {
    let db;
    try { db = new Database(file, { readOnly: true }); } catch { continue; }
    try {
      const found = readStore(db, file, nativeId, previous, budget);
      if (!found) continue;
      located.set(nativeId, file);
      if (located.size > 200) located.delete(located.keys().next().value);
      return found;
    } finally { db.close(); }
  }
  return null;
}
