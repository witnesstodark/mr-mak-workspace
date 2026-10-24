import { useEffect, useRef, useState } from 'react'
import type { AgentInfo, ChatSession } from './types'
import { api, reportError } from './client'
import { chatActivityLabel } from './chatActivity'
import { Icon } from './Icons'
import SessionLogo from './SessionLogo'
import { groupedChats, tabColors, type TabGroup } from './chatOrder'

/** A drag carries one tab, or a whole group when it starts on the group's chip. */
type Drag = { id: string; group?: string; pinned: boolean; startX: number; startY: number; moving: boolean }
type Drop = { id: string; position: 'before' | 'after' } | { group: string } | { beside: string; pinned: boolean; targetId: string; position: 'before' | 'after' }
type Menu = { kind: 'tab'; item: ChatSession; x: number; y: number } | { kind: 'group'; group: TabGroup; x: number; y: number }

function Swatches({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  return <div className="swatches" role="group" aria-label={label}>
    <button type="button" className={`tab-color-swatch no-color ${!value ? 'selected' : ''}`} aria-label={`No ${label.toLowerCase()}`} aria-pressed={!value} title={label === 'Group color' ? 'Automatic' : 'No color'} onClick={() => onChange(null)} />
    {tabColors.map(color => <button key={color.value} type="button" className={`tab-color-swatch ${value === color.value ? 'selected' : ''}`} style={{ '--swatch': color.value } as React.CSSProperties} aria-label={`${color.name} ${label.toLowerCase()}`} aria-pressed={value === color.value} title={color.name} onClick={() => onChange(color.value)} />)}
  </div>
}

export default function ChatTabs({ items, selectedId, agents, groups, collapsed, groupColors, historyCounts, choose, close, toggleGroup, collapseOthers, setGroupColor }: {
  items: ChatSession[]; selectedId?: string; agents: AgentInfo[]; groups: string[]; collapsed: string[]; groupColors: Record<string, string>; historyCounts: Record<string, number>
  choose: (id: string) => void; close: (id: string) => void; toggleGroup: (name: string) => void; collapseOthers: (name: string) => void; setGroupColor: (name: string, value: string | null) => void
}) {
  const gesture = useRef<Drag | null>(null)
  const drop = useRef<Drop | null>(null)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState<{ id: string; group?: string; pinned: boolean; x: number; y: number } | null>(null)
  const [target, setTarget] = useState<Drop | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [draft, setDraft] = useState('')
  const [rename, setRename] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const cancelEdit = useRef(false)
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
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: Event) => { if (event.type === 'resize' || !(event.target as HTMLElement | null)?.closest?.('.tab-menu')) setMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    window.addEventListener('resize', dismiss)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape); window.removeEventListener('resize', dismiss) }
  }, [menu])
  const grouped = groupedChats(items, groupColors)
  const openMenu = (event: React.MouseEvent, value: Menu) => { event.preventDefault(); event.stopPropagation(); setDraft(''); setRename(null); setConfirm(false); setMenu(value) }
  const patch = (id: string, data: object) => { setMenu(null); api(`/sessions/${id}`, data, 'PATCH').catch(reportError) }
  const ungroup = (group: TabGroup) => { setMenu(null); Promise.all(group.items.map(item => api(`/sessions/${item.id}`, { group: null }, 'PATCH'))).catch(reportError) }
  const renameGroup = (from: string, to: string) => { setMenu(null); setRename(null); if (to !== from) api('/groups/rename', { from, to }).catch(reportError) }
  const deleteGroup = (name: string) => { setMenu(null); setConfirm(false); api('/groups/delete', { name }).catch(reportError) }
  function begin(event: React.PointerEvent<HTMLButtonElement>, item: ChatSession, group?: string) {
    if (event.button !== 0) return
    suppressClick.current = false
    gesture.current = { id: item.id, group, pinned: item.pinned, startX: event.clientX, startY: event.clientY, moving: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: React.PointerEvent<HTMLButtonElement>) {
    const current = gesture.current
    if (!current) return
    if (!current.moving && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return
    current.moving = true; suppressClick.current = true
    setDragging({ id: current.id, group: current.group, pinned: current.pinned, x: event.clientX, y: event.clientY })
    const point = document.elementFromPoint(event.clientX, event.clientY)
    const element = point?.closest<HTMLElement>('[data-chat-tab]')
    const item = items.find(item => item.id === element?.dataset.chatTab)
    const side = (box: HTMLElement) => { const rect = box.getBoundingClientRect(); return event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before' }
    let next: Drop | null = null
    if (current.group) {
      // A group lands beside an ungrouped tab or beside another whole group.
      const box = point?.closest<HTMLElement>('[data-chat-group]')
      const other = box ? grouped.find(group => group.name === box.dataset.chatGroup && group.pinned === current.pinned && group.name !== current.group) : undefined
      if (box && other) next = { beside: other.name!, pinned: other.pinned, targetId: other.items[0].id, position: side(box) }
      else if (!box && element && item && !item.group && item.pinned === current.pinned) next = { id: item.id, position: side(element) }
    } else if (element && item && item.id !== current.id && item.pinned === current.pinned) {
      const rect = element.getBoundingClientRect()
      next = { id: item.id, position: event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before' }
    } else {
      // A group header, or a collapsed group, accepts the tab as its newest member.
      const name = point?.closest<HTMLElement>('[data-chat-group]')?.dataset.chatGroup
      const group = name ? grouped.find(group => group.name === name && group.pinned === current.pinned) : undefined
      if (group && !group.items.some(item => item.id === current.id)) next = { group: group.name! }
    }
    drop.current = next; setTarget(next)
  }
  function finish() {
    const current = gesture.current, destination = drop.current
    clear()
    if (!current?.moving || !destination) return
    if (current.group) {
      const targetId = 'beside' in destination ? destination.targetId : 'id' in destination ? destination.id : null
      if (targetId && 'position' in destination) api('/groups/move', { group: current.group, pinned: current.pinned, targetId, position: destination.position }).catch(reportError)
    }
    else if ('group' in destination) api(`/sessions/${current.id}`, { group: destination.group }, 'PATCH').catch(reportError)
    else if ('id' in destination) api(`/sessions/${current.id}/reorder`, { targetId: destination.id, position: destination.position }).catch(reportError)
  }
  const dragged = dragging?.group ? undefined : items.find(item => item.id === dragging?.id)
  const draggedGroup = dragging?.group ? grouped.find(group => group.name === dragging.group && group.pinned === dragging.pinned) : undefined
  const renderTab = (item: ChatSession) => <div key={item.id} data-chat-tab={item.id} className={`chat-tab ${selectedId === item.id ? 'selected' : ''} ${item.tabColor ? 'has-color' : ''} ${!dragging?.group && dragging?.id === item.id ? 'dragging' : ''} ${target && 'id' in target && target.id === item.id ? `drop-${target.position}` : ''}`} style={{ '--tab-accent': item.tabColor || 'var(--pink)' } as React.CSSProperties} onContextMenu={event => openMenu(event, { kind: 'tab', item, x: event.clientX, y: event.clientY })}>
    {editing?.id === item.id ? <span className="chat-tab-select chat-tab-editing"><span style={{ color: agents.find(a => a.id === item.agent)?.color }}><SessionLogo session={item} /></span><input autoFocus value={editing.name} maxLength={100} aria-label="English chat name" onFocus={event => event.currentTarget.select()} onChange={event => setEditing({ id: item.id, name: event.target.value })} onBlur={() => { if (cancelEdit.current) { cancelEdit.current = false; setEditing(null) } else saveName() }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { event.stopPropagation(); cancelEdit.current = true; event.currentTarget.blur() } }} /></span>
    : <button role="tab" aria-selected={selectedId === item.id} onClick={event => { if (!suppressClick.current || event.detail === 0) choose(item.id) }} onDoubleClick={() => setEditing({ id: item.id, name: item.name })} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); setEditing({ id: item.id, name: item.name }) } }} onPointerDown={event => begin(event, item)} onPointerMove={move} onPointerUp={finish} onPointerCancel={clear} onLostPointerCapture={clear}
      className="chat-tab-select" aria-label={`${item.name} · ${chatActivityLabel(item)}`} title={`${agents.find(a => a.id === item.agent)?.label} · ${item.name}${item.group ? ` · ${item.group}` : ''}\n${chatActivityLabel(item)}\nDrag to reorder ${item.pinned ? 'pinned' : 'unpinned'} tabs · right-click for options\n${item.cwd}`}>
      <span style={{ color: agents.find(a => a.id === item.agent)?.color }}><SessionLogo session={item} /></span><span className="chat-tab-name">{item.name}</span>{item.pinned && <span className="tab-pinned" title="Pinned in History"><Icon name="pin" size={11} /></span>}
    </button>}
    <button className="chat-tab-close" onClick={() => close(item.id)} aria-label={`Close ${item.name}`} title="Close tab · keep in History"><Icon name="close" size={12} /></button>
  </div>
  // Reorders arrive one tab at a time, so a group can be split for a moment; a
  // second run of the same group needs its own key or React leaves a stale copy.
  const runs = new Map<string, number>()
  return <div className={`chat-tabs ${dragging ? 'is-reordering' : ''}`} role="tablist" aria-label="Agent chats">
    {grouped.map(group => {
      if (!group.name) return group.items.map(renderTab)
      const key = `group:${group.pinned}:${group.name}`, run = (runs.get(key) || 0) + 1
      runs.set(key, run)
      const folded = collapsed.includes(group.name)
      const moving = draggedGroup?.name === group.name && draggedGroup.pinned === group.pinned
      const beside = target && 'beside' in target && target.beside === group.name && target.pinned === group.pinned ? `drop-${target.position}` : ''
      return <div key={run > 1 ? `${key}:${run}` : key} data-chat-group={group.name} className={`chat-tab-group ${folded ? 'collapsed' : ''} ${group.working ? 'working' : ''} ${moving ? 'dragging' : ''} ${beside} ${target && 'group' in target && target.group === group.name ? 'drop-into' : ''}`} style={{ '--tab-accent': group.color } as React.CSSProperties}>
        <button type="button" className="chat-group-chip" aria-expanded={!folded} aria-label={`${group.name} group · ${group.items.length} tabs${group.unread ? ' · unread result' : ''}`} title={`${group.name} · ${group.items.length} tabs\nClick to ${folded ? 'expand' : 'collapse'} · drag to move the group · right-click to rename, color and more · drop a tab here to add it`}
          onClick={event => { if (!suppressClick.current || event.detail === 0) toggleGroup(group.name!) }} onPointerDown={event => begin(event, group.items[0], group.name!)} onPointerMove={move} onPointerUp={finish} onPointerCancel={clear} onLostPointerCapture={clear} onContextMenu={event => openMenu(event, { kind: 'group', group, x: event.clientX, y: event.clientY })}>
          <span className="chip-caret" aria-hidden="true">{folded ? '▸' : '▾'}</span><span className="chip-name">{group.name}</span><small>{group.items.length}</small>{group.unread && <i className="chip-unread" title="Unread result" />}{group.working && <i className="chip-working" title="Working" />}
        </button>
        {group.items.filter(item => !folded || item.id === selectedId).map(renderTab)}
      </div>
    })}
    {dragging && dragged && <div className="chat-tab-ghost" style={{ left: dragging.x + 13, top: dragging.y + 13, color: dragged.tabColor || '#d8c9da' }} aria-hidden="true"><SessionLogo session={dragged} /><span>{dragged.name}</span>{dragged.pinned && <Icon name="pin" size={12} />}</div>}
    {dragging && draggedGroup && <div className="chat-tab-ghost group-ghost" style={{ left: dragging.x + 13, top: dragging.y + 13, color: draggedGroup.color }} aria-hidden="true"><span className="chip-caret">▾</span><span>{draggedGroup.name}</span><small>{draggedGroup.items.length}</small></div>}
    {menu && <div className="tab-menu" role="menu" style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 260)), top: Math.max(4, Math.min(menu.y, window.innerHeight - (menu.kind === 'tab' ? 470 : 290))) }}>
      {menu.kind === 'tab' ? <>
        <strong>{menu.item.name}</strong>
        {rename === null ? <button type="button" role="menuitem" onClick={() => setRename(menu.item.name)}>Rename chat</button> : <form className="tab-menu-rename" onSubmit={event => { event.preventDefault(); if (rename.trim()) patch(menu.item.id, { name: rename.trim() }) }}><input autoFocus value={rename} maxLength={100} aria-label="English chat name" onChange={event => setRename(event.target.value)} /><button type="submit">Save</button></form>}
        <button type="button" role="menuitem" onClick={() => patch(menu.item.id, { pinned: !menu.item.pinned })}>{menu.item.pinned ? 'Unpin from History' : 'Pin in History'}</button>
        <span>Tab color</span>
        <Swatches label="Tab color" value={menu.item.tabColor} onChange={value => patch(menu.item.id, { tabColor: value })} />
        <span>{menu.item.group ? 'Move to group' : 'Add to group'}</span>
        {groups.filter(name => name !== menu.item.group).map(name => <button key={name} type="button" role="menuitem" onClick={() => patch(menu.item.id, { group: name })}>{name}</button>)}
        <form onSubmit={event => { event.preventDefault(); if (draft.trim()) patch(menu.item.id, { group: draft.trim() }) }}><input placeholder="New group…" aria-label="New group name" value={draft} maxLength={60} onChange={event => setDraft(event.target.value)} /><button type="submit" disabled={!draft.trim()}>Add</button></form>
        {menu.item.group && <button type="button" role="menuitem" onClick={() => patch(menu.item.id, { group: null })}>Remove from {menu.item.group}</button>}
        <hr />
        <button type="button" role="menuitem" onClick={() => { setMenu(null); api('/reveal', { path: menu.item.cwd }).catch(reportError) }}>Show working folder</button>
        <button type="button" role="menuitem" title="Clear visible scrollback; keep the agent conversation" onClick={() => { setMenu(null); api(`/sessions/${menu.item.id}/clear`, {}).catch(reportError) }}>Clear terminal scrollback</button>
        <hr />
        <button type="button" role="menuitem" onClick={() => { setMenu(null); close(menu.item.id) }}>Close tab · keep in History</button>
      </> : <>
        <strong>{menu.group.name}</strong>
        {rename === null ? <button type="button" role="menuitem" onClick={() => setRename(menu.group.name)}>Rename group</button> : (() => {
          // Another group's name merges the two, so the button says so.
          const to = rename.trim().replace(/\s+/g, ' ')
          const merge = to !== menu.group.name && groups.includes(to)
          return <form className="tab-menu-rename" onSubmit={event => { event.preventDefault(); if (to) renameGroup(menu.group.name!, to) }}><input autoFocus value={rename} maxLength={60} aria-label="English group name" onChange={event => setRename(event.target.value)} /><button type="submit" disabled={!to} title={merge ? `Move these tabs into the existing ${to} group` : undefined}>{merge ? 'Merge' : 'Save'}</button></form>
        })()}
        <button type="button" role="menuitem" onClick={() => { setMenu(null); toggleGroup(menu.group.name!) }}>{collapsed.includes(menu.group.name!) ? 'Expand group' : 'Collapse group'}</button>
        <button type="button" role="menuitem" onClick={() => { setMenu(null); collapseOthers(menu.group.name!) }}>Collapse other groups</button>
        <span>Group color</span>
        <Swatches label="Group color" value={groupColors[menu.group.name!] || null} onChange={value => { setMenu(null); setGroupColor(menu.group.name!, value) }} />
        <hr />
        <button type="button" role="menuitem" onClick={() => ungroup(menu.group)}>Ungroup {menu.group.items.length} {menu.group.items.length === 1 ? 'tab' : 'tabs'}</button>
        {confirm ? (() => {
          // Ungroup only reaches the open tabs; deleting also clears the group from History chats and forgets its color.
          const history = historyCounts[menu.group.name!] || 0
          return <div className="tab-menu-confirm"><p>Remove the {menu.group.name} group from {menu.group.items.length} open {menu.group.items.length === 1 ? 'tab' : 'tabs'}{history ? ` and ${history} ${history === 1 ? 'chat' : 'chats'} in History` : ''}. The chats stay where they are.</p><button type="button" className="danger" onClick={() => deleteGroup(menu.group.name!)}>Delete group</button><button type="button" onClick={() => setConfirm(false)}>Cancel</button></div>
        })() : <button type="button" role="menuitem" className="danger" onClick={() => setConfirm(true)}>Delete group…</button>}
      </>}
    </div>}
  </div>
}
