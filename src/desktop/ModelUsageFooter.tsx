import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { AgentId, ModelRateLimitWindow, ModelUsageStats } from './types'
import { DASH, current, formatReset, planLimits, shown, tone } from './planLimits'

// The chat footer shows only how much of the plan's 5-hour session window and weekly
// window is used. Everything else is in the tooltip. A value no CLI reported is "—".

function formatTokens(num: number): string {
  if (!num || num <= 0) return '0'
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (num >= 1_000) return Math.round(num / 1_000) + 'k'
  return String(num)
}


function agentTitle(agent: string): string {
  if (agent === 'claude') return 'Claude Code'
  if (agent === 'codex') return 'Codex'
  if (agent === 'antigravity') return 'Antigravity'
  return agent
}

function MiniBar({ value }: { value: number | null }) {
  return <span className="usage-mini-bar" aria-hidden="true"><span className={`usage-mini-fill tone-${tone(value)}`} style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} /></span>
}

function LimitRow({ title, window, now }: { title: string; window: ModelRateLimitWindow | null; now: number }) {
  const used = window?.usedPercent ?? null
  return <div className="usage-limit-block">
    <div className="usage-row-heading"><span>{title}</span><strong>{used === null ? DASH : `${Math.round(used)}% used`}</strong></div>
    <div className="usage-bar-track"><div className={`usage-bar-fill tone-${tone(used)}`} style={{ width: `${Math.min(100, Math.max(0, used ?? 0))}%` }} /></div>
    <p className="usage-row-sub">{window ? formatReset(window.resetsAt, now) : 'Not reported yet'}</p>
  </div>
}

function sourceNote(agent: AgentId, usage: ModelUsageStats | null | undefined, known: boolean): string {
  const asOf = usage?.fetchedAt ? ` · as of ${new Date(usage.fetchedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''
  if (agent === 'claude') {
    if (usage?.source === 'statusline') return `From Claude Code's status line${asOf}. It updates after each reply.`
    if (usage?.source === 'cache') return `From Claude Code's cached /usage data${asOf}.`
    return 'Claude Code reports plan limits to Mr. Mak after its first reply in a chat Mr. Mak started. A status line you set up yourself takes precedence, and then they stay unknown.'
  }
  if (agent === 'codex') return known ? 'From the limits Codex reported with its last reply.' : 'Codex has not reported plan limits in this chat yet.'
  return `${agentTitle(agent)} does not report plan limits.`
}

export default function ModelUsageFooter({ agent, usage, model }: { agent: AgentId; usage: ModelUsageStats | null | undefined; model: string | null }) {
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const tooltipId = useId()
  const open = hover || focused || pinned
  // Reset times and expired windows follow the clock between stats reads.
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer) }, [])
  // The tooltip opens above the chip and stays inside a narrow window.
  const tip = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = tip.current
    if (!open || !node) return
    node.style.right = ''
    const box = node.getBoundingClientRect()
    const shift = box.left < 8 ? 8 - box.left : box.right > window.innerWidth - 8 ? window.innerWidth - 8 - box.right : 0
    if (shift) node.style.right = `${-shift}px`
  }, [open])
  if (!['claude', 'codex', 'antigravity'].includes(agent)) return null

  const { list, general, session, weekly, sessionLabel } = planLimits(usage, now)
  const sessionUsed = session?.usedPercent ?? null, weeklyUsed = weekly?.usedPercent ?? null
  const overall = tone(Math.max(sessionUsed ?? 0, weeklyUsed ?? 0))
  const others = list.filter(item => item.isExclusive && current(item.primary, now))
  const tokens = usage?.tokens
  const contextPct = tokens && typeof tokens.contextPercent === 'number' ? tokens.contextPercent : null
  const summary = `${sessionLabel === '5h' ? '5-hour' : sessionLabel} limit ${sessionUsed === null ? 'unknown' : `${Math.round(sessionUsed)}% used`}, weekly limit ${weeklyUsed === null ? 'unknown' : `${Math.round(weeklyUsed)}% used`}`

  return (
    <div className="chat-status-usage-wrap" onMouseEnter={() => { setNow(Date.now()); setHover(true) }} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        className={`chat-status-usage tone-${overall}`}
        aria-label={`Plan usage: ${summary}`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onFocus={() => { setNow(Date.now()); setFocused(true) }}
        onBlur={() => { setFocused(false); setPinned(false) }}
        onClick={() => { setNow(Date.now()); setPinned(value => !value) }}
        onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setPinned(false); setFocused(false); setHover(false) } }}
      >
        <span className="usage-chip-block">
          <span className="usage-chip-label">{sessionLabel}</span>
          <MiniBar value={sessionUsed} />
          <span className="usage-chip-num">{shown(sessionUsed)}</span>
        </span>
        <span className="usage-chip-block">
          <span className="usage-chip-label">Week</span>
          <MiniBar value={weeklyUsed} />
          <span className="usage-chip-num">{shown(weeklyUsed)}</span>
        </span>
      </button>

      {open && (
        <div ref={tip} className="chat-usage-tooltip" role="tooltip" id={tooltipId}>
          <header className="usage-tooltip-header">
            <div><strong>{agentTitle(agent)}</strong>{general?.planType && <span className="usage-plan-badge">{general.planType}</span>}</div>
            <small>{model || DASH}</small>
          </header>
          <div className="usage-tooltip-section">
            <div className="usage-section-title">Plan limits</div>
            <LimitRow title={`${sessionLabel === '5h' ? '5-hour' : sessionLabel} session`} window={session} now={now} />
            <LimitRow title="Weekly" window={weekly} now={now} />
            {others.map(item => <LimitRow key={item.limitId} title={item.limitName || item.limitId} window={current(item.primary, now)} now={now} />)}
          </div>
          <div className="usage-tooltip-section">
            <div className="usage-section-title">Context window</div>
            <div className="usage-row-heading"><span>Used</span><strong>{contextPct === null ? DASH : `${contextPct}%`}</strong></div>
            <p className="usage-row-detail">{tokens && tokens.current > 0 ? formatTokens(tokens.current) : DASH} / {tokens?.contextWindow ? formatTokens(tokens.contextWindow) : DASH} tokens</p>
            {tokens && tokens.current > 0 && <p className="usage-row-sub">
              Input {tokens.input.toLocaleString()}{tokens.cached ? ` · Cache ${tokens.cached.toLocaleString()}` : ''}{tokens.output ? ` · Output ${tokens.output.toLocaleString()}` : ''}{tokens.reasoning ? ` · Reasoning ${tokens.reasoning.toLocaleString()}` : ''}
            </p>}
          </div>
          {typeof usage?.costUSD === 'number' && <div className="usage-tooltip-section usage-cost-row"><span>Session cost · list-price estimate</span><strong>${usage.costUSD.toFixed(2)}</strong></div>}
          <div className="usage-tooltip-footer"><span>{sourceNote(agent, usage, !!(session || weekly))}</span></div>
        </div>
      )}
    </div>
  )
}
