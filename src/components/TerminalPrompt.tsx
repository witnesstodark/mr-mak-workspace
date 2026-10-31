import { useState } from 'react'
import { Icon } from '../desktop/Icons'
import './terminal-prompt.css'

// A numbered menu or slider the agent drew in its terminal. A multiple choice
// also lists its checked boxes, the box that needs typing and its button; a
// single choice may offer an option for your own answer.
export interface TerminalPromptData { id: string; kind?: 'single' | 'multiple' | 'scale'; question: string; detail: string[]; options: string[]; selected: number; checked?: boolean[]; input?: number; submit?: string }
export type PromptChoice = number | 'cancel' | { checked: number[] } | { text: string }

// Boxes change only in the page; the button sends the final choice to the terminal.
export default function TerminalPrompt({ prompt, answering, onAnswer, onOpenTerminal }: { prompt: TerminalPromptData; answering: boolean; onAnswer: (choice: PromptChoice) => void; onOpenTerminal: () => void }) {
  const [picks, setPicks] = useState<{ id: string; values: number[] } | null>(null)
  const [own, setOwn] = useState<{ id: string; text: string } | null>(null)
  const chosen = prompt.kind === 'multiple' ? picks?.id === prompt.id ? picks.values : (prompt.checked || []).flatMap((on, index) => on ? [index] : []) : []
  const toggle = (index: number) => setPicks({ id: prompt.id, values: chosen.includes(index) ? chosen.filter(item => item !== index) : [...chosen, index].sort((a, b) => a - b) })
  const writing = own?.id === prompt.id ? own : null
  const sendOwn = () => { if (writing?.text.trim()) onAnswer({ text: writing.text.trim() }) }
  return <section className="conversation-prompt" aria-label="The agent is asking for a choice">
    <header><Icon name="bell" size={14} /><strong>{prompt.question}</strong></header>
    {!!prompt.detail.length && <pre>{prompt.detail.join('\n')}</pre>}
    {prompt.kind === 'multiple'
      ? <div className="conversation-prompt-options" role="group" aria-label="Choose any">{prompt.options.map((option, index) => index === prompt.input
        ? <button type="button" key={index} disabled title="Type your own answer in the terminal"><span>{index + 1}</span>{option} · in the terminal</button>
        : <button type="button" key={index} role="checkbox" aria-checked={chosen.includes(index)} disabled={answering} className={chosen.includes(index) ? 'checked' : ''} onClick={() => toggle(index)}><span>{chosen.includes(index) ? '✓' : index + 1}</span>{option}</button>)}</div>
      : <div className="conversation-prompt-options">{prompt.options.map((option, index) => index === prompt.input && writing
        ? <form key={index} className="conversation-prompt-own" onSubmit={event => { event.preventDefault(); sendOwn() }}>
          <span>{index + 1}</span>
          <input autoFocus value={writing.text} maxLength={2000} disabled={answering} placeholder="Your answer" aria-label="Your answer" onChange={event => setOwn({ id: prompt.id, text: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOwn(null) } }} />
          <button type="submit" disabled={answering || !writing.text.trim()}>Send answer</button>
        </form>
        : <button type="button" key={index} disabled={answering} className={index === prompt.selected ? 'selected' : ''} onClick={() => index === prompt.input ? setOwn({ id: prompt.id, text: '' }) : onAnswer(index)}><span>{index + 1}</span>{option}</button>)}</div>}
    <footer>{prompt.kind === 'multiple' && <button type="button" className="conversation-prompt-submit" disabled={answering} onClick={() => onAnswer({ checked: chosen })}>{prompt.submit}{chosen.length ? ` · ${chosen.length}` : ''}</button>}<button type="button" disabled={answering} onClick={() => onAnswer('cancel')}>Esc · cancel</button><button type="button" onClick={onOpenTerminal}><Icon name="terminal" size={13} />Open terminal</button></footer>
  </section>
}
