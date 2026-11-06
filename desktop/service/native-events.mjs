import { open, stat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { nativeContext, unknownContext } from './native-context.mjs';

export function completedTurn(record, agent) {
  if (agent === 'codex' && record.type === 'event_msg' && record.payload?.type === 'task_complete') return { kind: 'turn-completed', id: record.payload.turn_id, text: 'The agent finished its turn. Review the result.', preview: String(record.payload.last_agent_message || '').slice(-350) };
  // Claude writes thinking and text as separate records with the same message ID
  // and stop reason. Only the actual final answer creates a completion notice.
  if (agent === 'claude' && !record.isSidechain && record.type === 'assistant' && record.message?.stop_reason === 'end_turn' && record.message.content?.some(item => item.type === 'text')) return { kind: 'turn-completed', id: record.message.id, text: 'The agent finished its turn. Review the result.', preview: record.message.content.filter(item => item.type === 'text').map(item => item.text).join('\n').slice(-350) };
  if (agent === 'claude' && !record.isSidechain && record.type === 'system' && record.subtype === 'api_error') return { kind: 'attention', text: 'The agent reported an API error.' };
  return null;
}

export function nativeActivity(record, agent) {
  const completed = completedTurn(record, agent);
  if (completed) return completed;
  if (agent === 'codex' && record.type === 'event_msg') {
    if (record.payload?.type === 'task_started') return { kind: 'turn-started' };
    if (record.payload?.type === 'turn_aborted') return { kind: 'turn-interrupted' };
  }
  if (agent === 'claude' && !record.isSidechain) {
    if (record.type === 'user' && !record.isMeta) {
      const content = record.message?.content;
      const interrupted = value => typeof value === 'string' && value.startsWith('[Request interrupted by user');
      if (interrupted(content) || Array.isArray(content) && content.some(item => item.type === 'text' && interrupted(item.text))) return { kind: 'turn-interrupted' };
      // Tool results also confirm ongoing work; file snapshots and metadata do not.
      if (content) return { kind: 'turn-started' };
    }
    if (record.type === 'assistant' && record.message?.stop_reason !== 'end_turn') return { kind: 'turn-started' };
  }
  return null;
}

// Only read records appended after this managed session starts. These files belong
// to the native CLI; MR-MAK never modifies them or replaces the user's hooks.
export function tailNativeFile(file, agent, onEvent, from = 0) {
  let offset = from, partial = '', closed = false, reading = false, decoder = new StringDecoder('utf8');
  let hydrate = from > 0, unavailable = false;
  const reset = reason => { if (!closed) onEvent({ kind: 'context-usage', usage: unknownContext(agent, reason) }); };
  const tick = async () => {
    if (closed || reading) return;
    reading = true;
    try {
      const info = await stat(file);
      unavailable = false;
      if (info.size < offset) { offset = 0; partial = ''; decoder = new StringDecoder('utf8'); hydrate = false; reset('waiting'); }
      if (hydrate) {
        // Restore only context before the launch boundary. Historic activity must
        // not become an unread completion on resume. Keep the read bounded.
        const start = Math.max(0, offset - 4 * 1024 * 1024);
        const handle = await open(file, 'r');
        let latest = null;
        try {
          const buffer = Buffer.alloc(offset - start);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
          const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
          if (start) lines.shift();
          lines.pop(); // Ignore a partial record at the launch boundary.
          for (const line of lines) { try { latest = nativeContext(JSON.parse(line), agent) || latest; } catch { /* Ignore invalid records. */ } }
        } finally { await handle.close(); }
        if (latest && !closed) onEvent(latest);
        hydrate = false;
      }
      if (info.size === offset) return;
      if (info.size - offset > 4 * 1024 * 1024) { offset = info.size - 4 * 1024 * 1024; partial = ''; decoder = new StringDecoder('utf8'); reset('waiting'); }
      const handle = await open(file, 'r');
      try {
        const buffer = Buffer.alloc(info.size - offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        offset += bytesRead;
        const lines = (partial + decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        partial = lines.pop() || '';
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            const context = nativeContext(record, agent);
            if (context && !closed) onEvent(context);
            const event = nativeActivity(record, agent);
            if (event && !closed) onEvent(event);
          } catch { /* Partial records are ignored, never guessed. */ }
        }
      } finally { await handle.close(); }
    } catch { if (!unavailable) reset('unavailable'); unavailable = true; /* CLI may not have created its transcript yet. */ }
    finally { reading = false; }
  };
  const timer = setInterval(tick, 400); timer.unref(); tick();
  return () => { closed = true; clearInterval(timer); };
}

export async function claudeTranscript(cwd, nativeId) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const folders = await readdir(root).catch(() => []);
  // Claude names the folder after getcwd(). Chats saved before working folders
  // were stored resolved may hold a symlinked or differently normalised spelling.
  const spellings = [cwd];
  if (process.platform !== 'win32') spellings.push(await realpath(cwd).catch(() => cwd));
  for (const spelling of spellings) {
    const escaped = spelling.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const folder = folders.find(item => item.toLowerCase() === escaped);
    if (folder) return path.join(root, folder, `${nativeId}.jsonl`);
  }
  return path.join(root, spellings.at(-1).replace(/[^a-zA-Z0-9]/g, '-'), `${nativeId}.jsonl`);
}

export { codexTranscript } from './codex-history.mjs';
