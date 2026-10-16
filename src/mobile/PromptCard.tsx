import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '../desktop/Icons'
import { mobileApi } from './client'

export interface PromptQuestion { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }
export interface PlanChoice { number: number; label: string; feedback: boolean }
export type ChatPrompt =
  | { kind: 'question'; id: string; at: string; onScreen: boolean; questions: PromptQuestion[] }
  | { kind: 'plan'; id: string; at: string; onScreen: boolean; plan: string; choices: PlanChoice[] }

interface Draft { options: string[]; other: string; otherOn: boolean }

// A question or plan approval that Claude shows only in its terminal. The
// computer answers by pressing the keys there, checking the screen at each step.
export default function PromptCard({ sessionId, prompt, openTerminal, answered }: { sessionId: string; prompt: ChatPrompt; openTerminal: () => void; answered: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState(false)
  async function send(body: object) {
    setBusy(true); setError('')
    try { await mobileApi(`/sessions/${sessionId}/answer`, { id: prompt.id, ...body }); setSent(true); answered() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  const title = prompt.kind === 'plan' ? 'Plan ready for your approval' : prompt.questions.length > 1 ? `Claude asks you ${prompt.questions.length} questions` : 'Claude asks you'
  const head = <header><Icon name="bell" size={15} />{title}</header>
  if (sent) return <section className="mobile-prompt sent" role="status">{head}<p>Answer sent. Claude carries on.</p></section>
  if (!prompt.onScreen) return <section className="mobile-prompt">{head}<p className="mobile-prompt-note">Its terminal isn't showing this right now, so it can't be answered here.</p><button type="button" onClick={openTerminal}><Icon name="terminal" size={15} />Open terminal</button></section>
  return <section className="mobile-prompt" aria-label={title}>{head}
    {prompt.kind === 'plan' ? <PlanApproval prompt={prompt} busy={busy} send={send} /> : <Questions prompt={prompt} busy={busy} send={send} />}
    {error && <><p className="mobile-error" role="alert">{error}</p><button type="button" onClick={openTerminal}><Icon name="terminal" size={15} />Open terminal</button></>}
  </section>
}

function Questions({ prompt, busy, send }: { prompt: Extract<ChatPrompt, { kind: 'question' }>; busy: boolean; send: (body: object) => void }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => prompt.questions.map(() => ({ options: [], other: '', otherOn: false })))
  const change = (index: number, next: Partial<Draft>) => setDrafts(current => current.map((draft, at) => at === index ? { ...draft, ...next } : draft))
  const ready = drafts.every(draft => draft.options.length > 0 || (draft.otherOn && draft.other.trim()))
  return <form onSubmit={event => { event.preventDefault(); if (ready) send({ answers: drafts.map(draft => ({ options: draft.options, other: draft.otherOn ? draft.other.trim() : '' })) }) }}>
    {prompt.questions.map((question, index) => {
      const draft = drafts[index], pick = (label: string) => question.multiSelect
        ? change(index, { options: draft.options.includes(label) ? draft.options.filter(item => item !== label) : [...draft.options, label] })
        : change(index, { options: [label], otherOn: false })
      return <fieldset key={index} className="mobile-prompt-question" disabled={busy}>
        <legend>{question.header && <span className="mobile-prompt-chip">{question.header}</span>}{question.question}</legend>
        {question.multiSelect && <small>Choose any</small>}
        {question.options.map(option => <button type="button" key={option.label} className={`mobile-prompt-option ${question.multiSelect ? 'multi' : ''}`} aria-pressed={draft.options.includes(option.label)} onClick={() => pick(option.label)}><i aria-hidden="true" /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></button>)}
        <button type="button" className={`mobile-prompt-option ${question.multiSelect ? 'multi' : ''}`} aria-pressed={draft.otherOn} onClick={() => change(index, question.multiSelect ? { otherOn: !draft.otherOn } : { otherOn: true, options: [] })}><i aria-hidden="true" /><span><strong>Something else</strong><small>Type your own answer</small></span></button>
        {draft.otherOn && <input aria-label={`Your answer to ${question.header || question.question}`} value={draft.other} maxLength={2000} onChange={event => change(index, { other: event.target.value })} placeholder="Your answer" autoFocus />}
      </fieldset>
    })}
    <button className="mobile-primary" disabled={busy || !ready}>{busy ? 'Answering in the terminal…' : prompt.questions.length > 1 ? 'Send answers' : 'Send answer'}<Icon name="send" size={16} /></button>
  </form>
}

function PlanApproval({ prompt, busy, send }: { prompt: Extract<ChatPrompt, { kind: 'plan' }>; busy: boolean; send: (body: object) => void }) {
  const [whole, setWhole] = useState(false), [text, setText] = useState('')
  const feedback = prompt.choices.find(choice => choice.feedback), approvals = prompt.choices.filter(choice => !choice.feedback)
  return <>
    {prompt.plan && <div className={`mobile-prompt-plan ${whole ? 'whole' : ''}`}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{prompt.plan}</ReactMarkdown></div>}
    {prompt.plan && <button type="button" className="mobile-prompt-more" onClick={() => setWhole(!whole)}>{whole ? 'Show less' : 'Show the whole plan'}</button>}
    <div className="mobile-prompt-choices">{approvals.map((choice, index) => <button type="button" key={choice.number} className={index === 0 ? 'mobile-primary' : ''} disabled={busy} onClick={() => send({ choice: { number: choice.number, label: choice.label } })}>{choice.label}{index === 0 && <Icon name="send" size={16} />}</button>)}</div>
    {feedback && <form className="mobile-prompt-feedback" onSubmit={event => { event.preventDefault(); if (text.trim()) send({ choice: { number: feedback.number, label: feedback.label, text: text.trim() } }) }}>
      <textarea aria-label={feedback.label} value={text} maxLength={2000} rows={3} disabled={busy} onChange={event => setText(event.target.value)} placeholder={`${feedback.label}…`} />
      <button disabled={busy || !text.trim()}>Send changes<Icon name="send" size={15} /></button>
    </form>}
    {busy && <p className="mobile-prompt-note" role="status">Answering in the terminal…</p>}
  </>
}
