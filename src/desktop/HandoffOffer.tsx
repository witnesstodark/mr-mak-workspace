import { useEffect, useState } from 'react'
import { api, onServiceEvent, reportError, selectChat, useDesktop } from './client'
import type { ChatSession, Handoff, ModelUsageStats } from './types'
import { Icon } from './Icons'
import type { ChatCache } from './chatModel'
import { compactCommand, idleCacheAlert, IDLE_CACHE_MINUTES, IDLE_CACHE_MIN_TOKENS } from '../../desktop/service/context-alerts.mjs'

interface Stats { supported: boolean; userMessages: number; truncated: boolean; usage?: ModelUsageStats | null; cache?: ChatCache | null; handoff: Handoff | null }
interface Snooze { never?: boolean; after?: number }

const key = (id: string) => `mrmak.handoff.${id}`
function readSnooze(id: string): Snooze { try { return JSON.parse(localStorage.getItem(key(id)) || '{}') || {} } catch { return {} } }
function saveSnooze(id: string, value: Snooze) { try { localStorage.setItem(key(id), JSON.stringify(value)) } catch { /* Applies to this window only. */ } }
// The idle period, named by its last model request, whose cache alert was dismissed or acted on.
const idleKey = (id: string) => `mrmak.idleCache.${id}`
function readIdle(id: string) { try { return localStorage.getItem(idleKey(id)) } catch { return null } }
function saveIdle(id: string, at: string) { try { localStorage.setItem(idleKey(id), at) } catch { /* Applies to this window only. */ } }
const thousands = (tokens: number) => `${Math.round(tokens / 1000)}k`

// Long chats resend their whole history every turn. After the configured number of
// the user's messages, offer the CLI's own /compact first and a summary in a fresh
// chat second. An idle Claude chat with a large context also offers /compact shortly
// before its prompt cache expires. Nothing is compacted without the user's click.
export default function HandoffOffer({ session, threshold, agentLabel }: { session: ChatSession; threshold: number; agentLabel: string }) {
  const { settings } = useDesktop()
  const idleMinutes = settings.idleCacheMinutes ?? IDLE_CACHE_MINUTES
  const minTokens = settings.idleCacheMinTokens ?? IDLE_CACHE_MIN_TOKENS
  const [stats, setStats] = useState<Stats | null>(null)
  const [snooze, setSnooze] = useState(() => readSnooze(session.id))
  const [idleDone, setIdleDone] = useState(() => readIdle(session.id))
  const [starting, setStarting] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const watchIdle = session.agent === 'claude' && idleMinutes > 0
  const lastRequest = Date.parse(stats?.usage?.at || '')
  // Read the transcript again when the idle time is reached, so the alert never relies on stale usage.
  const idleReached = watchIdle && Number.isFinite(lastRequest) && now - lastRequest >= idleMinutes * 60000
  useEffect(() => {
    let alive = true
    api<Stats>(`/sessions/${session.id}/stats`).then(value => { if (alive) setStats(value) }).catch(() => {})
    return () => { alive = false }
  }, [session.id, session.completionVersion, session.activity, idleReached])
  useEffect(() => {
    if (!watchIdle) return
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [watchIdle])
  useEffect(() => onServiceEvent(event => { if (event.type === 'handoff' && event.id === session.id && event.handoff !== undefined) { const handoff = event.handoff; setStats(current => current && { ...current, handoff }) } }), [session.id])
  const dismiss = (value: Snooze) => { saveSnooze(session.id, value); setSnooze(value) }
  const dismissIdle = (at: string) => { saveIdle(session.id, at); setIdleDone(at) }
  const job = stats?.handoff
  const count = stats?.userMessages || 0
  if (job?.status === 'summarizing' || job?.status === 'opening') return <div className="handoff-offer working" role="status"><i /><span>{job.status === 'opening' ? 'Opening the new chat with the handoff…' : job.pause ? `${agentLabel} is writing a handoff for your break. Nothing else opens; when you are back, you choose how to continue.` : `${agentLabel} is writing a handoff summary. A new chat opens when it is ready.`}</span></div>
  if (job?.status === 'paused') {
    const warm = !!stats?.cache && Date.parse(stats.cache.expiresAt) > now
    const resume = async (then: 'new-chat' | 'keep') => {
      setStarting(true)
      try { const handoff = await api<Handoff | null>(`/sessions/${session.id}/pause`, { then }); setStats(current => current && { ...current, handoff }) }
      catch (error) { reportError(error) } finally { setStarting(false) }
    }
    return <div className="handoff-offer" role="status"><Icon name="coffee" size={14} />
      <span><strong>Paused at {new Date(job.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} with a handoff.</strong> {warm ? 'The prompt cache is still warm, so continuing here is cheapest.' : "This chat's prompt cache has expired; a new chat from the handoff starts with a small context."}</span>
      <button className={warm ? undefined : 'primary'} disabled={starting} title={job.file || undefined} onClick={() => void resume('new-chat')}>Continue in a new chat</button>
      <button className={warm ? 'primary' : undefined} disabled={starting} onClick={() => void resume('keep')}>Keep this chat</button>
    </div>
  }
  if (job?.status === 'failed') return <div className="handoff-offer failed" role="alert"><Icon name="bell" size={14} /><span>{job.error || 'The handoff could not be completed.'}</span><button onClick={() => { setStats(current => current && { ...current, handoff: null }) }}>Dismiss</button></div>
  if (job?.status === 'done' && !snooze.never) return <div className="handoff-offer" role="status"><Icon name="chats" size={14} /><span>This work continues in a new chat. The handoff is saved in inbox/handoffs.</span>{job.sessionId && <button onClick={() => selectChat(job.sessionId!)}>Open new chat</button>}<button onClick={() => dismiss({ never: true })}>Dismiss</button></div>
  const command = compactCommand(session.agent)
  const canHandoff = session.agent === 'claude' || session.agent === 'codex'
  // A compacted chat starts over: neither alert returns for the context it replaced.
  async function compact() {
    setCompacting(true)
    try {
      await api(`/sessions/${session.id}/compact`, {})
      if (stats?.usage?.at) dismissIdle(stats.usage.at)
      if (threshold > 0) dismiss({ ...snooze, after: count + threshold })
    } catch (error) { reportError(error) } finally { setCompacting(false) }
  }
  const idle = command ? idleCacheAlert({ agent: session.agent, status: session.status, activity: session.activity, usage: stats?.usage, now, minutes: idleMinutes, minTokens, dismissed: idleDone }) : null
  if (idle) return <div className="handoff-offer" role="status">
    <Icon name="bell" size={14} />
    <span><strong>Idle for {idle.idleMinutes} min · {thousands(idle.tokens)} tokens of context.</strong> {agentLabel}'s prompt cache for this chat ends in about {idle.expiresInMinutes} min. After that, your next message caches the whole conversation again; compacting now, while the cache is warm, makes your return cheaper.</span>
    <button className="primary" disabled={compacting} title={`Sends ${command} to this chat`} onClick={() => void compact()}>Compact now</button>
    <button onClick={() => dismissIdle(idle.at)}>Dismiss</button>
  </div>
  const due = threshold > 0 && (!!command || canHandoff) && !!stats?.supported && (stats.truncated || count >= threshold) && !snooze.never && count >= (snooze.after || 0)
  if (!due) return null
  async function start() {
    setStarting(true)
    try { const handoff = await api<Handoff>(`/sessions/${session.id}/handoff`, {}); setStats(current => current && { ...current, handoff }) }
    catch (error) { reportError(error) } finally { setStarting(false) }
  }
  const working = session.activity === 'working'
  const ready = session.activity === 'idle' && session.status === 'running'
  const advice = command && canHandoff ? 'Compact replaces it with a summary in this chat; Summarize and continue opens a fresh chat from a handoff.'
    : command ? 'Compact replaces it with a summary in this chat, which saves tokens on every later turn.'
    : 'Continuing in a fresh chat with a summary can save tokens.'
  return <div className="handoff-offer" role="status">
    <Icon name="history" size={14} />
    <span><strong>{stats?.truncated ? 'This chat is very long.' : `${count} messages in this chat.`}</strong> Every turn resends the whole conversation. {advice}</span>
    {command && <button className="primary" disabled={compacting || starting || !ready} title={ready ? `Sends ${command} to ${agentLabel}, which summarizes the conversation and continues in this chat` : 'Available when the agent finishes its turn'} onClick={() => void compact()}>Compact</button>}
    {canHandoff && <button className={command ? undefined : 'primary'} disabled={starting || compacting || working || session.status !== 'running'} title={working ? 'Available when the agent finishes its turn' : `${agentLabel} writes a handoff; a new chat in the same project starts from it`} onClick={() => void start()}>Summarize and continue</button>}
    <button onClick={() => dismiss({ after: count + Math.max(10, Math.round(threshold / 2)) })}>Later</button>
    <button onClick={() => dismiss({ never: true })}>Not for this chat</button>
  </div>
}
