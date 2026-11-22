import type { ChatSession } from './types'
import { t } from '../lib/i18n'

const number = new Intl.NumberFormat('en-US')

export default function ContextUsage({ session, connected }: { session: ChatSession; connected: boolean }) {
  const usage = session.contextUsage
  const used = connected ? usage?.usedTokens ?? null : null
  const limit = connected ? usage?.limitTokens ?? null : null
  const percent = used !== null && limit !== null && limit > 0 ? Math.round(used / limit * 100) : null
  const estimatedLimit = usage?.source === 'claude' && limit !== null
  const detail = !connected ? t('Unknown · disconnected')
    : used !== null ? limit === null ? t('{used} tokens · limit unknown', { used: number.format(used) }) : t('{percent}% used · {used} / {limit} tokens', { percent: percent ?? 0, used: number.format(used), limit: number.format(limit) })
    : usage?.reason === 'unavailable' || !['codex', 'claude', 'opencode', 'antigravity'].includes(session.agent) ? t('Unavailable')
    : usage?.reason === 'compacted' ? t('Unknown · waiting after compact')
    : limit !== null ? t('Unknown · limit {limit} tokens', { limit: number.format(limit) })
    : t('Unknown · waiting for native data')
  const label = estimatedLimit && connected ? `${detail} · ${t('estimated limit')}` : detail
  const title = [
    t('Latest reported context occupancy. This is not cumulative token consumption.'),
    usage?.source === 'claude' ? t('Claude: latest request input, including cache. The limit is estimated from the model name, not reported by the CLI; account or configuration limits may differ.') : '',
    usage?.source === 'antigravity' ? t('Antigravity: the CLI estimate of the latest request context and its context limit.') : '',
    usage?.source === 'opencode' ? t('OpenCode: latest completed message tokens. The event does not report a context limit.') : '',
    usage?.updatedAt ? t('Native report: {time}', { time: usage.updatedAt }) : '',
  ].filter(Boolean).join(' ')
  return <div className="chat-context-usage" role="status" aria-label={t('Session context usage')} title={title}>
    <span>{t('Context')} <strong>{label}</strong></span>
    {percent !== null && <meter min={0} max={100} value={Math.min(100, percent)} aria-label={t('Context used')} />}
  </div>
}
