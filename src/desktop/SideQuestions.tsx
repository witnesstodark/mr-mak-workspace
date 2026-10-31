import { useState } from 'react'
import { reportError } from './client'
import { Icon } from './Icons'
import './side-questions.css'

export interface SideQuestion {
  id: string; question: string; answer: string; at: string; partial?: boolean; closed?: boolean
  status: 'asking' | 'answering' | 'answered' | 'failed' | 'closed' | 'unavailable' | 'stopped'
}

const notes: Partial<Record<SideQuestion['status'], string>> = {
  failed: 'Claude Code could not answer this side question.',
  closed: 'The side question was closed in the terminal before its answer arrived.',
  unavailable: 'Sent as /btw. Its answer could not be read here; it is in the terminal.',
  stopped: 'The terminal stopped before the answer arrived.',
}
const hiddenKey = 'mrmak.btw.hidden'
function savedHidden(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(hiddenKey) || '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [] } catch { return [] }
}
const time = (value: string) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

// Claude Code keeps /btw exchanges out of the conversation, so they sit beside it.
export default function SideQuestions({ items = [], openTerminal }: { items?: SideQuestion[]; openTerminal: () => void }) {
  const [hidden, setHidden] = useState(savedHidden)
  const [copied, setCopied] = useState('')
  const shown = items.filter(item => !hidden.includes(item.id)).slice(-2)
  if (!shown.length) return null
  const hide = (id: string) => {
    const next = [...hidden, id].slice(-200)
    setHidden(next)
    try { localStorage.setItem(hiddenKey, JSON.stringify(next)) } catch { /* Hidden until this view closes. */ }
  }
  const copy = (item: SideQuestion) => navigator.clipboard.writeText(item.answer).then(() => { setCopied(item.id); window.setTimeout(() => setCopied(''), 1400) }).catch(reportError)
  return <aside className="side-questions" aria-label="Side questions" aria-live="polite">{shown.map(item => {
    const waiting = item.status === 'asking' || item.status === 'answering'
    const note = item.partial && item.status === 'answered' ? 'Part of this long answer may be missing. /btw in the terminal shows it again.' : notes[item.status]
    return <section key={item.id} className={`side-question ${item.status}`}>
      <header><span className="side-question-tag">/btw</span><span>Side question · not added to the conversation</span><time>{time(item.at)}</time>
        {!!item.answer && <button type="button" onClick={() => void copy(item)} title="Copy answer" aria-label={copied === item.id ? 'Copied' : 'Copy answer'}><Icon name="copy" size={12} />{copied === item.id && <span>Copied</span>}</button>}
        {!waiting && <button type="button" onClick={() => hide(item.id)} title="Dismiss" aria-label="Dismiss side question"><Icon name="close" size={12} /></button>}
      </header>
      <p className="side-question-ask">{item.question}</p>
      {waiting ? <p className="side-question-wait"><i />{item.status === 'asking' ? 'Asking…' : 'Answering…'}</p> : !!item.answer && <div className="side-question-answer">{item.answer}</div>}
      {!waiting && note && <footer><span>{note}</span><button type="button" onClick={openTerminal}><Icon name="terminal" size={12} />Open terminal</button></footer>}
    </section>
  })}</aside>
}
