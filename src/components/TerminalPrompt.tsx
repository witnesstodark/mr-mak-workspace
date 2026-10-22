import { useState } from 'react'
import { Icon } from '../desktop/Icons'
import './terminal-prompt.css'

// A numbered menu the agent drew in its terminal. A multiple choice also lists
// its checked boxes, the box that needs typing and its button.
export interface TerminalPromptData { id: string; kind?: 'single' | 'multiple'; question: string; detail: string[]; options: string[]; selected: number; checked?: boolean[]; input?: number; submit?: string }
export type PromptChoice = number | 'cancel' | { checked: number[] }

// Boxes change only in the page; the button sends the final choice to the terminal.
export default function TerminalPrompt({ prompt, answering, onAnswer, onOpenTerminal }: { prompt: TerminalPromptData; answering: boolean; onAnswer: (choice: PromptChoice) => void; onOpenTerminal: () => void }) {
  const [picks, setPicks] = useState<{ id: string; values: number[] } | null>(null)
  const chosen = prompt.kind === 'multiple' ? picks?.id === prompt.id ? picks.values : (prompt.checked || []).flatMap((on, index) => on ? [index] : []) : []
  const toggle = (index: number) => setPicks({ id: prompt.id, values: chosen.includes(index) ? chosen.filter(item => item !== index) : [...chosen, index].sort((a, b) => a - b) })
  return <section className="conversation-prompt" aria-label="The agent is asking for a choice">
    <header><Icon name="bell" size={14} /><strong>{prompt.question}</strong></header>
    {!!prompt.detail.length && <pre>{prompt.detail.join('\n')}</pre>}
    {prompt.kind === 'multiple'
      ? <div className="conversation-prompt-options" role="group" aria-label="Choose any">{prompt.options.map((option, index) => index === prompt.input
        ? <button type="button" key={index} disabled title="Type your own answer in the terminal"><span>{index + 1}</span>{option} · in the terminal</button>
        : <button type="button" key={index} role="checkbox" aria-checked={chosen.includes(index)} disabled={answering} className={chosen.includes(index) ? 'checked' : ''} onClick={() => toggle(index)}><span>{chosen.includes(index) ? '✓' : index + 1}</span>{option}</button>)}</div>
      : <div className="conversation-prompt-options">{prompt.options.map((option, index) => <button type="button" key={index} disabled={answering} className={index === prompt.selected ? 'selected' : ''} onClick={() => onAnswer(index)}><span>{index + 1}</span>{option}</button>)}</div>}
    <footer>{prompt.kind === 'multiple' && <button type="button" className="conversation-prompt-submit" disabled={answering} onClick={() => onAnswer({ checked: chosen })}>{prompt.submit}{chosen.length ? ` · ${chosen.length}` : ''}</button>}<button type="button" disabled={answering} onClick={() => onAnswer('cancel')}>Esc · cancel</button><button type="button" onClick={onOpenTerminal}><Icon name="terminal" size={13} />Open terminal</button></footer>
  </section>
}
