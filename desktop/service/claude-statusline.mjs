// Claude Code runs this as a chat's status line command and writes its live session
// state to stdin as JSON (https://code.claude.com/docs/en/statusline). It saves the
// plan limits, context window, model, effort and cost for Mr. Mak's chat footer, and
// prints nothing, so the terminal keeps its own layout.
//
// Usage: node claude-statusline.mjs <file.json>. Plan limits belong to the account,
// so they are also saved beside it as account.json for every chat to read.
import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
setTimeout(() => process.exit(0), 3000).unref();
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 2_000_000) process.exit(0); });
process.stdin.on('end', () => {
  if (!file) return;
  try {
    const data = JSON.parse(input);
    const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const window = value => value && typeof value === 'object' ? { used_percentage: number(value.used_percentage), resets_at: value.resets_at ?? null } : undefined;
    const limits = data.rate_limits && typeof data.rate_limits === 'object' ? {
      five_hour: window(data.rate_limits.five_hour),
      seven_day: window(data.rate_limits.seven_day),
      spend_limit: window(data.rate_limits.spend_limit),
    } : null;
    const context = data.context_window || {};
    const usage = context.current_usage || {};
    // Only what the footer shows; no paths, names or transcript locations.
    const state = {
      at: Date.now(),
      sessionId: typeof data.session_id === 'string' ? data.session_id : null,
      version: typeof data.version === 'string' ? data.version : null,
      model: { id: typeof data.model?.id === 'string' ? data.model.id : null, displayName: typeof data.model?.display_name === 'string' ? data.model.display_name : null },
      effort: typeof data.effort?.level === 'string' ? data.effort.level : null,
      context: {
        size: number(context.context_window_size), usedPercent: number(context.used_percentage),
        input: number(context.total_input_tokens), output: number(context.total_output_tokens),
        fresh: number(usage.input_tokens), cacheRead: number(usage.cache_read_input_tokens), cacheWrite: number(usage.cache_creation_input_tokens),
      },
      costUSD: number(data.cost?.total_cost_usd),
      rateLimits: limits,
    };
    const save = (target, value) => { writeFileSync(`${target}.tmp`, JSON.stringify(value)); renameSync(`${target}.tmp`, target); };
    save(file, state);
    if (limits && (limits.five_hour || limits.seven_day)) save(path.join(path.dirname(file), 'account.json'), { at: state.at, rateLimits: limits });
  } catch { /* A partial or unexpected payload leaves the last saved state. */ }
});
