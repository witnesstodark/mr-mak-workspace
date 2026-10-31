import { useEffect, useState } from 'react'
import { api, reportError, selectChat, useDesktop } from './client'
import type { ChatSession } from './types'
import { planAttention, planProgress, type ChatPlan } from './chatPlan'
import { Icon } from './Icons'
import { railPanelEvent, railPanelKey, requestConversationJump, store, stored, type RailPanel } from './sessionRailState'
import type { CacheStats, ChatCache } from './chatModel'
import CachePanel from './CachePanel'
import './session-rail.css'

interface RailChat { id: string; name: string; open: boolean; status: ChatSession['status']; activity: ChatSession['activity'] }
interface RailSession { id: string; title: string; importName: string; firstPrompt: string; lastPrompt: string; updatedAt: string; size: number; contextTokens: number | null; current: boolean; chat: RailChat | null }
interface RailPrompt { id: string; at: string; text: string; shown: boolean }
interface Rail { folder: string; total: number; supported: boolean; truncated: boolean; prompts: RailPrompt[]; sessions: RailSession[] }
type Panel = RailPanel
const panels: Panel[] = ['plan', 'sessions', 'prompts', 'cache']
const statusMark = { pending: '○', in_progress: '◐', completed: '●' }
const until = (value: string, now: number) => { const minutes = Math.round((Date.parse(value) - now) / 60000); return minutes <= 0 ? 'due now' : minutes < 60 ? `in ${minutes} min` : `at ${new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` }

function ago(value: string, now: number) {
  const minutes = Math.floor((now - Date.parse(value)) / 60000)
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })
}
const bytes = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
const tokens = (value: number) => value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
const clock = (value: string) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

// Another Claude Code window may still be writing a conversation nobody here holds.
const elsewhere = (item: RailSession, now: number) => !item.current && item.chat?.status !== 'running' && now - Date.parse(item.updatedAt) < 90000
function badge(item: RailSession, now: number) {
  if (item.current) return { label: 'This chat', tone: 'current' }
  if (item.chat?.status === 'running') return item.chat.activity === 'working' ? { label: 'Working', tone: 'working' } : item.chat.activity === 'waiting' ? { label: 'Waiting', tone: 'waiting' } : { label: 'Idle · open', tone: 'open' }
  if (elsewhere(item, now)) return { label: 'Active elsewhere?', tone: 'elsewhere' }
  return item.chat ? { label: 'In History', tone: 'history' } : null
}

// The plan comes first and is the only view of chats other than Claude Code's.
export default function SessionRail({ session, plan, cache = null, cacheStats = null, conversation, showConversation, onClose }: { session: ChatSession; plan: ChatPlan | null; cache?: ChatCache | null; cacheStats?: CacheStats | null; conversation: boolean; showConversation: () => void; onClose: () => void }) {
  const desktop = useDesktop()
  const claude = session.agent === 'claude'
  const [chosen, setPanel] = useState<Panel>(() => { const value = stored(railPanelKey) as Panel; return panels.includes(value) ? value : 'plan' })
  useEffect(() => {
    const show = (event: Event) => { const value = (event as CustomEvent<Panel>).detail; if (panels.includes(value)) setPanel(value) }
    window.addEventListener(railPanelEvent, show)
    return () => window.removeEventListener(railPanelEvent, show)
  }, [])
  const panel: Panel = claude ? chosen : 'plan'
  const [rail, setRail] = useState<Rail | null>(null), [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now()), [query, setQuery] = useState('')
  const [opening, setOpening] = useState(''), [confirm, setConfirm] = useState('')
  useEffect(() => {
    if (!claude) return
    let stopped = false, busy = false
    const load = async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const value = await api<Rail>(`/sessions/${session.id}/rail`)
        if (!stopped) { setRail(value); setError(''); setNow(Date.now()) }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { busy = false }
    }
    void load()
    const timer = window.setInterval(load, 5000)
    window.addEventListener('focus', load)
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', load) }
  }, [claude, session.id, session.nativeId, session.completionVersion])
  const choose = (value: Panel) => { setPanel(value); store(railPanelKey, value) }
  // The cache view counts down between transcript reads.
  useEffect(() => {
    if (panel !== 'cache') return
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [panel])
  const match = (...texts: string[]) => !query.trim() || texts.join(' ').normalize('NFC').toLowerCase().includes(query.trim().normalize('NFC').toLowerCase())

  async function open(item: RailSession) {
    if (item.current || opening) return
    if (elsewhere(item, now) && confirm !== item.id) { setConfirm(item.id); return }
    setOpening(item.id); setConfirm('')
    try {
      // A conversation started outside Mr. Mak joins History first, as New chat → Resume does.
      const id = item.chat?.id || (await api<ChatSession>('/history/import', { agent: 'claude', nativeId: item.id, name: item.importName, cwd: session.cwd, bypass: desktop.settings.defaultBypass })).id
      const chat = desktop.sessions.find(entry => entry.id === id)
      if (!chat?.open || chat.status !== 'running') await api(`/sessions/${id}/resume`, {})
      selectChat(id)
    } catch (cause) { reportError(cause) } finally { setOpening('') }
  }
  function jump(prompt: RailPrompt) {
    if (!prompt.shown) return
    requestConversationJump(session.id, prompt.id)
    if (!conversation) showConversation()
  }

  const sessions = (rail?.sessions || []).filter(item => match(item.title, item.chat?.name || '', item.firstPrompt, item.lastPrompt))
  const attention = planAttention(plan, session), progress = planProgress(plan)
  const prompts = (rail?.prompts || []).map((item, index) => ({ ...item, number: index + 1 })).filter(item => match(item.text)).reverse()
  return <aside className="session-rail" aria-label={claude ? 'Session rail' : 'Plan'}>
    <header><h2>{claude ? 'Session rail' : 'Plan'}</h2><button className="desk-icon" onClick={onClose} title="Close session rail" aria-label="Close session rail"><Icon name="close" size={15} /></button></header>
    {claude && <div className="session-rail-tabs" role="tablist" aria-label="Session rail view">
      <button role="tab" aria-selected={panel === 'plan'} className={attention ? 'attention' : ''} onClick={() => choose('plan')}>Plan{progress && <small>{progress.done}/{progress.total}</small>}</button>
      <button role="tab" aria-selected={panel === 'sessions'} onClick={() => choose('sessions')}>Sessions{rail && <small>{rail.total}</small>}</button>
      <button role="tab" aria-selected={panel === 'prompts'} onClick={() => choose('prompts')}>Prompts{rail && <small>{rail.prompts.length}</small>}</button>
      <button role="tab" aria-selected={panel === 'cache'} className={cache?.cold ? 'cold' : ''} onClick={() => choose('cache')}>Cache</button>
    </div>}
    {(panel === 'sessions' || panel === 'prompts') && <div className="session-rail-filter"><Icon name="search" size={13} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={panel === 'sessions' ? 'Filter sessions…' : 'Filter prompts…'} aria-label={panel === 'sessions' ? 'Filter sessions' : 'Filter prompts'} /></div>}
    {error && <p className="session-rail-note desk-error-inline">{error}</p>}
    <div className="session-rail-list" role="list">
      {(panel === 'sessions' || panel === 'prompts') && !rail && !error && <p className="session-rail-note">Loading…</p>}
      {panel === 'sessions' && sessions.map(item => {
        const state = badge(item, now)
        return <div role="listitem" key={item.id} className={`session-rail-entry ${item.current ? 'current' : ''}`}>
          <button className="session-rail-item" onClick={() => void open(item)} disabled={!!opening} aria-current={item.current ? 'true' : undefined}
            title={item.current ? 'This chat' : item.chat ? `Open ${item.chat.name}` : `Resume ${item.title} in a new tab`}>
            <strong>{item.chat?.name && item.chat.name !== item.title ? item.chat.name : item.title}</strong>
            {(item.lastPrompt || item.firstPrompt) && <p>{item.lastPrompt || item.firstPrompt}</p>}
            <small>{state && <span className={`session-rail-badge ${state.tone}`}>{state.label}</span>}<span>{opening === item.id ? 'Opening…' : ago(item.updatedAt, now)}</span><span>{bytes(item.size)}</span>{item.contextTokens != null && <span title="Context used by the last reply">{tokens(item.contextTokens)} context</span>}</small>
          </button>
          {confirm === item.id && <div className="session-rail-confirm" role="alert"><p>Updated moments ago, possibly by another Claude Code window. Opening it here too can split the conversation.</p><button onClick={() => void open(item)}>Open anyway</button><button onClick={() => setConfirm('')}>Cancel</button></div>}
        </div>
      })}
      {panel === 'sessions' && rail && !sessions.length && <p className="session-rail-note">{query ? 'No matching sessions.' : 'No Claude Code conversations in this folder yet.'}</p>}
      {panel === 'prompts' && prompts.map(item => <div role="listitem" key={item.id}>
        <button className="session-rail-prompt" disabled={!item.shown} onClick={() => jump(item)} title={item.shown ? 'Show this message in Conversation' : 'Older than the messages Conversation shows. The terminal keeps the full history.'}>
          <span>#{item.number}</span><span className={/^\/btw\s/.test(item.text) ? 'btw' : ''}>{item.text}</span><time>{clock(item.at)}</time>
        </button>
      </div>)}
      {panel === 'plan' && <PlanView plan={plan} attention={attention} now={now} />}
      {panel === 'cache' && <CachePanel cache={cache} stats={cacheStats} now={now} />}
      {panel === 'prompts' && rail && !prompts.length && <p className="session-rail-note">{query ? 'No matching prompts.' : rail.supported ? 'Your prompts in this conversation appear here.' : 'This conversation could not be read yet.'}</p>}
    </div>
    <footer title={rail?.folder}>{panel === 'cache' ? "Read from this chat's transcript" : panel === 'plan' ? plan?.updatedAt ? `Updated ${ago(plan.updatedAt, now)}` : 'Kept by the agent in .agents/plans' : panel === 'sessions' ? rail && rail.total > rail.sessions.length ? `Newest ${rail.sessions.length} of ${rail.total} in this folder` : 'Claude Code conversations in this folder' : rail?.truncated ? 'Prompts from the latest part of a long conversation' : 'Newest first · click to jump'}</footer>
  </aside>
}

const planStatus = { working: 'Working', 'needs review': 'Needs review', blocked: 'Blocked', done: 'Done' }

function PlanView({ plan, attention, now }: { plan: ChatPlan | null; attention: string; now: number }) {
  if (!plan) return <p className="session-rail-note">Loading…</p>
  const progress = planProgress(plan)
  if (!progress && !plan.request && !plan.schedules.length) return <>
    {attention && <p className="plan-attention" role="status">{attention}</p>}
    <p className="session-rail-note">When the agent starts a task with more than one step, its plan appears here: the request, each step and what comes next. New Claude Code, Codex and OpenCode chats are asked to keep one.</p>
  </>
  return <div className="plan-view">
    {attention && <p className="plan-attention" role="status">{attention}</p>}
    {plan.request && <section><h3 className="session-rail-heading">Request</h3><p className="plan-request">{plan.request}</p></section>}
    {progress && <section>
      <div className="plan-progress-head"><h3 className="session-rail-heading">Plan</h3><span>{progress.done}/{progress.total}</span>{plan.status && <span className={`plan-status ${plan.status.replace(' ', '-')}`}>{planStatus[plan.status]}</span>}</div>
      <div className="plan-progress" role="progressbar" aria-label="Plan progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><span style={{ width: `${Math.round(progress.done / progress.total * 100)}%` }} /></div>
      <ol className="session-rail-plan" aria-label="Plan checklist">{plan.tasks.map(item => <li key={item.id} className={item.status} title={item.status.replace('_', ' ')}>
        <span aria-hidden="true">{statusMark[item.status]}</span><span>{item.status === 'in_progress' && item.activeForm ? item.activeForm : item.subject}</span>
      </li>)}</ol>
    </section>}
    {plan.next && <p className="plan-next"><strong>Next</strong> {plan.next}</p>}
    {plan.schedules.length > 0 && <><h3 className="session-rail-heading">Scheduled</h3>{plan.schedules.map((item, index) => <div key={item.id || index} className="session-rail-schedule">
      <small>{item.kind === 'wakeup' && item.at ? `Resumes ${until(item.at, now)}` : `${item.recurring ? 'Repeats' : 'Once'} · ${item.schedule || ''}`}</small>
      <p>{item.prompt || item.reason}</p>
    </div>)}</>}
  </div>
}
