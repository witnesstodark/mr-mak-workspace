import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const nativeLine = new RegExp(`^[IWEF]\\d{4} \\d{2}:\\d{2}:\\d{2}\\.\\d+\\s+\\d+ [^\\]\\r\\n]+:\\d+\\] (?:Print mode:\\s+)?(?:Created|Resuming|Streaming) conversation (${uuid})(?:[^\\w-]|$)`, 'i');
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

async function transcriptFile(nativeId, names, env, home) {
  if (!validAntigravityId(nativeId)) throw new Error('Invalid Antigravity conversation ID.');
  const roots = [
    env.ANTIGRAVITY_BRAIN_DIR,
    env.ANTIGRAVITY_HOME && path.join(env.ANTIGRAVITY_HOME, 'brain'),
    path.join(home, '.gemini', 'antigravity-cli', 'brain'),
    path.join(home, '.gemini', 'antigravity', 'brain'),
  ].filter(Boolean);
  for (const root of roots) for (const name of names) {
    const file = path.join(root, nativeId, '.system_generated', 'logs', name);
    if (await stat(file).then(s => s.isFile(), () => false)) return file;
  }
  const fallback = (env.ANTIGRAVITY_BRAIN_DIR && roots.find(r => r === env.ANTIGRAVITY_BRAIN_DIR)) || roots[0] || path.join(home, '.gemini', 'antigravity-cli', 'brain');
  return path.join(fallback, nativeId, '.system_generated', 'logs', 'transcript.jsonl');
}

// The transcript whose appended records signal turns; its fields may be shortened.
export function antigravityTranscript(nativeId, env = process.env, home = os.homedir()) {
  return transcriptFile(nativeId, ['transcript.jsonl'], env, home);
}

// agy writes each conversation twice, in step. transcript.jsonl keeps only the
// first and last 2048 bytes of a field over 4 KB, joined by "\n<truncated N bytes>\n",
// and names it in truncated_fields. A cut inside a Markdown list also drops the
// parent items, so the nested items left after it render glued to the line before.
// transcript_full.jsonl, next to it, keeps every field whole: read text from it, and
// from the shortened copy only when no full copy exists.
export function antigravityFullTranscript(nativeId, env = process.env, home = os.homedir()) {
  return transcriptFile(nativeId, ['transcript_full.jsonl', 'transcript.jsonl'], env, home);
}
