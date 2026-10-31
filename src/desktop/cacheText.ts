import type { CacheRewriteReason, CacheStats } from './chatModel'

export const usd = (value: number | null) => value == null ? '' : value < 0.1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`
export const tokens = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
export const percent = (value: number | null) => value == null ? '' : `${Math.round(value * 100)}%`

// Why a reply wrote its context to the cache again. Changing effort keeps the cache.
export const rewriteReason: Record<CacheRewriteReason, string> = {
  start: 'First reply',
  expired: 'Cache expired (over an hour idle)',
  model: 'Model changed',
  compact: 'After compacting',
  other: 'Start of the prompt changed (tools, MCP servers or instructions)',
}

// One line for the cache chip's tooltip.
export function statsLine(stats: CacheStats | null | undefined) {
  if (!stats?.replies) return ''
  const rewrites = stats.rewriteCount ? ` ${stats.rewriteCount} full rewrite${stats.rewriteCount === 1 ? '' : 's'}${stats.rewriteUsd != null ? ` (about ${usd(stats.rewriteUsd)})` : ''}.` : ' No full rewrites.'
  return ` This chat: ${percent(stats.hitRate)} of input read from the cache over ${stats.replies} replies.${rewrites}`
}
