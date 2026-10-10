import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { claudeTranscript, codexTranscript } from './native-events.mjs';

export function transcriptActivity(records, agent) {
  const tools = new Map();
  for (const record of records) {
    if (record.isSidechain || record.isMeta) continue;
    if (agent === 'claude') for (const part of Array.isArray(record.message?.content) ? record.message.content : []) {
      if (part.type === 'tool_use' && typeof part.id === 'string') tools.set(part.id, { id: part.id, name: String(part.name || 'Tool').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80), status: 'running', at: record.timestamp || '' });
      if (part.type === 'tool_result' && tools.has(part.tool_use_id)) Object.assign(tools.get(part.tool_use_id), { status: part.is_error ? 'failed' : 'completed', at: record.timestamp || '' });
    }
    const p = record.payload;
    if (agent === 'codex' && record.type === 'response_item') {
      if (p?.type === 'function_call' && typeof p.call_id === 'string') tools.set(p.call_id, { id: p.call_id, name: String(p.name || 'Tool').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80), status: 'running', at: record.timestamp || '' });
      if (p?.type === 'function_call_output' && tools.has(p.call_id)) Object.assign(tools.get(p.call_id), { status: 'completed', at: record.timestamp || '' });
    }
  }
  return [...tools.values()].slice(-8);
}

const textParts = content => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => ['text', 'input_text', 'output_text'].includes(part?.type)).map(part => part.text || '').join('\n') : '';

export function transcriptMessages(records, agent) {
  const messages = [];
  // Codex event messages avoid showing injected environment/instruction records.
  const hasCodexEvents = records.some(item => item.type === 'event_msg' && ['user_message', 'agent_message'].includes(item.payload?.type));
  for (const item of records) {
    let role, text;
    if (agent === 'codex' && hasCodexEvents && item.type === 'event_msg') {
      if (item.payload?.type === 'user_message') { role = 'user'; text = item.payload.message; }
      if (item.payload?.type === 'agent_message') { role = 'assistant'; text = item.payload.message; }
    } else if (agent === 'codex' && !hasCodexEvents && item.type === 'response_item' && item.payload?.type === 'message') {
      role = item.payload.role; text = textParts(item.payload.content);
    } else if (agent === 'claude' && !item.isSidechain && !item.isMeta && ['user', 'assistant'].includes(item.type)) {
      role = item.type; text = textParts(item.message?.content);
    }
    if (!['user', 'assistant'].includes(role) || typeof text !== 'string' || !text.trim()) continue;
    const at = item.timestamp || '';
    const id = item.uuid || createHash('sha256').update(`${at}:${role}:${text}`).digest('hex').slice(0, 24);
    // Streaming revisions of a Claude message have the same message ID.
    const nativeId = item.message?.id;
    const previous = nativeId && messages.findIndex(message => message.nativeId === nativeId);
    const message = { id, role, text: text.slice(0, 100000), at, nativeId };
    if (typeof previous === 'number' && previous >= 0) messages[previous] = message;
    else messages.push(message);
  }
  return messages.slice(-100).map(({ nativeId: _nativeId, ...message }) => message);
}

export class MobileTranscripts {
  cache = new Map();
  async read(session) {
    if (!['codex', 'claude'].includes(session.agent) || !session.nativeId) return { supported: false, messages: [] };
    const file = session.agent === 'claude' ? await claudeTranscript(session.cwd, session.nativeId) : await codexTranscript(session.nativeId);
    if (!file) return { supported: false, messages: [] };
    try {
      const info = await stat(file);
      const cached = this.cache.get(session.id);
      if (cached?.size === info.size && cached?.mtime === info.mtimeMs) return cached.value;
      const handle = await open(file, 'r');
      let text, truncated = info.size > 4 * 1024 * 1024;
      try {
        const size = Math.min(info.size, 4 * 1024 * 1024), buffer = Buffer.alloc(size);
        await handle.read(buffer, 0, size, info.size - size);
        text = buffer.toString('utf8');
      } finally { await handle.close(); }
      if (truncated) text = text.slice(text.indexOf('\n') + 1);
      const records = text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const value = { supported: true, messages: transcriptMessages(records, session.agent), activity: transcriptActivity(records, session.agent), truncated };
      this.cache.set(session.id, { size: info.size, mtime: info.mtimeMs, value });
      if (this.cache.size > 25) this.cache.delete(this.cache.keys().next().value);
      return value;
    } catch { return { supported: false, messages: [] }; }
  }
}
