import { useCallback, useEffect, useState } from 'react'
import { api, reportError, selectChat, sendEvent, useDesktop, windowAction } from './client'
import type { AgentId, ChatSession } from './types'
import { AgentLogo, Icon, Nose } from './Icons'
import TerminalPane from './TerminalPane'
import SessionLogo from './SessionLogo'
import { chatActivityLabel } from './chatActivity'
import ChatTabs from './ChatTabs'
import { orderedChats, tabColors } from './chatOrder'
import MobileAccess from './MobileAccess'
import DictationComposer from './DictationComposer'

function NewChat({ close }: { close: () => void }) {
  const state = useDesktop()
  const [agent, setAgent] = useState<AgentId>(state.settings.defaultAgent)
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(state.repo)
  const [bypass, setBypass] = useState(state.settings.defaultBypass)
  const [resumeId, setResumeId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function launch(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const session = await api<ChatSession>('/sessions', { agent, name: name.trim() || undefined, cwd, bypass, resumeId: resumeId.trim() || undefined })
      await api('/settings', { defaultAgent: agent, defaultBypass: bypass })
      selectChat(session.id); close()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false) }
  }
  return <div className="desk-scrim" onClick={close}><form className="desk-dialog" onClick={event => event.stopPropagation()} onSubmit={launch}>
    <div className="desk-dialog-heading"><div><span className="desk-eyebrow">A PLACE FOR THE NEXT THING</span><h2>New chat</h2></div><button type="button" className="desk-icon" onClick={close} aria-label="Close"><Icon name="close" /></button></div>
    <div className="agent-picker">{state.agents.map(item => <button type="button" key={item.id} className={`agent-choice ${agent === item.id ? 'selected' : ''}`} onClick={() => setAgent(item.id)} disabled={!item.available} style={{ '--agent-color': item.color } as React.CSSProperties}><span className="agent-mark"><AgentLogo agent={item.id} size={23} /></span><span>{item.label}<small>{item.available ? item.id === 'shell' ? 'Local terminal' : item.id === 'opencode' ? 'Your providers' : 'Your CLI account' : 'Not installed'}</small></span>{agent === item.id && <span className="choice-check">✓</span>}</button>)}</div>
    <label className="desk-field">Chat name <small>English only</small><input autoFocus placeholder="e.g. Dream Game · animations" value={name} onChange={event => setName(event.target.value)} maxLength={100} /></label>
    <label className="desk-field">Working folder<input value={cwd} onChange={event => setCwd(event.target.value)} required spellCheck={false} /></label>
    {agent !== 'shell' && <><label className="desk-check"><input type="checkbox" checked={bypass} onChange={event => setBypass(event.target.checked)} /><span>{agent === 'opencode' ? 'Auto-approve permission prompts' : 'Bypass agent permission prompts'}<small>{agent === 'opencode' ? 'Explicit deny rules in OpenCode still apply.' : 'Same Windows account and file access as your usual terminal.'}</small></span></label><details className="desk-details"><summary>Resume an existing CLI conversation</summary><p>For a conversation started outside Mr. Mak, copy its ID from your CLI's session details or resume picker. Chats created here return automatically.</p><label className="desk-field">Native session ID<input value={resumeId} onChange={event => setResumeId(event.target.value)} placeholder="Optional session ID" /></label></details></>}
    {error && <p className="desk-error-inline" role="alert">{error}</p>}
    <button className="desk-primary" disabled={busy || !state.connected}>{busy ? 'Opening…' : 'Open chat'}<Icon name="arrow" size={16} /></button>
  </form></div>
}

function History({ close, choose }: { close: () => void; choose: (id: string) => void }) {
  const state = useDesktop()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [opening, setOpening] = useState<string | null>(null)
  const items = [...state.sessions].filter(item => (filter === 'all' || (filter === 'pinned' ? item.pinned : item.agent === filter)) && `${item.name} ${item.agent} ${item.cwd} ${item.preview || ''}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
  async function open(item: ChatSession) {
    if (opening) return
    setOpening(item.id)
    try { if (!item.open || item.status !== 'running') await api(`/sessions/${item.id}/resume`, {}); choose(item.id); close() }
    catch (error) { reportError(error) } finally { setOpening(null) }
  }
  return <section className="chat-history" aria-label="Chat history">
    <header><span><Icon name="history" /><strong>History</strong><small>{state.sessions.length} conversations</small></span><button className="desk-icon" aria-label="Close history" onClick={close}><Icon name="close" /></button></header>
    <div className="history-search"><Icon name="search" size={16} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a conversation…" aria-label="Search chat history" /></div>
    <div className="history-filters">{[['all', 'All'], ['pinned', 'Pinned'], ['codex', 'Codex'], ['claude', 'Claude'], ['opencode', 'OpenCode']].map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
    <div className="history-list">{items.map(item => <article key={item.id} className="history-item">
      <button className="history-open" onClick={() => open(item)} disabled={!!opening} title={`Open ${item.name} · ${chatActivityLabel(item)}`}><span className="history-agent" style={{ color: state.agents.find(agent => agent.id === item.agent)?.color }}><SessionLogo session={item} size={24} /></span><span><strong>{item.name}</strong><small>{state.agents.find(agent => agent.id === item.agent)?.label} · {item.open ? 'Open' : new Date(item.updatedAt || item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {item.cwd.split(/[\\/]/).filter(Boolean).slice(-1)[0]}</small>{item.preview && <p>{item.preview}</p>}</span><Icon name={opening === item.id ? 'refresh' : 'arrow'} size={16} /></button>
      <button className={`desk-icon history-pin ${item.pinned ? 'active' : ''}`} aria-label={`${item.pinned ? 'Unpin' : 'Pin'} ${item.name}`} onClick={() => api(`/sessions/${item.id}`, { pinned: !item.pinned }, 'PATCH').catch(reportError)}><Icon name="pin" size={15} /></button>
    </article>)}{!items.length && <p className="desk-muted">{query ? 'No matching conversations.' : filter === 'pinned' ? 'Pin a conversation to keep it close at hand.' : 'Closed chats will be here when you need them.'}</p>}</div>
    <footer>Close a tab to put it away. Its conversation stays here.</footer>
  </section>
}

export default function Chats() {
  const state = useDesktop()
  const [newChat, setNewChat] = useState(false)
  const [switcher, setSwitcher] = useState(false)
  const [history, setHistory] = useState(false)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [pinned, setPinned] = useState(false)
  const [fontSize, setFontSize] = useState(() => state.settings.terminalFontSize || 13)
  const [attachmentNotice, setAttachmentNotice] = useState({ id: '', text: '' })
  const attachmentStatus = useCallback((id: string, text: string) => setAttachmentNotice(current => text || current.id === id ? { id, text } : current), [])
  const active = orderedChats(state.sessions)
  const session = active.find(item => item.id === state.selectedId) || active[0]
  const agent = state.agents.find(item => item.id === session?.agent)
  const running = session?.status === 'running' || session?.status === 'starting'
  const filtered = active.filter(item => `${item.name} ${item.agent} ${item.cwd}`.toLowerCase().includes(query.toLowerCase()))
  const choose = (id: string) => { selectChat(id); setSwitcher(false); setMenu(false); setHistory(false); setRenaming(false) }
  const closeChat = (id: string) => api(`/sessions/${id}`, {}, 'DELETE').catch(reportError)
  useEffect(() => {
    if (!state.connected || !session?.unread || history || switcher || newChat) return
    let timer = 0
    const viewed = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible' && document.hasFocus()) sendEvent({ type: 'seen', id: session.id, completionVersion: session.completionVersion })
      }, 600)
    }
    viewed()
    window.addEventListener('focus', viewed)
    window.addEventListener('blur', viewed)
    document.addEventListener('visibilitychange', viewed)
    return () => { clearTimeout(timer); window.removeEventListener('focus', viewed); window.removeEventListener('blur', viewed); document.removeEventListener('visibilitychange', viewed) }
  }, [state.connected, session?.id, session?.unread, session?.completionVersion, history, switcher, newChat])
  useEffect(() => {
    document.title = 'Mr. Mak — Chats'
    const shortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyT') { event.preventDefault(); setNewChat(true) }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyP') { event.preventDefault(); setSwitcher(value => !value) }
      if (event.key === 'Escape') { setSwitcher(false); setMenu(false); setNewChat(false); setHistory(false) }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyH') { event.preventDefault(); setHistory(value => !value) }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyW' && session?.id) { event.preventDefault(); api(`/sessions/${session.id}`, {}, 'DELETE').catch(reportError) }
      const openChats = orderedChats(state.sessions)
      if (event.ctrlKey && event.code === 'Tab' && openChats.length) {
        event.preventDefault()
        const index = openChats.findIndex(item => item.id === session?.id)
        selectChat(openChats[(index + (event.shiftKey ? -1 : 1) + openChats.length) % openChats.length].id)
      }
      if (event.altKey && /^[1-9]$/.test(event.key)) {
        const target = openChats[Number(event.key) - 1]
        if (target) { event.preventDefault(); selectChat(target.id) }
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [state.sessions, session?.id])
  const changeFont = (delta: number) => { const value = Math.max(10, Math.min(24, fontSize + delta)); setFontSize(value); api('/settings', { terminalFontSize: value }).catch(reportError) }
  async function rename(event: React.FormEvent) { event.preventDefault(); if (!session) return; try { await api(`/sessions/${session.id}`, { name: title }, 'PATCH'); setRenaming(false) } catch (error) { reportError(error) } }

  return <div className="chats-surface">
    <header className="chats-header"><div className="chats-brand"><Nose size={25} tone="black" /><span>Mr. Mak <b>Chats</b></span></div><div className="chats-header-actions"><MobileAccess /><button className={`desk-icon ${pinned ? 'active' : ''}`} title="Keep Chats above other windows" onClick={() => { setPinned(!pinned); windowAction('chats', 'pin', !pinned) }}><Icon name="pin" size={16} /></button><button className="desk-icon" title="Show Workspace" onClick={() => windowAction('workspace')}><Icon name="workspace" size={18} /></button></div></header>
    <div className="chat-tabs-row"><ChatTabs items={active} selectedId={session?.id} agents={state.agents} choose={choose} close={closeChat} /><div className="chat-tab-actions"><button className="desk-icon new-chat-button" onClick={() => setNewChat(true)} title="New chat · Ctrl+Shift+T" aria-label="New chat"><Icon name="plus" /></button><button className={`desk-icon ${switcher ? 'active' : ''}`} onClick={() => { setSwitcher(value => !value); setHistory(false) }} title="Find a chat · Ctrl+Shift+P" aria-label="Find a chat"><Icon name="search" size={16} /></button><button className={`history-button ${history ? 'active' : ''}`} onClick={() => { setHistory(value => !value); setSwitcher(false); setMenu(false) }} title="History · Ctrl+Shift+H"><Icon name="history" size={15} /><span>History</span></button></div></div>
    <div className="chat-body">
    {history && <History close={() => setHistory(false)} choose={choose} />}
    {switcher && <div className="chat-switcher"><div className="switcher-search"><Icon name="search" size={16} /><input autoFocus placeholder="Find any chat…" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="switcher-list">{filtered.map(item => <button key={item.id} onClick={() => choose(item.id)} className={session?.id === item.id ? 'selected' : ''}><span className="agent-letter" style={{ color: state.agents.find(a => a.id === item.agent)?.color }}><SessionLogo session={item} size={19} /></span><span><strong>{item.name}</strong><small>{item.cwd}</small></span><span className="switcher-state">{chatActivityLabel(item)}</span></button>)}{!filtered.length && <p className="desk-muted">No matching chats.</p>}</div></div>}
    {session ? <>
      <div className="chat-context"><span className="agent-label" style={{ color: agent?.color }}>{agent?.label}</span><span className="chat-folder" title={session.cwd}>{session.cwd.split(/[\\/]/).filter(Boolean).slice(-1)[0]}</span><button className="desk-icon" title="Attach file paths · drop files or folders · Ctrl+V for screenshots" aria-label="Attach files" onClick={() => window.dispatchEvent(new Event('mrmak-attach-file'))}><Icon name="attach" size={16} /></button><DictationComposer key={`dictation-${session.id}`} id={session.id} connected={state.connected} running={session.status === 'running'} /><button className="desk-icon" title="Chat options" onClick={() => setMenu(!menu)}><Icon name="more" size={18} /></button></div>
      {menu && <div className="chat-options">{renaming ? <form className="inline-rename" onSubmit={rename}><input autoFocus value={title} onChange={event => setTitle(event.target.value)} aria-label="English chat name" /><button type="submit">Save</button></form> : <button onClick={() => { setTitle(session.name); setRenaming(true) }}>Rename chat</button>}<button onClick={() => api(`/sessions/${session.id}`, { pinned: !session.pinned }, 'PATCH').catch(reportError)}>{session.pinned ? 'Unpin from History' : 'Pin in History'}</button><button onClick={() => api('/reveal', { path: session.cwd }).catch(reportError)}>Show working folder</button><button onClick={() => api(`/sessions/${session.id}/clear`, {}).then(() => setMenu(false)).catch(reportError)} title="Clear visible scrollback; keep the agent conversation">Clear terminal scrollback</button><div className="chat-color-setting"><span>Tab color</span><div role="group" aria-label="Tab color"><button className={`tab-color-swatch no-color ${!session.tabColor ? 'selected' : ''}`} aria-label="No tab color" aria-pressed={!session.tabColor} onClick={() => api(`/sessions/${session.id}`, { tabColor: null }, 'PATCH').catch(reportError)} title="No color" />{tabColors.map(color => <button key={color.value} className={`tab-color-swatch ${session.tabColor === color.value ? 'selected' : ''}`} style={{ '--swatch': color.value } as React.CSSProperties} aria-label={`${color.name} tab color`} aria-pressed={session.tabColor === color.value} title={color.name} onClick={() => api(`/sessions/${session.id}`, { tabColor: color.value }, 'PATCH').catch(reportError)} />)}</div></div><div className="terminal-appearance-setting"><span>Terminal appearance <small>All chats</small></span><div role="group" aria-label="Terminal appearance">{[['original', 'Original CLI colors'], ['focus', 'Mr. Mak Focus']].map(([value, label]) => <button key={value} aria-pressed={(state.settings.terminalAppearance || 'original') === value} onClick={() => api('/settings', { terminalAppearance: value }).catch(reportError)}>{label}</button>)}</div><p><i className="legend-user" />You <i className="legend-agent" />Agent <i className="legend-detail" />Details</p></div><div className="font-control"><span>Terminal text</span><button onClick={() => changeFont(-1)}>−</button><span>{fontSize}</span><button onClick={() => changeFont(1)}>+</button></div><button onClick={() => { closeChat(session.id); setMenu(false) }}>Close tab · keep in History</button></div>}
      <TerminalPane key={session.id} id={session.id} agent={session.agent} fontSize={fontSize} appearance={state.settings.terminalAppearance || 'original'} onAttachmentStatus={attachmentStatus} />
      {!running && <div className="terminal-reconnect"><span>{session.restoreError || 'Reconnecting to your conversation…'}</span><button onClick={() => api(`/sessions/${session.id}/resume`, {}).catch(reportError)}>Reconnect</button></div>}
      <footer className="chat-status">{attachmentNotice.id === session.id && attachmentNotice.text ? <span className="attachment-status" role="status"><Icon name="attach" size={12} /><span>{attachmentNotice.text}</span></span> : <><span><i className={state.connected ? 'connected-dot' : 'disconnected-dot'} />{state.connected ? running ? 'Connected · autosaved' : 'Reconnecting…' : 'Reconnecting…'}</span><span title={session.effort ? 'Reasoning effort · terminal permissions' : undefined}>{session.effort && `${session.effort} · `}{session.agent === 'shell' ? 'Windows' : session.bypass ? 'Bypass' : 'CLI permissions'}</span><span className="status-shortcut">Ctrl+V · image</span></>}</footer>
    </> : <div className="chats-empty"><div className="empty-orbit"><Nose size={64} tone="black" /></div><span className="desk-eyebrow">ROOM TO THINK</span><h1>Your agents,<br />close at hand.</h1><p>A chat for each task.<br />Keep this window beside whatever<br />you are working on.</p><button className="desk-primary" onClick={() => setNewChat(true)}><Icon name="plus" size={17} />Open your first chat</button><div className="empty-agent-names"><span>Claude</span><span>Codex</span><span>OpenCode</span><span>Kimi</span></div><small>Your CLI accounts. Your local files.</small></div>}
    </div>
    {newChat && <NewChat close={() => setNewChat(false)} />}
  </div>
}
