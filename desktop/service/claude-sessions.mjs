import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { claudeProjectFolder, claudeTranscript } from './native-events.mjs';
import { ClaudePlans } from './claude-plan.mjs';
import { systemEvent, unwrapPastes } from './mobile-transcript.mjs';

// The Session Rail lists a folder's Claude Code conversations from the first and
// last part of each transcript, so a 40 MB conversation costs what a short one does.
const EDGE = 128 * 1024, LIMIT = 40;

// Mr. Mak appends Workspace metadata to a prompt; it is not what the person wrote.
export const promptPreview = (text, max = 240) => String(text || '').replace(/\s*<mrmak_workspace_context>[\s\S]*?(?:<\/mrmak_workspace_context>|$)/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

// History imports need an English chat name; Claude titles are often in another language.
const chatName = value => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);

const records = text => text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });

// What the person typed: not a tool result, a compact summary or CLI bookkeeping.
function promptText(record) {
  if (record?.type !== 'user' || record.isSidechain || record.isMeta || record.isCompactSummary) return '';
  const content = record.message?.content;
  if (Array.isArray(content) && content.some(part => part?.type === 'tool_result')) return '';
  const text = unwrapPastes(typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n') : '');
  return text && systemEvent(text, record.origin) === null ? text : '';
}

// A title the person gave with /rename wins over Claude's generated title.
export function sessionSummary(head, tail) {
  const found = {};
  for (const record of [...tail].reverse().concat([...head].reverse())) {
    if (record.type === 'custom-title' && typeof record.customTitle === 'string') found.custom ??= record.customTitle;
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') found.ai ??= record.aiTitle;
    if (record.type === 'summary' && typeof record.summary === 'string') found.summary ??= record.summary;
    if (record.type === 'last-prompt' && typeof record.lastPrompt === 'string') found.last ??= record.lastPrompt;
  }
  const lastPrompt = [...tail].reverse().map(promptText).find(Boolean) || found.last || '';
  const firstPrompt = head.map(promptText).find(Boolean) || '';
  const reply = [...tail].reverse().find(record => record.type === 'assistant' && !record.isSidechain && record.message?.usage);
  const usage = reply?.message.usage;
  const contextTokens = usage ? (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0) : null;
  const title = promptPreview(found.custom || found.ai || found.summary, 120) || promptPreview(firstPrompt || lastPrompt, 120);
  return { title: title || 'Untitled conversation', firstPrompt: promptPreview(firstPrompt), lastPrompt: promptPreview(lastPrompt), contextTokens, model: typeof reply?.message.model === 'string' ? reply.message.model : null };
}

async function readEdges(file, size) {
  const handle = await open(file, 'r');
  try {
    const read = async (start, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead).toString('utf8');
    };
    if (size <= EDGE * 2) { const all = records(await read(0, size)); return { head: all, tail: all }; }
    // Each edge drops the record it cut through.
    const head = await read(0, EDGE), tail = await read(size - EDGE, EDGE);
    return { head: records(head.slice(0, head.lastIndexOf('\n'))), tail: records(tail.slice(tail.indexOf('\n') + 1)) };
  } finally { await handle.close(); }
}

export class ClaudeSessions {
  cache = new Map();
  plans = new ClaudePlans();
  async plan(session) {
    return session.nativeId ? this.plans.read(await claudeTranscript(session.cwd, session.nativeId)) : { tasks: [], schedules: [], updatedAt: null };
  }
  // The newest conversations of a working folder, read-only.
  async list(cwd) {
    const folder = await claudeProjectFolder(cwd);
    const names = (await readdir(folder).catch(() => [])).filter(name => /^[\w-]{8,80}\.jsonl$/.test(name));
    const files = (await Promise.all(names.map(async name => {
      const info = await stat(path.join(folder, name)).catch(() => null);
      return info?.isFile() && info.size ? { name, info } : null;
    }))).filter(Boolean).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    const sessions = [];
    for (const { name, info } of files.slice(0, LIMIT)) {
      const file = path.join(folder, name), key = `${info.size}:${info.mtimeMs}`;
      let entry = this.cache.get(file);
      if (entry?.key !== key) {
        try {
          const { head, tail } = await readEdges(file, info.size);
          entry = { key, summary: sessionSummary(head, tail) };
        } catch { continue; }
        this.cache.delete(file); this.cache.set(file, entry);
        if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
      }
      sessions.push({ id: name.slice(0, -6), ...entry.summary, importName: chatName(entry.summary.title) || 'Claude session', updatedAt: info.mtime.toISOString(), size: info.size });
    }
    return { folder, sessions, total: files.length };
  }
}

// The rail for one Claude chat: its folder's conversations, each with the Mr. Mak
// chat that already holds it, and the prompts of the chat's own conversation.
export async function sessionRail(session, chats, claudeSessions, transcripts) {
  if (session.agent !== 'claude') throw new Error('The session rail is available in Claude Code chats.');
  const [list, timeline] = await Promise.all([claudeSessions.list(session.cwd), transcripts.prompts(session)]);
  const owners = new Map(chats.filter(item => item.agent === 'claude' && item.nativeId).map(item => [item.nativeId, item]));
  return {
    folder: list.folder, total: list.total, supported: timeline.supported, truncated: timeline.truncated,
    prompts: timeline.prompts.map(item => ({ ...item, text: promptPreview(item.text, 300) })).filter(item => item.text),
    sessions: list.sessions.map(item => {
      const chat = owners.get(item.id);
      return { ...item, current: item.id === session.nativeId, chat: chat ? { id: chat.id, name: chat.name, open: chat.open, status: chat.status, activity: chat.activity } : null };
    }),
  };
}
