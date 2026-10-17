import { Fragment, useEffect, useRef, useState } from 'react'
import type { AgentInfo, ChatSession } from './types'
import { api, reportError } from './client'
import { chatActivityLabel } from './chatActivity'
import { Icon } from './Icons'
import SessionLogo from './SessionLogo'
import { projectKey, projectName } from './chatOrder'

type Drag = { id: string; pinned: boolean; startX: number; startY: number; moving: boolean }
type Drop = { id: string; position: 'before' | 'after' }

// Projects whose tabs are collapsed in the grouped tab bar, by projectKey.
const collapsedKey = 'mrmak.collapsedProjects'
function savedCollapsed(): string[] {
  try { const value = JSON.parse(localStorage.getItem(collapsedKey) || '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [] } catch { return [] }
}

export default function ChatTabs({ items, grouped = false, selectedId, agents, choose, close }: {
  items: ChatSession[]; grouped?: boolean; selectedId?: string; agents: AgentInfo[]; choose: (id: string) => void; close: (id: string) => void
}) {
  const gesture = useRef<Drag | null>(null)
  const drop = useRef<Drop | null>(null)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null)
  const [target, setTarget] = useState<Drop | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const cancelEdit = useRef(false)
  const [collapsed, setCollapsed] = useState<string[]>(savedCollapsed)
  function toggleProject(key: string) {
    const next = collapsed.includes(key) ? collapsed.filter(item => item !== key) : [...collapsed, key]
    setCollapsed(next)
    try { localStorage.setItem(collapsedKey, JSON.stringify(next)) } catch { /* The choice lasts for this window. */ }
  }
  function saveName() {
    if (!editing) return
    const item = items.find(entry => entry.id === editing.id), name = editing.name.trim()
    setEditing(null)
    if (item && name && name !== item.name) api(`/sessions/${item.id}`, { name }, 'PATCH').catch(reportError)
  }
  const clear = () => { gesture.current = null; drop.current = null; setDragging(null); setTarget(null) }
  const clearRef = useRef(clear)
  useEffect(() => { clearRef.current = clear })
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') clearRef.current() }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [])
  function begin(event: React.PointerEvent<HTMLButtonElement>, item: ChatSession) {
    if (event.button !== 0) return
    suppressClick.current = false
    gesture.current = { id: item.id, pinned: item.pinned, startX: event.clientX, startY: event.clientY, moving: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: React.PointerEvent<HTMLButtonElement>) {
    const current = gesture.current
    if (!current) return
    if (!current.moving && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return
    current.moving = true; suppressClick.current = true
    setDragging({ id: current.id, x: event.clientX, y: event.clientY })
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-chat-tab]')
    const item = items.find(item => item.id === element?.dataset.chatTab)
    let next: Drop | null = null
    const source = items.find(entry => entry.id === current.id)
    // Grouped tabs reorder within their project; the groups follow their first tab.
    if (element && item && item.id !== current.id && item.pinned === current.pinned && (!grouped || (source && projectKey(source.cwd) === projectKey(item.cwd)))) {
      const rect = element.getBoundingClientRect()
      next = { id: item.id, position: event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before' }
    }
    drop.current = next; setTarget(next)
  }
  function finish() {
    const current = gesture.current, destination = drop.current
    clear()
    if (current?.moving && destination) api(`/sessions/${current.id}/reorder`, { targetId: destination.id, position: destination.position }).catch(reportError)
  }
  const dragged = items.find(item => item.id === dragging?.id)
  const renderTab = (item: ChatSession) => <div data-chat-tab={item.id} className={`chat-tab ${selectedId === item.id ? 'selected' : ''} ${item.tabColor ? 'has-color' : ''} ${dragging?.id === item.id ? 'dragging' : ''} ${target?.id === item.id ? `drop-${target.position}` : ''}`} style={{ '--tab-accent': item.tabColor || '#dfa3b8' } as React.CSSProperties}>
      {editing?.id === item.id ? <span className="chat-tab-select chat-tab-editing"><span style={{ color: agents.find(a => a.id === item.agent)?.color }}><SessionLogo session={item} /></span><input autoFocus value={editing.name} aria-label="English chat name" onFocus={event => event.currentTarget.select()} onChange={event => setEditing({ id: item.id, name: event.target.value })} onBlur={() => { if (cancelEdit.current) { cancelEdit.current = false; setEditing(null) } else saveName() }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { event.stopPropagation(); cancelEdit.current = true; event.currentTarget.blur() } }} /></span>
      : <button role="tab" aria-selected={selectedId === item.id} onClick={event => { if (!suppressClick.current || event.detail === 0) choose(item.id) }} onDoubleClick={() => setEditing({ id: item.id, name: item.name })} onKeyDown={event => { if (event.key === 'F2') setEditing({ id: item.id, name: item.name }) }} onPointerDown={event => begin(event, item)} onPointerMove={move} onPointerUp={finish} onPointerCancel={clear} onLostPointerCapture={clear}
        className="chat-tab-select" aria-label={`${item.name} · ${chatActivityLabel(item)}`} title={`${agents.find(a => a.id === item.agent)?.label} · ${item.name}\n${chatActivityLabel(item)}\nDrag to reorder ${item.pinned ? 'pinned' : 'unpinned'} tabs · double-click or F2 to rename\n${item.cwd}`}>
        <span style={{ color: agents.find(a => a.id === item.agent)?.color }}><SessionLogo session={item} /></span><span className="chat-tab-name">{item.name}</span>{item.pinned && <span className="tab-pinned" title="Pinned in History"><Icon name="pin" size={11} /></span>}
      </button>}
      <button className="chat-tab-close" onClick={() => close(item.id)} aria-label={`Close ${item.name}`} title="Close tab · keep in History"><Icon name="close" size={12} /></button>
    </div>
  // Consecutive tabs of one project form a group, as orderedChats arranges them.
  const groups: ChatSession[][] = []
  if (grouped) for (const item of items) { const last = groups[groups.length - 1]; if (last && projectKey(last[0].cwd) === projectKey(item.cwd)) last.push(item); else groups.push([item]) }
  return <div className={`chat-tabs ${dragging ? 'is-reordering' : ''}`} role="tablist" aria-label="Agent chats">
    {grouped ? groups.map(group => {
      const key = projectKey(group[0].cwd), folded = collapsed.includes(key)
      // A collapsed project keeps only the open chat visible, so the selection never disappears.
      const [first, ...rest] = folded ? group.filter(item => item.id === selectedId) : group
      // The project label shares a row with its first tab, so a wrapped bar never strands it.
      return <Fragment key={group[0].id}><div className="chat-tab-lead"><button type="button" className={`chat-tab-group ${folded ? 'collapsed' : ''}`} aria-expanded={!folded} onClick={() => toggleProject(key)} title={`${group[0].cwd}\n${folded ? 'Show' : 'Collapse'} this project's tabs`}><Icon name="folder" size={11} />{projectName(group[0].cwd)}<small>{group.length}</small></button>{first && renderTab(first)}</div>{rest.map(item => <Fragment key={item.id}>{renderTab(item)}</Fragment>)}</Fragment>
    }) : items.map(item => <Fragment key={item.id}>{renderTab(item)}</Fragment>)}
    {dragging && dragged && <div className="chat-tab-ghost" style={{ left: dragging.x + 13, top: dragging.y + 13, color: dragged.tabColor || '#d8c9da' }} aria-hidden="true"><SessionLogo session={dragged} /><span>{dragged.name}</span>{dragged.pinned && <Icon name="pin" size={12} />}</div>}
  </div>
}
