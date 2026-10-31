// Claude's prompt cache for one chat. A subscription chat keeps it for an hour
// after its last reply; a message after that rewrites the whole context. The
// footer shows warm or cold, and the first message to a large cold chat is held
// once with the estimated rewrite cost.
export const CACHE_TTL_MS = 60 * 60 * 1000;
export const COLD_CONTEXT = 50000;

// $ per million tokens: [cache read, 1-hour cache write]. List prices from the
// cache-tax mod's table (October 2026); more specific families first.
const PRICES = [
  ['fable-5-1', 0.25, 20], ['mythos-5-1', 0.25, 20], ['fable-5', 1, 20], ['mythos-5', 1, 20],
  ['opus-5-5', 0.2, 8], ['opus-5', 0.5, 10], [/opus-4(?:-[01])?(?:$|[^-\d]|-20\d{6})/, 1.5, 30], ['opus-4', 0.5, 10],
  ['sonnet-5-5', 0.1, 4], ['sonnet-5', 0.2, 4], ['sonnet', 0.3, 6],
  ['haiku-5-5', 0.01, 0.2], ['haiku', 0.1, 2],
];
export function priceOf(model) {
  const name = String(model || '').toLowerCase().replace(/[\s.]+/g, '-');
  const row = PRICES.find(([family]) => typeof family === 'string' ? name.includes(family) : family.test(name));
  return row ? { read: row[1], write: row[2] } : null;
}

// The chat's last reply: when the cache was written and how much it holds.
export function lastCache(records) {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index], usage = record.message?.usage;
    if (record.type !== 'assistant' || record.isSidechain || !usage || !record.timestamp) continue;
    const tokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0);
    return { at: record.timestamp, tokens, model: record.message.model || null };
  }
  return null;
}

// A reply that wrote most of its context to the cache again, and why: the cache
// had expired, the model changed (caches are per model), the chat was compacted,
// or something else changed the prompt's start (tools, MCP servers, instructions).
// Changing effort keeps the cache, so it is not a reason.
export const REWRITE_MIN = 20000;
const REWRITES_KEPT = 20;
export function cacheHistory(records) {
  // Claude Code writes one record per content block, all carrying the reply's usage.
  const replies = [];
  let compacted = false;
  for (const record of records) {
    if (record.type === 'system' && record.subtype === 'compact_boundary') compacted = true;
    const usage = record.message?.usage, model = record.message?.model;
    if (record.type !== 'assistant' || record.isSidechain || !usage || !record.timestamp || model === '<synthetic>') continue;
    const id = record.message.id;
    if (id && replies.at(-1)?.id === id) { replies.at(-1).usage = usage; continue; }
    replies.push({ id, at: record.timestamp, model: model || null, usage, compacted });
    compacted = false;
  }
  if (!replies.length) return null;
  let read = 0, written = 0, uncached = 0, readUsd = 0, writeUsd = 0, priced = true, rewriteUsd = 0, previous = null;
  const rewrites = [];
  for (const reply of replies) {
    const r = reply.usage.cache_read_input_tokens || 0, w = reply.usage.cache_creation_input_tokens || 0, fresh = reply.usage.input_tokens || 0;
    const price = priceOf(reply.model);
    read += r; written += w; uncached += fresh;
    if (price) { readUsd += r * price.read / 1e6; writeUsd += w * price.write / 1e6; } else priced = false;
    if (w >= REWRITE_MIN && w >= (r + w + fresh) / 2) {
      const reason = !previous ? 'start' : reply.compacted ? 'compact' : Date.parse(reply.at) - Date.parse(previous.at) >= CACHE_TTL_MS ? 'expired' : reply.model !== previous.model ? 'model' : 'other';
      const usd = price ? w * price.write / 1e6 : null;
      if (reason !== 'start' && usd != null) rewriteUsd += usd;
      rewrites.push({ at: reply.at, tokens: w, reason, model: reply.model, writeUsd: usd });
    }
    previous = reply;
  }
  const total = read + written + uncached;
  return {
    replies: replies.length, read, written, uncached, hitRate: total ? read / total : null,
    readUsd: priced ? readUsd : null, writeUsd: priced ? writeUsd : null,
    rewriteCount: rewrites.filter(item => item.reason !== 'start').length, rewriteUsd: priced ? rewriteUsd : null,
    rewrites: rewrites.slice(-REWRITES_KEPT).reverse(),
  };
}

export function cacheView(cache, now = Date.now()) {
  if (!cache) return null;
  const expiresAt = Date.parse(cache.at) + CACHE_TTL_MS, price = priceOf(cache.model);
  return {
    ...cache, expiresAt: new Date(expiresAt).toISOString(), cold: now >= expiresAt,
    writeUsd: price ? cache.tokens * price.write / 1e6 : null, readUsd: price ? cache.tokens * price.read / 1e6 : null,
  };
}

const usd = value => value == null ? null : value < 0.1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
const ago = ms => ms < 2 * 60 * 60 * 1000 ? `${Math.round(ms / 60000)} min` : `${(ms / 3600000).toFixed(1)} h`;

// Holds the first message to a large cold chat once per cold cache; sending it
// again goes through.
export class ColdGuard {
  held = new Map();
  check(session, cache, now = Date.now()) {
    const view = cacheView(cache, now);
    if (session.agent !== 'claude' || !view?.cold || view.tokens < COLD_CONTEXT) return;
    if (this.held.get(session.id) === view.at) return;
    this.held.set(session.id, view.at);
    const cost = view.writeUsd != null ? `, about ${usd(view.writeUsd)} at list prices (a warm message reads it for ${usd(view.readUsd)})` : '';
    // `cold` lets the desktop offer Send anyway, Compact first or Summarize and continue.
    throw Object.assign(new Error(`This chat's last reply was ${ago(now - Date.parse(view.at))} ago, so its prompt cache went cold. Sending now rewrites up to ${view.tokens.toLocaleString('en-US')} tokens${cost}; on a subscription it counts against your usage limits. Send again to go ahead, or start a new chat from a summary.`), { status: 409, cold: view });
  }
}
