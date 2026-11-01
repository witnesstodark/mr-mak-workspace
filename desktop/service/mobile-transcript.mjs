import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { imageReferences } from './conversation-media.mjs';
import { claudeTranscript, codexTranscript } from './native-events.mjs';
import { clean, questionItems, questionKey } from './claude-questions.mjs';

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
const plain = value => value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
const shorten = (value, limit) => value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
const SUMMARY_FIELDS = ['command', 'description', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'skill', 'prompt', 'cmd'];

// A tool call as the terminal shows it: name, its main argument, the input and
// the start of its result. Long values are cut; reasoning is never included.
function toolCall(id, name, input, at) {
  let parsed = input;
  if (typeof input === 'string') { try { parsed = JSON.parse(input); } catch { parsed = input; } }
  const field = typeof parsed === 'object' && parsed ? SUMMARY_FIELDS.map(key => parsed[key]).find(value => (typeof value === 'string' && value.trim()) || (Array.isArray(value) && value.length)) : parsed;
  const summary = plain(Array.isArray(field) ? field.join(' ') : typeof field === 'string' ? field : '').replace(/\s+/g, ' ').trim();
  const tool = { name: String(name || 'Tool').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80), summary: shorten(summary, 200), status: 'running' };
  if (tool.name === 'AskUserQuestion') tool.questions = questionItems(parsed);
  else if (parsed !== undefined && parsed !== '') tool.input = shorten(plain(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2) || ''), 1200);
  return { id, role: 'tool', text: '', at: at || '', tool };
}
function settleTool(message, { failed = false, output, answers }) {
  message.tool.status = failed ? 'failed' : 'completed';
  if (answers && typeof answers === 'object') message.tool.answers = Object.fromEntries(Object.entries(answers).slice(0, 8).map(([question, answer]) => [clean(question, 2000), clean(String(answer), 4000)]));
  let text = output;
  if (typeof text === 'string') { try { const value = JSON.parse(text); if (typeof value?.output === 'string') text = value.output; } catch { /* Plain output. */ } }
  text = typeof text === 'string' ? text : textParts(text);
  if (text?.trim() && !(message.tool.questions && !failed)) message.tool.result = shorten(plain(text).trim(), 600);
}

export function transcriptMessages(records, agent) {
  const messages = [], tools = new Map();
  // Codex event messages avoid showing injected environment/instruction records.
  const hasCodexEvents = records.some(item => item.type === 'event_msg' && ['user_message', 'agent_message'].includes(item.payload?.type));
  for (const item of records) {
    let role, text, content, imageRefs = [];
    const calls = [];
    if (agent === 'claude' && !item.isSidechain && !item.isMeta && ['user', 'assistant'].includes(item.type) && Array.isArray(item.message?.content)) {
      for (const part of item.message.content) {
        if (item.type === 'assistant' && part?.type === 'tool_use' && typeof part.id === 'string' && !tools.has(part.id)) { const call = toolCall(part.id, part.name, part.input, item.timestamp); tools.set(part.id, call); calls.push(call); }
        if (item.type === 'user' && part?.type === 'tool_result' && tools.has(part.tool_use_id)) settleTool(tools.get(part.tool_use_id), { failed: part.is_error === true, output: part.content, answers: item.toolUseResult?.answers });
      }
    }
    const p = item.payload;
    if (agent === 'codex' && item.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(p?.type) && typeof p.call_id === 'string' && !tools.has(p.call_id)) {
      const call = toolCall(p.call_id, p.name, p.type === 'function_call' ? p.arguments : p.input, item.timestamp); tools.set(p.call_id, call); calls.push(call);
    }
    if (agent === 'codex' && item.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(p?.type) && tools.has(p.call_id)) settleTool(tools.get(p.call_id), { output: p.output });
    const placeCalls = () => { for (const call of calls) messages.push(call); };
    if (agent === 'codex' && hasCodexEvents && item.type === 'event_msg') {
      if (item.payload?.type === 'user_message') { role = 'user'; text = item.payload.message; imageRefs = [...(item.payload.local_images || []), ...(item.payload.images || [])].filter(value => typeof value === 'string').slice(0, 12); }
      if (item.payload?.type === 'agent_message') { role = 'assistant'; text = item.payload.message; }
    } else if (agent === 'codex' && !hasCodexEvents && item.type === 'response_item' && item.payload?.type === 'message') {
      role = item.payload.role; content = item.payload.content; text = textParts(content);
    } else if (agent === 'claude' && !item.isSidechain && !item.isMeta && ['user', 'assistant'].includes(item.type)) {
      role = item.type; content = item.message?.content; text = textParts(content);
      if (Array.isArray(content) && content.some(part => part.type === 'tool_result')) role = 'assistant';
    }
    if (agent === 'codex' && hasCodexEvents && item.type === 'response_item' && item.payload?.type === 'message' && item.payload.role === 'assistant') { role = 'assistant'; text = ''; content = item.payload.content; }
    if (agent === 'codex' && item.type === 'response_item' && item.payload?.type === 'function_call_output') {
      let output = item.payload.output;
      if (typeof output === 'string') { try { output = JSON.parse(output); } catch { output = null; } }
      content = Array.isArray(output) ? output : output?.content;
      role = 'assistant'; text = '';
    }
    text = typeof text === 'string' ? text : '';
    imageRefs = [...new Set([...imageRefs, ...imageReferences(content, text || '')])].slice(0, 12);
    if (!['user', 'assistant'].includes(role) || (!text?.trim() && !imageRefs.length)) { placeCalls(); continue; }
    const at = item.timestamp || '';
    const id = item.uuid || createHash('sha256').update(`${at}:${role}:${text}:${imageRefs.join(";")}`).digest('hex').slice(0, 24);
    // Streaming revisions of a Claude message have the same message ID.
    const nativeId = item.message?.id;
    const previous = nativeId && messages.findIndex(message => message.nativeId === nativeId);
    const message = { id, role, text: text.slice(0, 100000), at, nativeId, ...(imageRefs.length ? { imageRefs } : {}) };
    if (typeof previous === 'number' && previous >= 0) messages[previous] = message;
    else messages.push(message);
    placeCalls();
  }
  return messages.slice(-160).map(({ nativeId: _nativeId, ...message }) => message);
}

// Questions still waiting for the user: Claude's open AskUserQuestion calls
// after the last written message, joined with the hooks that can take an answer
// from the phone. A question with no waiting hook is answered in the terminal.
export function pendingQuestions(messages, waiting = [], running = true) {
  if (!running) return [];
  const last = messages.findLastIndex(message => message.role !== 'tool');
  const open = messages.slice(last + 1).filter(message => message.tool?.name === 'AskUserQuestion' && message.tool.status === 'running' && message.tool.questions?.length);
  const used = new Set(), result = [];
  for (const message of open) {
    const live = waiting.find(item => item.key === questionKey(message.tool.questions) && !used.has(item.id));
    if (live) used.add(live.id);
    result.push({ id: live?.id || `tool-${message.id}`, at: message.at, questions: message.tool.questions, answerable: !!live });
  }
  // A subagent's question is not in the main transcript; its hook still is.
  for (const item of waiting) if (!used.has(item.id)) result.push({ id: item.id, at: item.at, questions: item.questions, answerable: true });
  return result;
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
