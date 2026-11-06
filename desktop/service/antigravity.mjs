import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
