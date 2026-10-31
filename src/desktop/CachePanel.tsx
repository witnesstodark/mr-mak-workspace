import type { CacheStats, ChatCache } from './chatModel'
import { percent, rewriteReason, tokens, usd } from './cacheText'

const clock = (value: string) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// The Session Rail's Cache view: the cache's state now, how much of this chat's
// input came from it, and each reply that wrote the whole context again and why.
export default function CachePanel({ cache, stats, now }: { cache: ChatCache | null; stats: CacheStats | null; now: number }) {
  if (!cache && !stats?.replies) return <p className="session-rail-note">The prompt cache appears here after Claude's first reply in this chat.</p>
  const left = cache ? Date.parse(cache.expiresAt) - now : 0, cold = !cache || left <= 0
  const hit = stats?.hitRate ?? null
  const rewrites = stats?.rewrites.filter(item => item.reason !== 'start') || []
  return <div className="cache-panel">
    {cache && <section className={`cache-panel-now ${cold ? 'cold' : 'warm'}`}>
      <strong>{cold ? 'Cold' : `Warm · ${Math.max(1, Math.ceil(left / 60000))} min left`}</strong>
      <p>{tokens(cache.tokens)} tokens of context, counted from the last reply at {clock(cache.at)}. {cold
        ? `The next message writes it all again${cache.writeUsd != null ? `, about ${usd(cache.writeUsd)} at list prices` : ''}.`
        : `A message now reads it${cache.readUsd != null ? ` for about ${usd(cache.readUsd)}` : ''}; after it expires, writing it again costs${cache.writeUsd != null ? ` about ${usd(cache.writeUsd)}` : ' more'}.`}</p>
    </section>}
    {stats && stats.replies > 0 && <section>
      <h3 className="session-rail-heading">This chat</h3>
      <div className="cache-panel-bar" role="meter" aria-label="Input read from the cache" aria-valuemin={0} aria-valuemax={100} aria-valuenow={hit == null ? 0 : Math.round(hit * 100)}><span style={{ width: `${hit == null ? 0 : Math.round(hit * 100)}%` }} /></div>
      <dl className="cache-panel-figures">
        <dt>Read from cache</dt><dd>{percent(hit)} · {tokens(stats.read)}{stats.readUsd != null && ` · ${usd(stats.readUsd)}`}</dd>
        <dt>Written to cache</dt><dd>{tokens(stats.written)}{stats.writeUsd != null && ` · ${usd(stats.writeUsd)}`}</dd>
        <dt>Uncached input</dt><dd>{tokens(stats.uncached)}</dd>
        <dt>Replies</dt><dd>{stats.replies}</dd>
        <dt>Full rewrites</dt><dd>{stats.rewriteCount}{stats.rewriteUsd != null && stats.rewriteCount > 0 && ` · ${usd(stats.rewriteUsd)}`}</dd>
      </dl>
    </section>}
    <h3 className="session-rail-heading">Full rewrites</h3>
    {rewrites.length ? <ol className="cache-panel-rewrites">{rewrites.map(item => <li key={item.at}>
      <span className={`cache-reason ${item.reason}`}>{rewriteReason[item.reason]}</span>
      <small>{clock(item.at)} · {tokens(item.tokens)} tokens{item.writeUsd != null && ` · ${usd(item.writeUsd)}`}</small>
    </li>)}</ol> : <p className="session-rail-note">None yet. Each reply has read the conversation from the cache.</p>}
    <p className="session-rail-note">Changing effort keeps the cache. An hour without a reply, a model change or compacting writes the context again. Costs are list prices; on a subscription they count against usage limits.</p>
  </div>
}
