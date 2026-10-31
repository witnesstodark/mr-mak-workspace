import { useEffect, useState } from 'react'
import { api, reportError } from './client'
import type { ChatSession } from './types'
import './rules.css'

interface Suggestion { id: string; rule: string; at: string }

// A rule the owner marked with "remember:" or "lembre:" in this chat, waiting to
// be saved to the project, saved for every chat, edited or skipped.
export default function RuleBand({ session }: { session: ChatSession }) {
  const [read, setRead] = useState<{ id: string; items: Suggestion[] } | null>(null)
  const [editing, setEditing] = useState(''), [text, setText] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (session.agent === 'shell') return
    let stopped = false
    const load = () => { if (document.visibilityState !== 'hidden') api<Suggestion[]>(`/sessions/${session.id}/rules`).then(items => { if (!stopped) setRead({ id: session.id, items }) }).catch(() => {}) }
    load()
    const timer = window.setInterval(load, 4000)
    return () => { stopped = true; clearInterval(timer) }
  }, [session.id, session.agent, session.completionVersion])
  const items = read?.id === session.id ? read.items : []
  if (!items.length) return null
  const resolve = async (item: Suggestion, action: 'project' | 'global' | 'skip') => {
    setBusy(true)
    try { setRead({ id: session.id, items: await api<Suggestion[]>(`/sessions/${session.id}/rules`, { id: item.id, action, text: editing === item.id ? text : undefined }) }); setEditing('') }
    catch (cause) { reportError(cause) } finally { setBusy(false) }
  }
  return <div className="rule-band" role="region" aria-label="Rules to save">{items.map(item => <div key={item.id} className="rule-band-item">
    <span className="rule-band-label">Rule</span>
    {editing === item.id ? <input aria-label="Edit the rule" value={text} maxLength={500} autoFocus onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditing(''); if (event.key === 'Enter') void resolve(item, 'project') }} /> : <p title={item.rule}>{item.rule}</p>}
    <div>
      <button disabled={busy || (editing === item.id && !text.trim())} onClick={() => void resolve(item, 'project')} title={`Add to ${session.cwd}/.agents/rules.md`}>Save to project</button>
      <button disabled={busy || (editing === item.id && !text.trim())} onClick={() => void resolve(item, 'global')} title="Every chat Mr. Mak starts gets it">Save as global</button>
      {editing !== item.id && <button disabled={busy} onClick={() => { setEditing(item.id); setText(item.rule) }}>Edit</button>}
      <button disabled={busy} onClick={() => void resolve(item, 'skip')}>Skip</button>
    </div>
  </div>)}</div>
}
