import { useEffect, useState } from 'react'
import type { CacheStats, ChatCache } from './chatModel'
import { statsLine, tokens, usd } from './cacheText'

// Claude's prompt cache for this chat: warm with the time left, or cold. The first
// message to a large cold chat is held once with its cost (see chat-cache.mjs).
// With `onOpen` it opens the Session Rail's Cache view.
export default function CacheChip({ cache, stats, onOpen }: { cache: ChatCache | null; stats?: CacheStats | null; onOpen?: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  if (!cache) return null
  const left = Date.parse(cache.expiresAt) - now, cold = left <= 0
  const minutes = Math.max(0, Math.ceil(left / 60000))
  const cost = cache.writeUsd != null ? ` Rewriting it costs about ${usd(cache.writeUsd)} at list prices; a warm message reads it for ${usd(cache.readUsd)}.` : ''
  const title = (cold
    ? `Prompt cache cold: the last reply was over an hour ago, so the next message rewrites ${tokens(cache.tokens)} tokens.${cost}${cache.tokens >= 50000 ? ' Mr. Mak holds the first message once so you can decide.' : ''}`
    : `Prompt cache warm for ${minutes} more min (${tokens(cache.tokens)} tokens), counted from the last reply.${cost}`)
    + statsLine(stats) + (onOpen ? ' Click for details.' : '')
  const body = <><i aria-hidden="true" />{cold ? 'Cache cold' : `Cache ${minutes} min`}</>
  return onOpen
    ? <button type="button" className={`cache-chip ${cold ? 'cold' : 'warm'}`} title={title} aria-label={title} onClick={onOpen}>{body}</button>
    : <span className={`cache-chip ${cold ? 'cold' : 'warm'}`} title={title} aria-label={title}>{body}</span>
}
