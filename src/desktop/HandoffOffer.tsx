import { useEffect, useState } from 'react'
import { api, onServiceEvent, reportError, selectChat } from './client'
import type { ChatSession, Handoff } from './types'
import { Icon } from './Icons'

interface Stats { supported: boolean; handoff: Handoff | null }

const number = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 0 })

// How full the context is, from the agent's own latest report. Message counts and
// transcript size say little: a few long tool results can fill a window, many short
// replies cannot.
function contextShare(session: ChatSession) {
  const used = session.contextUsage?.usedTokens, limit = session.contextUsage?.limitTokens
  return used != null && limit != null && limit > 0 ? used / limit : null
}

// Long chats resend their whole context every turn. When it passes the chosen share
// of the window, offer a summary and a fresh chat in the same project.
export default function HandoffOffer({ session, threshold, agentLabel }: { session: ChatSession; threshold: number; agentLabel: string }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [starting, setStarting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let alive = true
    api<Stats>(`/sessions/${session.id}/stats`).then(value => { if (alive) setStats(value) }).catch(() => {})
    return () => { alive = false }
  }, [session.id, session.completionVersion])
  useEffect(() => onServiceEvent(event => { if (event.type === 'handoff' && event.id === session.id && event.handoff) { const handoff = event.handoff; setStats(current => current && { ...current, handoff }) } }), [session.id])
  const snooze = session.handoffSnooze
  const until = snooze?.until ? Date.parse(snooze.until) : 0
  // A day-long "Later" ends while the chat may stay open, so check again when it does.
  useEffect(() => {
    if (until <= now) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(until - now + 1000, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [until, now])
  const dismiss = (value: 'later' | 'never') => api(`/sessions/${session.id}`, { handoffSnooze: value }, 'PATCH').catch(reportError)
  const job = stats?.handoff
  if (job?.status === 'summarizing' || job?.status === 'opening') return <div className="handoff-offer working" role="status"><i /><span>{job.status === 'summarizing' ? `${agentLabel} is writing a handoff summary. A new chat opens when it is ready.` : 'Opening the new chat with the handoff…'}</span></div>
  if (job?.status === 'failed') return <div className="handoff-offer failed" role="alert"><Icon name="bell" size={14} /><span>{job.error || 'The handoff could not be completed.'}</span><button onClick={() => { setStats(current => current && { ...current, handoff: null }) }}>Dismiss</button></div>
  if (job?.status === 'done' && !snooze?.never) return <div className="handoff-offer" role="status"><Icon name="chats" size={14} /><span>This work continues in a new chat. The handoff is saved in inbox/handoffs.</span>{job.sessionId && <button onClick={() => selectChat(job.sessionId!)}>Open new chat</button>}<button onClick={() => void dismiss('never')}>Dismiss</button></div>
  const share = contextShare(session)
  const due = threshold > 0 && !!stats?.supported && share !== null && share >= threshold / 100 && !snooze?.never && until <= now
  if (!due) return null
  async function start() {
    setStarting(true)
    try { const handoff = await api<Handoff>(`/sessions/${session.id}/handoff`, {}); setStats(current => current && { ...current, handoff }) }
    catch (error) { reportError(error) } finally { setStarting(false) }
  }
  const working = session.activity === 'working'
  const usage = session.contextUsage!
  return <div className="handoff-offer" role="status">
    <Icon name="history" size={14} />
    <span><strong>Context is {Math.round(share * 100)}% full</strong> ({number.format(usage.usedTokens!)} of {number.format(usage.limitTokens!)} tokens). Every turn resends it, so a fresh chat that starts from a summary saves tokens.</span>
    <button className="primary" disabled={starting || working || session.status !== 'running'} title={working ? 'Available when the agent finishes its turn' : `${agentLabel} writes a handoff; a new chat in the same project starts from it`} onClick={() => void start()}>Summarize and continue</button>
    <button title="Ask again in 24 hours" onClick={() => void dismiss('later')}>Later</button>
    <button onClick={() => void dismiss('never')}>Not for this chat</button>
  </div>
}
