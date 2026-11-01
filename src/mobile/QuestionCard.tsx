import { useState } from 'react'
import { Icon } from '../desktop/Icons'
import { mobileApi } from './client'

export interface QuestionOption { label: string; description: string; preview?: string }
export interface QuestionItem { question: string; header: string; multiSelect: boolean; options: QuestionOption[] }
export interface PendingQuestion { id: string; at: string; questions: QuestionItem[]; answerable: boolean }
interface Choice { picked: string[]; other: boolean; text: string }
const empty: Choice = { picked: [], other: false, text: '' }

// Claude reads several choices as one comma-separated answer, as its own dialog
// sends them. "Other" sends the user's words.
function answerFor(item: QuestionItem, choice: Choice) {
  const labels = item.options.map(option => option.label).filter(label => choice.picked.includes(label))
  const text = choice.other ? choice.text.trim() : ''
  if (item.multiSelect) return [...labels, ...(text ? [text] : [])].join(', ')
  return choice.other ? text : labels[0] || ''
}

export default function QuestionCard({ sessionId, pending, connected, running, openTerminal }: { sessionId: string; pending: PendingQuestion; connected: boolean; running: boolean; openTerminal: () => void }) {
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [status, setStatus] = useState('')
  const choice = (item: QuestionItem) => choices[item.question] || empty
  const update = (item: QuestionItem, next: Partial<Choice>) => setChoices(current => ({ ...current, [item.question]: { ...(current[item.question] || empty), ...next } }))
  function pick(item: QuestionItem, label: string) {
    const current = choice(item)
    if (item.multiSelect) update(item, { picked: current.picked.includes(label) ? current.picked.filter(value => value !== label) : [...current.picked, label] })
    else update(item, { picked: [label], other: false })
  }
  const answers = Object.fromEntries(pending.questions.map(item => [item.question, answerFor(item, choice(item))]))
  const complete = pending.questions.every(item => answers[item.question])
  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!complete || busy || sent || !pending.answerable) return
    setBusy(true); setStatus('Sending your answer to the terminal…')
    try { await mobileApi(`/sessions/${sessionId}/answer`, { id: pending.id, answers }); setSent(true); setStatus('Answer delivered. Claude is continuing.') }
    catch (err) { setStatus(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  const count = pending.questions.length
  return <form className="mobile-question" onSubmit={send} aria-label="Claude is asking a question">
    <header><Icon name="bell" size={16} /><strong>{count > 1 ? `Claude has ${count} questions` : 'Claude is asking'}</strong><small>Needs your answer</small></header>
    {pending.questions.map((item, index) => {
      const current = choice(item), group = `${pending.id}-${index}`, type = item.multiSelect ? 'checkbox' : 'radio'
      return <fieldset key={item.question} disabled={!pending.answerable || busy || sent}>
        <legend>{item.header && <span className="mobile-question-chip">{item.header}</span>}<span className="mobile-question-text">{item.question}</span></legend>
        <small className="mobile-question-hint">{item.multiSelect ? 'Choose any that apply' : 'Choose one'}</small>
        {item.options.map(option => <label key={option.label} className={`mobile-question-option ${current.picked.includes(option.label) ? 'selected' : ''}`}>
          <input type={type} name={group} checked={current.picked.includes(option.label)} onChange={() => pick(item, option.label)} />
          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}{option.preview && <pre>{option.preview}</pre>}</span>
        </label>)}
        <label className={`mobile-question-option ${current.other ? 'selected' : ''}`}>
          <input type={type} name={group} checked={current.other} onChange={() => update(item, item.multiSelect ? { other: !current.other } : { other: true, picked: [] })} />
          <span><strong>Other</strong><small>Write your own answer</small></span>
        </label>
        {current.other && <textarea aria-label={`Your answer to: ${item.header || item.question}`} rows={2} maxLength={4000} placeholder="Type your answer…" value={current.text} onChange={event => update(item, { text: event.target.value })} />}
      </fieldset>
    })}
    {sent ? null : pending.answerable
      ? <button className="mobile-primary" disabled={!connected || !running || !complete || busy}>{busy ? 'Sending…' : count > 1 ? 'Send answers' : 'Send answer'}<Icon name="send" size={17} /></button>
      : <div className="mobile-question-terminal"><p>Phone answers are not connected to this terminal yet; they start the next time the chat starts. Answer in the Terminal view: arrows to move, Enter to choose, Tab for the next question.</p><button type="button" onClick={openTerminal}>Open terminal<Icon name="arrow" size={15} /></button></div>}
    {status && <p className="mobile-question-status" role="status">{status}</p>}
  </form>
}
