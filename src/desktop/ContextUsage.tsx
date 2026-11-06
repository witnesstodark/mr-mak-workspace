import type { ChatSession } from './types'

const number = new Intl.NumberFormat('en-US')

export default function ContextUsage({ session, connected }: { session: ChatSession; connected: boolean }) {
  const usage = session.contextUsage
  const used = connected ? usage?.usedTokens ?? null : null
  const limit = connected ? usage?.limitTokens ?? null : null
  const percent = used !== null && limit !== null && limit > 0 ? Math.round(used / limit * 100) : null
  const detail = !connected ? 'Unknown · disconnected'
    : used !== null ? limit === null ? `${number.format(used)} tokens · limit unknown` : `${percent}% used · ${number.format(used)} / ${number.format(limit)} tokens`
    : usage?.reason === 'unavailable' || !['codex', 'claude', 'opencode', 'antigravity'].includes(session.agent) ? 'Unavailable'
    : usage?.reason === 'compacted' ? 'Unknown · waiting after compact'
    : limit !== null ? `Unknown · limit ${number.format(limit)} tokens`
    : 'Unknown · waiting for native data'
  const title = [
    'Latest reported context occupancy. This is not cumulative token consumption.',
    usage?.source === 'claude' ? 'Claude: latest request input, including cache. The limit is the context window of the model that answered.' : '',
    usage?.source === 'antigravity' ? 'Antigravity: the CLI estimate of the latest request context and its context limit.' : '',
    usage?.source === 'opencode' ? 'OpenCode: latest completed message tokens. The event does not report a context limit.' : '',
    usage?.updatedAt ? `Native report: ${usage.updatedAt}` : '',
  ].filter(Boolean).join(' ')
  return <div className="chat-context-usage" role="status" aria-label="Session context usage" title={title}>
    <span>Context <strong>{detail}</strong></span>
    {percent !== null && <meter min={0} max={100} value={Math.min(100, percent)} aria-label="Context used" />}
  </div>
}
