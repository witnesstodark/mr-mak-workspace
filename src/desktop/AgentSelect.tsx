import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentId, AgentInfo } from './types'
import { AgentLogo } from './Icons'
import { t } from '../lib/i18n'

const agentNote = (item: AgentInfo) => !item.available ? t('Not installed') : item.id === 'shell' ? t('Local terminal') : item.id === 'opencode' ? t('Your providers') : t('Your CLI account')

// One row for the usual agent instead of a grid of six. The list is portaled so the
// dialog's scroll area cannot clip it, and opens upward when there is no room below.
export default function AgentSelect({ agents, value, onChange }: { agents: AgentInfo[]; value: AgentId; onChange: (agent: AgentId) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<React.CSSProperties>({})
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const current = agents.find(item => item.id === value) || agents[0]
  const choices = agents.map((item, index) => ({ item, index })).filter(({ item }) => item.available)
  const show = () => { setActive(Math.max(0, choices.findIndex(({ item }) => item.id === value))); setOpen(true) }
  const pick = (agent: AgentId) => { onChange(agent); setOpen(false); trigger.current?.focus() }
  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const box = trigger.current.getBoundingClientRect(), height = list.current?.offsetHeight || 0
    const below = window.innerHeight - box.bottom - 8 >= height || box.top < height + 8
    setPlace({ left: box.left, width: box.width, top: below ? box.bottom + 4 : box.top - height - 4 })
    list.current?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const away = (event: Event) => { if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false) }
    const moved = () => setOpen(false)
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('resize', moved)
    document.addEventListener('scroll', moved, true)
    return () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('resize', moved); document.removeEventListener('scroll', moved, true) }
  }, [open])
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    else if (event.key === 'Tab') setOpen(false)
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length) }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setActive(event.key === 'Home' ? 0 : choices.length - 1) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (choices[active]) pick(choices[active].item.id) }
  }
  return <>
    <button type="button" ref={trigger} className={`agent-select ${open ? 'open' : ''}`} aria-label={`Agent: ${current?.label}`} aria-haspopup="listbox" aria-expanded={open}
      style={{ '--agent-color': current?.color } as React.CSSProperties}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show() } }}>
      {current && <><span className="agent-mark"><AgentLogo agent={current.id} size={21} /></span><span className="agent-select-label">{current.label}<small>{agentNote(current)}</small></span></>}
      <svg className="agent-select-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && createPortal(<div ref={list} className="agent-select-list" role="listbox" aria-label={t('Agent')} tabIndex={-1} style={place} onKeyDown={keys}
      aria-activedescendant={choices[active] ? `agent-option-${choices[active].item.id}` : undefined}>
      {agents.map(item => {
        const index = choices.findIndex(choice => choice.item.id === item.id)
        return <div key={item.id} id={`agent-option-${item.id}`} role="option" aria-selected={item.id === value} aria-disabled={!item.available}
          className={`agent-option ${index === active ? 'active' : ''} ${item.available ? '' : 'disabled'}`} style={{ '--agent-color': item.color } as React.CSSProperties}
          onPointerEnter={() => { if (index >= 0) setActive(index) }} onClick={() => { if (item.available) pick(item.id) }}>
          <span className="agent-mark"><AgentLogo agent={item.id} size={19} /></span>
          <span className="agent-select-label">{item.label}<small>{agentNote(item)}</small></span>
          {item.id === value && <span className="choice-check" aria-hidden="true">✓</span>}
        </div>
      })}
    </div>, document.body)}
  </>
}
