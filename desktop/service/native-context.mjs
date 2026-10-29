// Context occupancy from the latest native report, never session token totals.
const tokens = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const sum = values => {
  if (!values.every(value => tokens(value) !== null)) return null;
  return tokens(values.reduce((a, b) => a + b, 0));
};

export function unknownContext(agent, reason) {
  return { usedTokens: null, limitTokens: null, source: agent, updatedAt: null, reason: reason || (['codex', 'claude', 'opencode', 'antigravity'].includes(agent) ? 'waiting' : 'unavailable') };
}

// Context windows from Anthropic's model table (2026-10). A transcript names
// the model of each response, not its window. Unknown models stay unknown.
export function claudeContextWindow(model) {
  const id = String(model || '').toLowerCase();
  if (/claude-(?:fable|mythos)-\d/.test(id)) return 1_000_000;
  if (/claude-(?:\d|instant)/.test(id)) return 200_000;
  const match = /claude-(opus|sonnet|haiku)-(\d+)(?:-(\d)(?!\d))?/.exec(id);
  if (!match) return null;
  const version = Number(match[2]) + Number(match[3] || 0) / 10;
  return version >= (match[1] === 'haiku' ? 5 : 4.6) ? 1_000_000 : 200_000;
}

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
const field = (fields, number) => fields?.get(number)?.at(-1);
const nested = (fields, number) => { const value = field(fields, number); return value instanceof Uint8Array ? protobuf(value) : null; };

// agy 1.4.7 stores each generation as CortexStepGeneratorMetadata. Its
// chat_model(1).chat_start_metadata(9).context_window_metadata(10) has
// estimated_tokens_used(1) and max_context_tokens(4), the CLI's own window.
export function antigravityContext(data) {
  const window = nested(nested(nested(protobuf(data), 1), 9), 10);
  if (!window) return null;
  const used = field(window, 1), limit = field(window, 4);
  return { ...unknownContext('antigravity'), usedTokens: typeof used === 'number' ? tokens(used) : null, limitTokens: typeof limit === 'number' && tokens(limit) > 0 ? limit : null };
}

export function opencodeContext(info) {
  const t = info?.tokens;
  return { ...unknownContext('opencode'), usedTokens: sum([t?.input, t?.output, t?.reasoning, t?.cache?.read, t?.cache?.write]), updatedAt: null };
}

export function nativeContext(record, agent) {
  if (!record || typeof record !== 'object') return null;
  let usage;
  if (agent === 'codex') {
    if (record.type === 'session_meta') usage = unknownContext(agent);
    else if (record.type === 'compacted' || record.type === 'event_msg' && record.payload?.type === 'context_compacted') usage = unknownContext(agent, 'compacted');
    else if (record.type === 'event_msg' && record.payload?.type === 'token_count') {
      const info = record.payload.info;
      const limit = tokens(info?.model_context_window);
      usage = { ...unknownContext(agent), usedTokens: tokens(info?.last_token_usage?.total_tokens), limitTokens: limit > 0 ? limit : null };
    }
  } else if (agent === 'claude' && !record.isSidechain && !record.isCompactSummary) {
    if (record.type === 'system' && record.subtype === 'compact_boundary') usage = unknownContext(agent, 'compacted');
    else if (record.type === 'assistant' && record.message?.model !== '<synthetic>') {
      const u = record.message?.usage;
      // Same input-only accounting as Claude's native context percentage. A
      // count above the table's window means the account uses another window.
      const used = sum([u?.input_tokens, u?.cache_read_input_tokens, u?.cache_creation_input_tokens]);
      const limit = claudeContextWindow(record.message?.model);
      usage = { ...unknownContext(agent), usedTokens: used, limitTokens: used !== null && limit !== null && used > limit ? null : limit };
    }
  }
  return usage ? { kind: 'context-usage', usage: { ...usage, updatedAt: typeof record.timestamp === 'string' ? record.timestamp : null } } : null;
}
