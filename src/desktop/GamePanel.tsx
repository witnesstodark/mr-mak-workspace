import { useCallback, useEffect, useState } from 'react'
import { api, onServiceEvent, reportError } from './client'
import { Icon } from './Icons'
import type { ChatSession, GameConfig, GameState, RecentProject } from './types'
import './game-panel.css'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

// A project's game beside a chat: run it in its own window without an agent
// turn, see its output, and preview it here when it runs in a browser. The game
// belongs to a project, not to the chat: chats that share a folder (the
// Workspace) each choose the project they work on, kept in the chat.
export default function GamePanel({ session, onClose }: { session: ChatSession; onClose: () => void }) {
  const folder = session.gameFolder || session.cwd
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [game, setGame] = useState<GameState | null>(null)
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<GameConfig>({ command: '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [frame, setFrame] = useState(0)
  const refresh = useCallback(async () => {
    try { setGame(await api<GameState>(`/game?path=${encodeURIComponent(folder)}`)); setError('') } catch (cause) { setError(message(cause)) }
  }, [folder])
  useEffect(() => { api<RecentProject[]>('/recent-projects').then(setProjects).catch(() => setProjects([])) }, [])
  useEffect(() => {
    void Promise.resolve().then(refresh)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    const stop = onServiceEvent(event => { if (event.type === 'game' && event.path && event.status) setGame(current => current && sameFolder(current.path, event.path!) ? { ...current, status: event.status! } : current) })
    return () => { window.removeEventListener('focus', onFocus); stop() }
  }, [refresh])
  const act = async (path: string, body: Record<string, unknown> = {}) => {
    setBusy(true); setError('')
    try { setGame(await api<GameState>(path, { path: folder, ...body })); return true }
    catch (cause) { setError(message(cause)); return false }
    finally { setBusy(false) }
  }
  const setup = () => api(`/game/setup`, { id: session.id }).catch(reportError)
  const config = game?.config, status = game?.status
  const startEdit = () => { setDraft(config || { command: '' }); setEditing(true) }
  const choose = (value: string) => {
    setGame(null); setEditing(false); setError('')
    api(`/sessions/${encodeURIComponent(session.id)}`, { gameFolder: sameFolder(value, session.cwd) ? null : value }, 'PATCH').catch(cause => setError(message(cause)))
  }
  const choices = [{ path: session.cwd, name: `${folderName(session.cwd)} · this chat's folder` }, ...projects.filter(item => !sameFolder(item.path, session.cwd))]
  if (!choices.some(item => sameFolder(item.path, folder))) choices.splice(1, 0, { path: folder, name: folderName(folder) } as RecentProject)
  const save = async () => { if (await act('/game', { config: draft })) setEditing(false) }

  return <aside className="game-panel" aria-label="Game">
    <header><h2>Game</h2>{config && !editing && <button className="desk-icon" title="Edit how the game starts" aria-label="Edit game command" onClick={startEdit}><Icon name="edit" size={14} /></button>}<button className="desk-icon" aria-label="Close game panel" onClick={onClose}><Icon name="close" size={14} /></button></header>
    <div className="game-panel-body">
      <label className="game-panel-project">Project<select aria-label="Project whose game this chat runs" value={choices.find(item => sameFolder(item.path, folder))?.path || folder} disabled={status?.running} title={status?.running ? 'Stop the game to choose another project' : folder} onChange={event => choose(event.target.value)}>{choices.map(item => <option key={item.path} value={item.path}>{item.name || folderName(item.path)}</option>)}</select></label>
      {error && <p className="game-panel-error" role="alert">{error}</p>}
      {game?.error && <p className="game-panel-error">{game.error}</p>}
      {editing ? <form className="game-panel-form" onSubmit={event => { event.preventDefault(); void save() }}>
        <label>Command<input autoFocus value={draft.command} onChange={event => setDraft({ ...draft, command: event.target.value })} placeholder="npm run dev · godot --path . · game.exe" /></label>
        <label>Folder <small>inside the project, optional</small><input value={draft.cwd || ''} onChange={event => setDraft({ ...draft, cwd: event.target.value })} placeholder="game" /></label>
        <label>Preview address <small>for a game in the browser, optional</small><input value={draft.url || ''} onChange={event => setDraft({ ...draft, url: event.target.value })} placeholder="http://localhost:5173" /></label>
        <div className="game-panel-actions"><button type="submit" className="desk-primary" disabled={busy || !draft.command.trim()}>Save</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      </form> : !game ? <p className="game-panel-note">Reading this project…</p> : !config ? <div className="game-panel-empty">
        <p>{folderName(folder)} has no game command yet. The agent in this chat can find how the game starts and save it in <code>.agents/game.json</code> of that project. If this chat works on another project, choose it above.</p>
        <div className="game-panel-actions"><button className="desk-primary" onClick={() => void setup()}>Ask the agent to set it up</button><button onClick={startEdit}>Write it myself</button></div>
      </div> : <>
        <div className="game-panel-run">
          {status?.running ? <button className="desk-primary" disabled={busy} onClick={() => void act('/game/stop')}><Icon name="stop" size={12} />Stop game</button> : <button className="desk-primary" disabled={busy} onClick={() => void act('/game/run')}><Icon name="play" size={12} />Run game</button>}
          <span className="game-panel-state">{status?.running ? 'Running' : status?.endedAt ? `Exited${status.exitCode != null ? ` · code ${status.exitCode}` : ''}` : 'Not running'}</span>
        </div>
        <code className="game-panel-command" title={config.cwd ? `In ${config.cwd}` : 'In the project folder'}>{config.command}</code>
        {config.url && <div className="game-panel-preview">
          <div className="game-panel-preview-bar"><span title={config.url}>{config.url}</span><button className="desk-icon" title="Reload preview" aria-label="Reload preview" onClick={() => setFrame(value => value + 1)}><Icon name="refresh" size={13} /></button></div>
          {status?.running ? <iframe key={frame} title="Game preview" src={config.url} sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" allow="autoplay; fullscreen; gamepad" /> : <p className="game-panel-note">Run the game to preview it here.</p>}
        </div>}
        <section className="game-panel-output" aria-label="Game output">{status?.output.length ? status.output.map((line, index) => <div key={index}>{line}</div>) : <p className="game-panel-note">The game's console output appears here.</p>}</section>
      </>}
    </div>
  </aside>
}

const folderName = (value: string) => value.split(/[\\/]/).filter(Boolean).slice(-1)[0] || value

const sameFolder = (left: string, right: string) => {
  const folder = (value: string) => value.replace(/[\\/]\.agents[\\/]game\.json$/i, '').replace(/[\\/]+$/, '').toLowerCase()
  return folder(left) === folder(right)
}
