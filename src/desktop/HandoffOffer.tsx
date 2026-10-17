import { useEffect, useState } from 'react'
import { api, onServiceEvent, reportError, selectChat } from './client'
import type { ChatSession, Handoff } from './types'
import { Icon } from './Icons'

interface Stats { supported: boolean; userMessages: number; truncated: boolean; handoff: Handoff | null }
interface Snooze { never?: boolean; after?: number }

const key = (id: string) => `mrmak.handoff.${id}`
function readSnooze(id: string): Snooze { try { return JSON.parse(localStorage.getItem(key(id)) || '{}') || {} } catch { return {} } }
function saveSnooze(id: string, value: Snooze) { try { localStorage.setItem(key(id), JSON.stringify(value)) } catch { /* Applies to this window only. */ } }

// Long chats resend their whole history every turn. After the configured number of
// the user's messages, offer a summary and a fresh chat in the same project.
export default function HandoffOffer({ session, threshold, agentLabel }: { session: ChatSession; threshold: number; agentLabel: string }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [snooze, setSnooze] = useState(() => readSnooze(session.id))
  const [starting, setStarting] = useState(false)
  useEffect(() => {
    let alive = true
    api<Stats>(`/sessions/${session.id}/stats`).then(value => { if (alive) setStats(value) }).catch(() => {})
    return () => { alive = false }
  }, [session.id, session.completionVersion])
  useEffect(() => onServiceEvent(event => { if (event.type === 'handoff' && event.id === session.id && event.handoff) { const handoff = event.handoff; setStats(current => current && { ...current, handoff }) } }), [session.id])
  const dismiss = (value: Snooze) => { saveSnooze(session.id, value); setSnooze(value) }
  const job = stats?.handoff
  const count = stats?.userMessages || 0
  if (job?.status === 'summarizing' || job?.status === 'opening') return <div className="handoff-offer working" role="status"><i /><span>{job.status === 'summarizing' ? `${agentLabel} is writing a handoff summary. A new chat opens when it is ready.` : 'Opening the new chat with the handoff…'}</span></div>
  if (job?.status === 'failed') return <div className="handoff-offer failed" role="alert"><Icon name="bell" size={14} /><span>{job.error || 'The handoff could not be completed.'}</span><button onClick={() => { setStats(current => current && { ...current, handoff: null }) }}>Dismiss</button></div>
  if (job?.status === 'done' && !snooze.never) return <div className="handoff-offer" role="status"><Icon name="chats" size={14} /><span>This work continues in a new chat. The handoff is saved in inbox/handoffs.</span>{job.sessionId && <button onClick={() => selectChat(job.sessionId!)}>Open new chat</button>}<button onClick={() => dismiss({ never: true })}>Dismiss</button></div>
  const due = threshold > 0 && !!stats?.supported && (stats.truncated || count >= threshold) && !snooze.never && count >= (snooze.after || 0)
  if (!due) return null
  async function start() {
    setStarting(true)
    try { const handoff = await api<Handoff>(`/sessions/${session.id}/handoff`, {}); setStats(current => current && { ...current, handoff }) }
    catch (error) { reportError(error) } finally { setStarting(false) }
  }
  const working = session.activity === 'working'
  return <div className="handoff-offer" role="status">
    <Icon name="history" size={14} />
    <span><strong>{stats?.truncated ? 'This chat is very long.' : `${count} messages in this chat.`}</strong> Every turn resends the whole conversation, so continuing in a fresh chat with a summary can save tokens.</span>
    <button className="primary" disabled={starting || working || session.status !== 'running'} title={working ? 'Available when the agent finishes its turn' : `${agentLabel} writes a handoff; a new chat in the same project starts from it`} onClick={() => void start()}>Summarize and continue</button>
    <button onClick={() => dismiss({ after: count + Math.max(10, Math.round(threshold / 2)) })}>Later</button>
    <button onClick={() => dismiss({ never: true })}>Not for this chat</button>
  </div>
}
