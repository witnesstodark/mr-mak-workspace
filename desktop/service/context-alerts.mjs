// When a chat offers to shrink its context: which CLIs can compact in place, and
// when an idle Claude chat should offer it before its prompt cache expires.
// The service and the desktop window share this file, so it has no Node imports.

// CLIs that ship their own /compact. The others only offer a handoff.
const COMPACT_COMMANDS = { claude: '/compact', codex: '/compact', opencode: '/compact', antigravity: '/compact' };
export const compactCommand = agent => COMPACT_COMMANDS[agent] || null;

// Claude Code's prompt cache on a subscription lasts about an hour after the
// chat's last request. After that the next turn writes the whole context to the
// cache again, so compacting no longer saves anything.
export const CACHE_TTL_MINUTES = 60;
export const IDLE_CACHE_MINUTES = 55;
export const IDLE_CACHE_MIN_TOKENS = 100000;

// The idle-cache alert for one chat, or null. `usage` is the chat's transcript
// usage: `at` is its last model request and `tokens.current` its context size.
// `dismissed` is the `at` of an idle period the user already dismissed or compacted.
// The alert never shows while the agent works or waits for an answer.
export function idleCacheAlert({ agent, status, activity, usage, now = Date.now(), minutes = IDLE_CACHE_MINUTES, minTokens = IDLE_CACHE_MIN_TOKENS, dismissed = null }) {
  if (agent !== 'claude' || status !== 'running' || activity !== 'idle' || !(minutes > 0) || minutes >= CACHE_TTL_MINUTES) return null;
  const at = usage?.at, last = Date.parse(at || ''), tokens = usage?.tokens?.current || 0;
  if (!Number.isFinite(last) || tokens < minTokens || dismissed === at) return null;
  const idle = now - last, ttl = CACHE_TTL_MINUTES * 60000;
  if (idle < minutes * 60000 || idle >= ttl) return null;
  return { at, tokens, idleMinutes: Math.floor(idle / 60000), expiresInMinutes: Math.max(1, Math.ceil((ttl - idle) / 60000)) };
}
