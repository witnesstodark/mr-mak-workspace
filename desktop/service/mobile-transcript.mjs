import { open, readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { imageReferences } from './conversation-media.mjs';
import { claudeTranscript } from './native-events.mjs';
import { codexSegments } from './codex-history.mjs';
import { antigravityFullTranscript } from './antigravity.mjs';
import { readOpencodeSession } from './opencode-history.mjs';
import { fileActivity } from './file-insights.mjs';
import { cacheHistory, lastCache } from './chat-cache.mjs';

export function transcriptActivity(records, agent) {
  const tools = new Map();
  for (const [index, record] of records.entries()) {
    if (record.isSidechain || record.isMeta) continue;
    if (agent === 'claude') for (const part of Array.isArray(record.message?.content) ? record.message.content : []) {
      if (part.type === 'tool_use' && typeof part.id === 'string') tools.set(part.id, { id: part.id, name: String(part.name || 'Tool').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80), status: 'running', at: record.timestamp || '' });
      if (part.type === 'tool_result' && tools.has(part.tool_use_id)) Object.assign(tools.get(part.tool_use_id), { status: part.is_error ? 'failed' : 'completed', at: record.timestamp || '' });
    }
    const p = record.payload;
    if (agent === 'codex' && record.type === 'response_item') {
      // Codex 0.163 runs most tools as custom tool calls.
      if (['function_call', 'custom_tool_call'].includes(p?.type) && typeof p.call_id === 'string') tools.set(p.call_id, { id: p.call_id, name: String(p.name || 'Tool').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80), status: 'running', at: record.timestamp || '' });
      if (['function_call_output', 'custom_tool_call_output'].includes(p?.type) && tools.has(p.call_id)) Object.assign(tools.get(p.call_id), { status: 'completed', at: record.timestamp || '' });
    }
    if (agent === 'antigravity' && record.type === 'PLANNER_RESPONSE' && Array.isArray(record.tool_calls)) {
      const running = record === records.at(-1) || records[index + 1]?.status === 'RUNNING';
      for (const [i, tool] of record.tool_calls.entries()) {
        const id = `${record.step_index}:${i}`;
        tools.set(id, { id, name: String(tool.name || 'Tool').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80), status: running ? 'running' : 'completed', at: record.created_at || '' });
      }
    }
    // opencode-history.mjs has already read each call's state from OpenCode's store.
    if (agent === 'opencode') for (const tool of record.tools || []) if (tool.id) tools.set(tool.id, { id: tool.id, name: String(tool.name || 'Tool').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80), status: tool.status, at: tool.at || '' });
  }
  return [...tools.values()].slice(-8);
}

const textParts = content => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => ['text', 'input_text', 'output_text'].includes(part?.type)).map(part => part.text || '').join('\n') : '';

// Claude Code records a bracketed paste, which is how Mr. Mak delivers phone and
// Conversation messages, inside matching <pasted_content id="…"> tags. Show the
// text the user wrote; an unmatched tag is left as written.
export function unwrapPastes(text) {
  return text.replace(/<pasted_content id="([^"\n]{1,40})">\n?([\s\S]*?)\n?<\/pasted_content id="\1">/g, '$2').trim();
}

const tagValue = (text, tag) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(text)?.[1].trim() || '';
const plainText = text => text.replace(/<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?\/?>/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const firstLine = text => text.split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 200) || '';

// A review agent's result is often a JSON list of findings: bare, or in a code fence
// after a short summary. Returns the list and the text around it.
function findings(result) {
  const fenced = [...result.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)].at(-1);
  let value;
  try { value = JSON.parse(fenced ? fenced[1] : result); } catch { return null; }
  if (!Array.isArray(value) || !value.length || !value.every(item => item && typeof item === 'object' && typeof (item.summary ?? item.title) === 'string')) return null;
  const prose = fenced ? (result.slice(0, fenced.index) + result.slice(fenced.index + fenced[0].length)).trim() : '';
  return { prose, list: value.slice(0, 40).map(item => ({
    summary: String(item.summary ?? item.title).slice(0, 2000),
    ...(typeof item.file === 'string' ? { file: item.file.slice(0, 400) } : {}),
    ...(Number.isInteger(item.line) ? { line: item.line } : {}),
    ...(typeof (item.failure_scenario ?? item.scenario ?? item.details) === 'string' ? { detail: String(item.failure_scenario ?? item.scenario ?? item.details).slice(0, 4000) } : {}),
  })) };
}

// Text the CLI itself put in the user's turn: background-task notifications, slash
// command echoes and their output, relays between sessions. Returns null for a
// message the person wrote, 'skip' for CLI bookkeeping, or a compact event.
export function systemEvent(text, origin) {
  const value = text.trim();
  // Codex sends project instructions and its environment as user turns.
  if (/^(?:<local-command-caveat>|# AGENTS\.md instructions for |<environment_context>|<user_instructions>|<external_codex_apps_open_page>|<ADDITIONAL_METADATA>|<USER_SETTINGS_CHANGE>)/.test(value)) return 'skip';
  if (/^<task-notification>/.test(value)) {
    // The result is the agent's Markdown and may contain code such as List<int>; only the event line is plain text.
    const result = tagValue(value, 'result'), parsed = findings(result), status = tagValue(value, 'status');
    const detail = (parsed ? parsed.prose : result || plainText(tagValue(value, 'event'))).slice(0, 20000);
    return { kind: 'agent', title: plainText(tagValue(value, 'summary')) || 'Background task finished', ...(status ? { status } : {}), ...(detail ? { detail } : {}), ...(parsed ? { findings: parsed.list } : {}) };
  }
  if (/^<command-(?:name|message)>/.test(value)) {
    const name = tagValue(value, 'command-name') || `/${tagValue(value, 'command-message')}`, args = tagValue(value, 'command-args');
    return { kind: 'command', title: `${name}${args ? ` ${args}` : ''}`.slice(0, 300) };
  }
  if (/^<bash-input>/.test(value)) return { kind: 'command', title: `! ${tagValue(value, 'bash-input')}`.slice(0, 300) };
  if (/^<(?:local-command-stdout|bash-stdout|bash-stderr)>/.test(value)) {
    const output = plainText(value);
    return { kind: 'output', title: firstLine(output) || 'Command finished', ...(output.includes('\n') ? { detail: output.slice(0, 20000) } : {}) };
  }
  if (/^(?:The following is a <SYSTEM_MESSAGE>|<SYSTEM_MESSAGE>)/.test(value)) {
    const match = /content=([\s\S]*)/.exec(value);
    const detail = match ? match[1].replace(/<\/SYSTEM_MESSAGE>[\s\S]*$/, '').trim() : value;
    return { kind: 'notice', title: firstLine(detail) || 'Background task notification', detail: detail.slice(0, 20000) };
  }
  if ((origin?.kind && origin.kind !== 'human') || /^<(?:system-reminder|relay|wake|project_claude_message)[\s>]/.test(value)) {
    const body = plainText(value);
    return { kind: 'notice', title: firstLine(body) || 'Message from the CLI', detail: body.slice(0, 20000) };
  }
  return null;
}

// Claude Code continues a compacted chat with its summary as a user turn.
const compactSummary = text => ({ kind: 'notice', title: 'Conversation compacted · summary of earlier messages', detail: text.replace(/<tools-used-before-summary>[\s\S]*?<\/tools-used-before-summary>\s*/, '').trim().slice(0, 60000) });

// The model the chat last used: Codex records it per turn; Claude Code on each reply
// and when /model changes it.
export function transcriptModel(records, agent) {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (agent === 'codex' && record.type === 'turn_context' && typeof record.payload?.model === 'string') return record.payload.model;
    if (agent === 'antigravity' && record.type === 'USER_INPUT' && typeof record.content === 'string') {
      const match = /`Model Selection` from .+? to (.+?)(?:\.(?:\s+|$)|(?:\s*<\/USER_SETTINGS_CHANGE>|\r?\n|$))/.exec(record.content);
      if (match) return match[1].trim();
    }
    // OpenCode records provider/model on each prompt, reply and model switch.
    if (agent === 'opencode' && typeof record.model === 'string') return record.model;
    if (agent !== 'claude' || record.isSidechain) continue;
    if (record.type === 'assistant' && typeof record.message?.model === 'string' && !record.message.model.startsWith('<')) return record.message.model;
    const set = record.type === 'user' && typeof record.message?.content === 'string' && /<local-command-stdout>Set model to (?:\x1b\[[0-9;]*m)*`?([^`\s\x1b<]+)/.exec(record.message.content);
    if (set) return set[1];
  }
  return null;
}

// The reasoning effort the chat last used, which /effort or /model may have
// changed since launch: Codex records it per turn; Claude Code on each reply;
// Antigravity in parentheses after the model it reports, as in "Gemini 3.8 Flash (High)".
export function transcriptEffort(records, agent) {
  if (agent === 'antigravity') return /\((low|medium|high|xhigh|max)\)$/i.exec(transcriptModel(records, agent) || '')?.[1].toLowerCase() || null;
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (agent === 'codex' && record.type === 'turn_context' && typeof record.payload?.effort === 'string') return record.payload.effort;
    // OpenCode 2.x keeps the model's variant (high, max…) with the model; "default" is none.
    if (agent === 'opencode' && typeof record.model === 'string') return record.effort || null;
    if (agent !== 'claude' || record.isSidechain) continue;
    if (record.type === 'assistant' && typeof record.effort === 'string') return record.effort;
    const set = record.type === 'user' && typeof record.message?.content === 'string' && /<local-command-stdout>Set effort level to ([a-z]+)/.exec(record.message.content);
    if (set) return set[1];
  }
  return null;
}

// Read cached Claude Code rate limits and account quota.
export async function readClaudeUtilization(env = process.env, home = os.homedir()) {
  try {
    const claudeHome = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    const confPath = env.CLAUDE_CONFIG_DIR ? path.join(claudeHome, '.claude.json') : path.join(home, '.claude.json');
    const conf = JSON.parse((await readFile(confPath, 'utf8')).replace(/^\uFEFF/, ''));
    const cu = conf?.cachedUsageUtilization;
    const u = cu?.utilization || cu;
    if (!u) return null;

    const parseIsoSec = str => str ? Math.floor(Date.parse(str) / 1000) || 0 : 0;
    const rateLimitsList = [];

    if (u.five_hour || u.seven_day) {
      rateLimitsList.push({
        limitId: 'claude_general',
        limitName: 'General',
        isExclusive: false,
        primary: u.five_hour ? {
          usedPercent: Math.round(u.five_hour.utilization ?? 0),
          windowMinutes: 300,
          resetsAt: parseIsoSec(u.five_hour.resets_at)
        } : null,
        secondary: u.seven_day ? {
          usedPercent: Math.round(u.seven_day.utilization ?? 0),
          windowMinutes: 10080,
          resetsAt: parseIsoSec(u.seven_day.resets_at)
        } : null,
        planType: conf.oauthAccount?.seatTier || conf.oauthAccount?.billingType || 'Claude Pro'
      });
    }

    if (Array.isArray(u.limits)) {
      for (const item of u.limits) {
        if (item.kind === 'weekly_scoped' || item.scope?.model) {
          const modelName = item.scope?.model?.display_name || 'Scoped Model';
          rateLimitsList.push({
            limitId: `scoped_${modelName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
            limitName: modelName,
            isExclusive: true,
            primary: {
              usedPercent: Math.round(item.percent ?? 0),
              windowMinutes: 10080,
              resetsAt: parseIsoSec(item.resets_at)
            },
            planType: `Exclusive: ${modelName}`
          });
        }
      }
    }

    if (u.seven_day_opus && typeof u.seven_day_opus.utilization === 'number') {
      rateLimitsList.push({
        limitId: 'scoped_opus',
        limitName: 'Opus',
        isExclusive: true,
        primary: {
          usedPercent: Math.round(u.seven_day_opus.utilization),
          windowMinutes: 10080,
          resetsAt: parseIsoSec(u.seven_day_opus.resets_at)
        },
        planType: 'Exclusive: Opus'
      });
    }

    return {
      rateLimitsList,
      fetchedAt: cu?.fetchedAtMs || null,
      spend: u.spend || null,
      extraUsage: u.extra_usage || null
    };
  } catch {
    return null;
  }
}

// Model usage metrics, context window fill and rate limits per agent.
export function transcriptUsage(records, agent, activeModel = null, externalQuota = null) {
  if (!records || !records.length) return null;

  if (agent === 'codex') {
    let latestTokenCount = null;
    const rateLimitsMap = new Map();
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i];
      if (rec.type === 'event_msg' && rec.payload?.type === 'token_count') {
        if (!latestTokenCount) latestTokenCount = rec.payload;
        if (rec.payload.rate_limits?.limit_id && !rateLimitsMap.has(rec.payload.rate_limits.limit_id)) {
          rateLimitsMap.set(rec.payload.rate_limits.limit_id, rec.payload.rate_limits);
        }
      }
    }
    if (!latestTokenCount) return null;
    const info = latestTokenCount.info || {};
    const lastUsage = info.last_token_usage || {};
    const totalUsage = info.total_token_usage || {};
    const contextWindow = info.model_context_window || 258400;
    const currentTokens = lastUsage.total_tokens || lastUsage.input_tokens || totalUsage.total_tokens || 0;
    const contextPercent = contextWindow > 0 ? Math.min(100, Math.round((currentTokens / contextWindow) * 100)) : null;

    const rateLimitsList = Array.from(rateLimitsMap.values()).map(rl => {
      const isExclusive = rl.limit_id === 'premium' || (rl.limit_name && /premium|exclusive|o1|o3/i.test(rl.limit_name));
      return {
        limitId: rl.limit_id,
        limitName: rl.limit_name || (rl.limit_id === 'premium' ? 'Premium (o1/o3)' : 'General'),
        isExclusive: !!isExclusive,
        primary: rl.primary ? {
          usedPercent: rl.primary.used_percent ?? 0,
          windowMinutes: rl.primary.window_minutes ?? 300,
          resetsAt: rl.primary.resets_at ?? 0
        } : null,
        secondary: rl.secondary ? {
          usedPercent: rl.secondary.used_percent ?? 0,
          windowMinutes: rl.secondary.window_minutes ?? 10080,
          resetsAt: rl.secondary.resets_at ?? 0
        } : null,
        planType: rl.plan_type || null,
        credits: rl.credits || null
      };
    });

    return {
      agent: 'codex',
      tokens: {
        current: currentTokens,
        cumulative: totalUsage.total_tokens || currentTokens,
        input: lastUsage.input_tokens || 0,
        cached: lastUsage.cached_input_tokens || 0,
        output: lastUsage.output_tokens || 0,
        reasoning: lastUsage.reasoning_output_tokens || 0,
        contextWindow,
        contextPercent
      },
      rateLimits: rateLimitsList[0] || null,
      rateLimitsList
    };
  }

  if (agent === 'claude') {
    let costState = null;
    let latestAssistantUsage = null;
    let usageAt = null, compaction = null;
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i];
      if (!costState && rec.type === 'cost-state') costState = rec;
      // A compaction after the latest reply replaced the context with its summary.
      if (!latestAssistantUsage && !compaction && rec.type === 'system' && rec.subtype === 'compact_boundary') compaction = rec;
      if (!latestAssistantUsage && rec.type === 'assistant' && !rec.isSidechain && rec.message?.usage) {
        latestAssistantUsage = rec.message.usage;
        usageAt = rec.timestamp || null;
      }
      if (costState && latestAssistantUsage) break;
    }
    if (!latestAssistantUsage && !costState && !externalQuota) return null;

    const u = latestAssistantUsage || {};
    const input = u.input_tokens || 0;
    const cached = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const output = u.output_tokens || 0;
    const currentTokens = compaction ? Number(compaction.compactMetadata?.postTokens) || 0 : input + cached + output;
    const contextWindow = /1m/i.test(activeModel || '') ? 1000000 : 200000;
    const contextPercent = Math.min(100, Math.round((currentTokens / contextWindow) * 100));

    const rateLimitsList = externalQuota?.rateLimitsList || [];

    return {
      agent: 'claude',
      tokens: {
        current: currentTokens,
        cumulative: currentTokens,
        input,
        cached,
        output,
        contextWindow,
        contextPercent
      },
      costUSD: typeof costState?.totalCostUSD === 'number' ? Math.round(costState.totalCostUSD * 1000) / 1000 : null,
      modelUsage: costState?.modelUsage || null,
      rateLimits: rateLimitsList[0] || null,
      rateLimitsList,
      fetchedAt: externalQuota?.fetchedAt || null,
      // The chat's last model request; its prompt cache expires counting from here.
      at: compaction?.timestamp || usageAt
    };
  }

  if (agent === 'antigravity') {
    let latestResponse = null;
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i];
      if (rec.type === 'PLANNER_RESPONSE' && (rec.input_tokens !== undefined || rec.output_tokens !== undefined)) {
        latestResponse = rec;
        break;
      }
    }
    if (!latestResponse) return null;
    const input = latestResponse.input_tokens || 0;
    const cached = latestResponse.cache_read_tokens || 0;
    const output = latestResponse.output_tokens || 0;
    const currentTokens = input + output;
    const contextWindow = 1048576;
    const contextPercent = Math.min(100, Math.round((currentTokens / contextWindow) * 100));

    const isExclusiveModel = /gemini\s*4|opus|astra/i.test(activeModel || '');
    const modelTier = isExclusiveModel
      ? (/gemini\s*4/i.test(activeModel) ? 'Gemini 4' : /opus/i.test(activeModel) ? 'Opus' : 'Astra')
      : null;

    const rateLimitsList = [];
    rateLimitsList.push({
      limitId: 'antigravity_general',
      limitName: 'General',
      isExclusive: false,
      primary: null,
      planType: 'Google Antigravity'
    });

    if (isExclusiveModel && modelTier) {
      rateLimitsList.push({
        limitId: `exclusive_${modelTier.toLowerCase().replace(/\s+/g, '_')}`,
        limitName: modelTier,
        isExclusive: true,
        // Antigravity's transcript holds no quota figures; the context fill is not one.
        primary: null,
        planType: `Exclusive: ${modelTier}`
      });
    }

    return {
      agent: 'antigravity',
      tokens: {
        current: currentTokens,
        cumulative: currentTokens,
        input,
        cached,
        output,
        contextWindow,
        contextPercent
      },
      rateLimits: rateLimitsList[0] || null,
      rateLimitsList
    };
  }

  return null;
}

// A Claude Code rewind keeps the session file: the new prompt gets the same parent
// as the prompt it replaces, and what was written from that prompt on is no longer
// part of the conversation. Parallel tool calls also branch, so the chain from the
// newest record alone would lose replies.
export function activeBranch(records) {
  const prompts = new Map(), rewound = new Set();
  records.forEach((item, index) => {
    if (item.type !== 'user' || item.isSidechain || item.isMeta || !('parentUuid' in item)) return;
    if (Array.isArray(item.message?.content) && item.message.content.some(part => part.type === 'tool_result')) return;
    const parent = item.parentUuid ?? null;
    if (prompts.has(parent)) for (let earlier = prompts.get(parent); earlier < index; earlier++) if (records[earlier].uuid && !records[earlier].isSidechain) rewound.add(earlier);
    prompts.set(parent, index);
  });
  return rewound.size ? records.filter((_, index) => !rewound.has(index)) : records;
}

export function transcriptMessages(records, agent, limit = 100) {
  if (agent === 'claude') records = activeBranch(records);
  const messages = [];
  // Codex event messages avoid showing injected environment/instruction records.
  // Codex 0.163 records them as completed UserMessage and AgentMessage items.
  const codexItem = item => item.type === 'event_msg' && item.payload?.type === 'item_completed' ? item.payload.item : null;
  const hasCodexEvents = records.some(item => item.type === 'event_msg' && (['user_message', 'agent_message'].includes(item.payload?.type) || ['UserMessage', 'AgentMessage'].includes(codexItem(item)?.type)));
  for (const item of records) {
    let role, text, content, imageRefs = [];
    if (agent === 'codex' && hasCodexEvents && item.type === 'event_msg') {
      const entry = codexItem(item), parts = Array.isArray(entry?.content) ? entry.content : [];
      if (item.payload?.type === 'user_message') { role = 'user'; text = item.payload.message; imageRefs = [...(item.payload.local_images || []), ...(item.payload.images || [])].filter(value => typeof value === 'string').slice(0, 12); }
      if (item.payload?.type === 'agent_message') { role = 'assistant'; text = item.payload.message; }
      if (entry?.type === 'UserMessage') { role = 'user'; text = parts.filter(part => part?.type === 'text').map(part => part.text || '').join('\n'); imageRefs = parts.filter(part => /image/i.test(part?.type)).map(part => part.path ?? part.image_url ?? part.url).filter(value => typeof value === 'string').slice(0, 12); }
      if (entry?.type === 'AgentMessage') { role = 'assistant'; text = parts.filter(part => /^text$/i.test(part?.type)).map(part => part.text || '').join('\n'); }
    } else if (agent === 'codex' && !hasCodexEvents && item.type === 'response_item' && item.payload?.type === 'message') {
      role = item.payload.role; content = item.payload.content; text = textParts(content);
    } else if (agent === 'claude' && !item.isSidechain && !item.isMeta && ['user', 'assistant'].includes(item.type)) {
      role = item.type; content = item.message?.content; text = textParts(content);
      if (Array.isArray(content) && content.some(part => part.type === 'tool_result')) role = 'assistant';
    } else if (agent === 'antigravity') {
      if (item.type === 'USER_INPUT') {
        role = 'user';
        const raw = item.content || '';
        const match = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(raw);
        text = match ? match[1].trim() : raw;
        if (Array.isArray(item.media)) {
          imageRefs = item.media.map(m => m.uri || m.path).filter(Boolean);
        }
      } else if (item.type === 'PLANNER_RESPONSE' && item.content) {
        role = 'assistant';
        text = item.content;
        if (Array.isArray(item.media)) {
          imageRefs = item.media.map(m => m.uri || m.path).filter(Boolean);
        }
      } else if (item.type === 'SYSTEM_MESSAGE') {
        role = 'user';
        text = item.content || '';
      }
    } else if (agent === 'opencode' && ['user', 'assistant'].includes(item.role)) {
      // Records from opencode-history.mjs: text and images already taken from OpenCode's parts.
      role = item.role; text = item.text; imageRefs = item.imageRefs || [];
    }
    if (agent === 'codex' && hasCodexEvents && item.type === 'response_item' && item.payload?.type === 'message' && item.payload.role === 'assistant') { role = 'assistant'; text = ''; content = item.payload.content; }
    if (agent === 'codex' && item.type === 'response_item' && item.payload?.type === 'function_call_output') {
      let output = item.payload.output;
      if (typeof output === 'string') { try { output = JSON.parse(output); } catch { output = null; } }
      content = Array.isArray(output) ? output : output?.content;
      role = 'assistant'; text = '';
    }
    text = typeof text === 'string' ? text : '';
    // Codex chats imported from Claude Code keep its paste tags too.
    if (role === 'user') text = unwrapPastes(text);
    const event = role !== 'user' ? null : item.isCompactSummary ? compactSummary(text) : systemEvent(text, item.origin);
    if (event === 'skip') continue;
    if (event) { role = 'system'; text = event.title; content = undefined; imageRefs = []; }
    imageRefs = [...new Set([...imageRefs, ...imageReferences(content, text || '')])].slice(0, 12);
    if (!['user', 'assistant', 'system'].includes(role) || (!text?.trim() && !imageRefs.length)) continue;
    const at = item.timestamp || item.created_at || '';
    const id = item.uuid || codexItem(item)?.id || (item.step_index != null ? `agy-${item.step_index}` : null) || createHash('sha256').update(`${at}:${role}:${text}:${imageRefs.join(";")}`).digest('hex').slice(0, 24);
    // Streaming revisions of a Claude message have the same message ID.
    const nativeId = item.message?.id;
    const previous = nativeId && messages.findIndex(message => message.nativeId === nativeId);
    const message = { id, role, text: text.slice(0, 100000), at, nativeId, ...(imageRefs.length ? { imageRefs } : {}), ...(event ? { event } : {}) };
    if (typeof previous === 'number' && previous >= 0) messages[previous] = message;
    else messages.push(message);
  }
  return messages.slice(-limit).map(({ nativeId: _nativeId, ...message }) => message);
}

async function readRange(file, start, end) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

// The newest 4 MB of a transcript. A Codex rewind segment begins with its own
// metadata and continues the previous segment up to that segment's history_base.
export async function transcriptText(files, limit = 4 * 1024 * 1024) {
  let text = '', budget = limit, end = (await stat(files.at(-1))).size;
  for (let index = files.length - 1; index >= 0; index--) {
    const start = Math.max(0, end - budget), chunk = await readRange(files[index], start, end);
    budget -= end - start;
    if (start > 0) return { text: chunk.slice(chunk.indexOf('\n') + 1) + text, truncated: true };
    text = `${chunk}${chunk.endsWith('\n') ? '' : '\n'}${text}`;
    let base = null;
    try { base = JSON.parse(chunk.slice(0, chunk.indexOf('\n'))).payload?.history_base; } catch { /* No metadata: nothing earlier to join. */ }
    if (!index || !Number.isInteger(base?.end_byte_offset)) break;
    end = Math.min(base.end_byte_offset, (await stat(files[index - 1])).size);
  }
  return { text, truncated: false };
}

// The task a Claude Code <task-notification> reports as stopped: a subagent or a
// background command. It arrives as a user turn (in a subagent after a "[SYSTEM
// NOTIFICATION]" preamble), or during a turn as a queued command, logged when queued.
function notifiedTask(record) {
  const text = record.type === 'user' ? textParts(record.message?.content)
    : record.type === 'queue-operation' ? record.content
    : record.attachment?.type === 'queued_command' ? record.attachment.prompt : '';
  const match = typeof text === 'string' && /<task-notification>\s*<task-id>([\w-]+)<\/task-id>/.exec(text);
  return match && (record.origin?.kind === 'task-notification' || !text.slice(0, match.index).trim()) ? match[1] : undefined;
}

// When each background task last reported that it stopped, keyed by the task id.
export function taskStops(records) {
  const stops = new Map();
  for (const record of records) {
    const id = !record.isSidechain && notifiedTask(record);
    if (id) stops.set(id, Date.parse(record.timestamp) || 0);
  }
  return stops;
}

const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Shell commands sent to the background (run_in_background, or a command that
// outlived its timeout) that have not reported back or been stopped with TaskStop.
export function backgroundCommands(records) {
  const calls = new Map(), commands = new Map();
  for (const record of records) {
    for (const part of Array.isArray(record.message?.content) ? record.message.content : []) {
      if (part.type === 'tool_use') {
        calls.set(part.id, { tool: part, at: record.timestamp });
        if (part.name === 'TaskStop') commands.delete(part.input?.task_id);
      }
      const id = record.toolUseResult?.backgroundTaskId, call = part.type === 'tool_result' && calls.get(part.tool_use_id);
      if (call && typeof id === 'string') commands.set(id, {
        id, name: oneLine(call.tool.name || 'Shell', 60),
        title: oneLine(call.tool.input?.description || String(call.tool.input?.command || '').split('\n')[0] || 'Background command', 160),
        startedAt: call.at || record.timestamp || '',
      });
    }
    const stopped = notifiedTask(record);
    if (stopped) commands.delete(stopped);
  }
  return [...commands.values()];
}
function toolStep(tool) {
  const input = tool.input || {}, file = input.file_path || input.notebook_path || input.path;
  const hint = input.description || (typeof file === 'string' && path.basename(file)) || input.pattern || input.query || input.url || String(input.command || '').split('\n')[0];
  const name = String(tool.name || 'Tool').split('__').pop();
  return oneLine(hint ? `${name} · ${hint}` : name, 160);
}

// What a subagent is doing, from the end of its transcript. Its turn ends with a
// reply that stopped on end_turn; otherwise a tool or the model is still running.
export function subagentStep(records) {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (record.type === 'user') return { working: true, at: record.timestamp, step: 'Thinking' };
    if (record.type !== 'assistant') continue;
    const content = Array.isArray(record.message?.content) ? record.message.content : [];
    const tool = content.findLast(part => part.type === 'tool_use');
    if (!tool && ['end_turn', 'stop_sequence', 'max_tokens', 'refusal'].includes(record.message?.stop_reason)) return { working: false, at: record.timestamp };
    return { working: true, at: record.timestamp, step: tool ? toolStep(tool) : content.some(part => part.type === 'text') ? 'Writing' : 'Thinking' };
  }
  return null;
}

// Read-only conversation view of a native CLI transcript, for phone and desktop.
export class ConversationTranscripts {
  cache = new Map();
  subagents = new Map();
  async read(session) {
    if (session.agent === 'opencode' && session.nativeId) return this.readOpencode(session);
    if (!['codex', 'claude', 'antigravity'].includes(session.agent) || !session.nativeId) return { supported: false, messages: [] };
    const files = session.agent === 'claude' ? [await claudeTranscript(session.cwd, session.nativeId)]
      : session.agent === 'antigravity' ? [await antigravityFullTranscript(session.nativeId)]
      : await codexSegments(session.nativeId);
    if (!files.length) return { supported: false, messages: [] };
    try {
      const info = await stat(files.at(-1));
      let cached = this.cache.get(session.id);
      const key = `${files.join('|')}:${info.size}:${info.mtimeMs}`;
      if (cached?.key !== key) {
        const { text, truncated } = await transcriptText(files);
        const records = text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
        const messages = transcriptMessages(records, session.agent, Infinity);
        // Prompts the user sent; it measures how long a conversation has become.
        const userMessages = messages.filter(item => item.role === 'user').length;
        const model = transcriptModel(records, session.agent);
        let claudeQuota = null;
        if (session.agent === 'claude') {
          claudeQuota = await readClaudeUtilization().catch(() => null);
        }
        const usage = transcriptUsage(records, session.agent, model, claudeQuota);
        const value = { supported: true, messages: messages.slice(-100), userMessages, activity: transcriptActivity(records, session.agent), files: fileActivity(records, session.agent, session.cwd), cache: session.agent === 'claude' ? lastCache(records) : null, cacheStats: session.agent === 'claude' ? cacheHistory(records) : null, model, effort: transcriptEffort(records, session.agent), usage, truncated };
        const claude = session.agent === 'claude';
        cached = { key, value, prompts: messages.filter(item => item.role === 'user').slice(-500).map(({ id, at, text }) => ({ id, at, text: text.slice(0, 2000) })), stops: claude ? taskStops(records) : new Map(), commands: claude ? backgroundCommands(records) : [] };
        this.cache.set(session.id, cached);
        if (this.cache.size > 25) this.cache.delete(this.cache.keys().next().value);
      }
      // Subagents write their own files, so the chat's transcript may be unchanged while they work.
      return session.agent === 'claude' ? { ...cached.value, ...await this.backgroundWork(files[0], session, cached).catch(() => ({ agents: [], commands: [] })) } : cached.value;
    } catch { return { supported: false, messages: [] }; }
  }

  // Every prompt the person sent in the part of the transcript read above, for the
  // Session Rail's timeline. `shown` marks the prompts the Conversation view holds.
  async prompts(session) {
    const value = await this.read(session);
    const shown = new Set(value.messages.map(item => item.id));
    const prompts = (this.cache.get(session.id)?.prompts || []).map(item => ({ ...item, shown: shown.has(item.id) }));
    return { supported: value.supported, truncated: !!value.truncated, prompts };
  }

  // OpenCode keeps chats in its SQLite store rather than a transcript file. The
  // store is only read again when this chat's rows or its /undo point changed.
  async readOpencode(session) {
    const cached = this.cache.get(session.id);
    try {
      const read = await readOpencodeSession(session.nativeId, cached?.key);
      if (!read) return { supported: false, messages: [] };
      if (read.key === cached?.key) return cached.value;
      const messages = transcriptMessages(read.records, 'opencode', Infinity);
      const value = { supported: true, messages: messages.slice(-100), userMessages: messages.filter(item => item.role === 'user').length, activity: transcriptActivity(read.records, 'opencode'), model: transcriptModel(read.records, 'opencode'), effort: transcriptEffort(read.records, 'opencode'), usage: null, truncated: read.truncated };
      this.cache.set(session.id, { key: read.key, value });
      if (this.cache.size > 25) this.cache.delete(this.cache.keys().next().value);
      return value;
    } catch { return cached?.value || { supported: false, messages: [] }; }
  }

  // Subagents and background commands still working. Both end with their CLI, so
  // only work recorded since this chat's terminal started can still be running.
  // Claude Code keeps each subagent's transcript in <chat>/subagents/agent-<id>.jsonl
  // with a .meta.json (type, description). The chat's own transcript only has a
  // background agent's launch and notification, which a long chat pushes out of the
  // part read above.
  async backgroundWork(transcript, session, { stops, commands: chatCommands }) {
    if (!session.process) return { agents: [], commands: [] };
    const since = command => (Date.parse(command.startedAt) || 0) >= (session.startedAt || 0);
    const commands = chatCommands.filter(since);
    const folder = path.join(path.dirname(transcript), session.nativeId, 'subagents');
    const agents = [];
    for (const name of await readdir(folder).catch(() => [])) {
      if (!/^agent-[\w-]+\.jsonl$/.test(name)) continue;
      const file = path.join(folder, name), info = await stat(file).catch(() => null);
      if (!info || info.mtimeMs < (session.startedAt || 0)) continue;
      const key = `${info.size}:${info.mtimeMs}`;
      let entry = this.subagents.get(file);
      if (entry?.key !== key) {
        const text = await readRange(file, Math.max(0, info.size - 256 * 1024), info.size);
        const records = text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
        let meta = {};
        try { meta = JSON.parse(await readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* Older CLIs wrote no metadata. */ }
        entry = { key, state: subagentStep(records), commands: backgroundCommands(records), agent: {
          id: name.slice(6, -6), name: oneLine(meta.description || meta.name || meta.agentType || 'Agent', 160), type: oneLine(meta.agentType, 60),
          startedAt: (info.birthtimeMs ? info.birthtime : info.mtime).toISOString(), updatedAt: info.mtime.toISOString(),
        } };
        this.subagents.set(file, entry);
        if (this.subagents.size > 300) this.subagents.delete(this.subagents.keys().next().value);
      }
      // A subagent's own commands may outlast its turn. They report back to it, or to the chat once it has ended.
      commands.push(...entry.commands.filter(command => since(command) && !stops.has(command.id)).map(command => ({ ...command, agent: entry.agent.name })));
      // A stopped or killed agent is reported in the chat's transcript after its last write.
      const stopped = stops.get(entry.agent.id);
      if (!entry.state?.working || (stopped && stopped >= (Date.parse(entry.state.at) || info.mtimeMs))) continue;
      agents.push({ ...entry.agent, step: entry.state.step });
    }
    const byStart = (a, b) => a.startedAt.localeCompare(b.startedAt);
    return { agents: agents.sort(byStart).slice(0, 20), commands: commands.sort(byStart).slice(0, 20) };
  }
}
