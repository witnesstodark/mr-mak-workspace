import { open, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { questionItems, questionKey } from './claude-questions.mjs';

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
    const content = record.message?.content;
    const parts = Array.isArray(content) ? content : [];
    if (record.type === 'user' && !record.isMeta) {
      const interrupted = value => typeof value === 'string' && value.startsWith('[Request interrupted by user');
      const toolResults = parts.filter(item => item.type === 'tool_result' && typeof item.tool_use_id === 'string').map(item => item.tool_use_id);
      if (interrupted(content) || parts.some(item => item.type === 'text' && interrupted(item.text))) return { kind: 'turn-interrupted', ...(toolResults.length ? { toolResults } : {}) };
      // Tool results also confirm ongoing work; file snapshots and metadata do not.
      if (content) return { kind: 'turn-started', ...(toolResults.length ? { toolResults } : {}) };
    }
    if (record.type === 'assistant' && record.message?.stop_reason !== 'end_turn') {
      // The question dialog waits for the user, so the chat needs an answer.
      const ask = parts.find(item => item.type === 'tool_use' && item.name === 'AskUserQuestion');
      const items = ask ? questionItems(ask.input) : [];
      if (items.length) return { kind: 'question', toolUseId: ask.id, key: questionKey(items), text: 'Claude is asking you a question.' };
      return { kind: 'turn-started' };
    }
  }
  return null;
}

// Only read records appended after this managed session starts. These files belong
// to the native CLI; IAAR never modifies them or replaces the user's hooks.
export function tailNativeFile(file, agent, onEvent, from = 0) {
  let offset = from, partial = '', closed = false, reading = false, decoder = new StringDecoder('utf8');
  const tick = async () => {
    if (closed || reading) return;
    reading = true;
    try {
      const info = await stat(file);
      if (info.size < offset) { offset = 0; partial = ''; decoder = new StringDecoder('utf8'); }
      if (info.size === offset) return;
      if (info.size - offset > 4 * 1024 * 1024) { offset = info.size - 4 * 1024 * 1024; partial = ''; decoder = new StringDecoder('utf8'); }
      const handle = await open(file, 'r');
      try {
        const buffer = Buffer.alloc(info.size - offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        offset += bytesRead;
        const lines = (partial + decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        partial = lines.pop() || '';
        for (const line of lines) {
          try { const event = nativeActivity(JSON.parse(line), agent); if (event && !closed) onEvent(event); } catch { /* Partial records are ignored, never guessed. */ }
        }
      } finally { await handle.close(); }
    } catch { /* CLI may not have created its transcript yet. */ }
    finally { reading = false; }
  };
  const timer = setInterval(tick, 400); timer.unref(); tick();
  return () => { closed = true; clearInterval(timer); };
}

export async function claudeTranscript(cwd, nativeId) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const escaped = cwd.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const folders = await readdir(root).catch(() => []);
  const folder = folders.find(item => item.toLowerCase() === escaped) || cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(root, folder, `${nativeId}.jsonl`);
}

export { codexTranscript } from './codex-history.mjs';
