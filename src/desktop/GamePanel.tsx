import { useCallback, useEffect, useState } from 'react'
import { api, onServiceEvent, reportError } from './client'
import { Icon } from './Icons'
import { folderName, sameFolder } from './gamePanelState'
import type { ChatSession, GameConfig, GameState, RecentProject } from './types'
import './game-panel.css'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const shown = (value: string) => value === '' || /[\s"]/.test(value) ? `"${value}"` : value

// A project's game beside a chat: run it in its own window without an agent
// turn, see its output, and preview it here when it runs in a browser. The game
// belongs to a project, not to the chat: chats that share a folder (the
// Workspace) each choose the project they work on, kept in the chat. Nothing
// runs on opening; the owner presses Run and confirms a command before its
// first run and whenever .agents/game.json changes.
export default function GamePanel({ session, onClose }: { session: ChatSession; onClose: () => void }) {
  const folder = session.gameFolder || session.cwd
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [game, setGame] = useState<GameState | null>(null)
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<GameConfig>({ command: '' })
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [frame, setFrame] = useState(0)
  const refresh = useCallback(async () => {
    try { setGame(await api<GameState>(`/game?id=${encodeURIComponent(session.id)}`)); setError('') } catch (cause) { setError(message(cause)) }
  }, [session.id])
  useEffect(() => { api<RecentProject[]>('/recent-projects').then(setProjects).catch(() => setProjects([])) }, [])
  useEffect(() => {
    void Promise.resolve().then(refresh)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    const stop = onServiceEvent(event => { if (event.type === 'game' && event.path && event.status) setGame(current => current && sameFolder(current.folder, event.path!) ? { ...current, status: event.status! } : current) })
    return () => { window.removeEventListener('focus', onFocus); stop() }
    // A newly chosen project is read again.
  }, [refresh, folder])
  const act = async (route: string, body: Record<string, unknown> = {}) => {
    setBusy(true); setError('')
    try { setGame(await api<GameState>(route, { id: session.id, ...body })); return true }
    catch (cause) { setError(message(cause)); void refresh(); return false }
    finally { setBusy(false) }
  }
  const setup = () => api('/game/setup', { id: session.id }).catch(reportError)
  const config = game?.config, status = game?.status, launch = game?.launch
  const startEdit = () => { setDraft(config || { command: '' }); setConfirming(false); setEditing(true) }
  const choose = (value: string) => {
    setGame(null); setEditing(false); setConfirming(false); setError('')
    api(`/sessions/${encodeURIComponent(session.id)}`, { gameFolder: sameFolder(value, session.cwd) ? null : value }, 'PATCH').catch(cause => setError(message(cause)))
  }
  const choices = [{ path: session.cwd, name: `${folderName(session.cwd)} · this chat's folder` }, ...projects.filter(item => !sameFolder(item.path, session.cwd))]
  if (!choices.some(item => sameFolder(item.path, folder))) choices.splice(1, 0, { path: folder, name: folderName(folder) } as RecentProject)
  const save = async () => { if (await act('/game', { config: draft })) setEditing(false) }
  const run = () => { if (launch?.approved) void act('/game/run'); else setConfirming(true) }
  const confirm = async () => { if (launch && await act('/game/run', { approve: launch.digest })) setConfirming(false) }

  return <aside className="game-panel" aria-label="Game">
    <header><h2>Game</h2>{config && !editing && <button className="desk-icon" title="Edit how the game starts" aria-label="Edit game command" onClick={startEdit}><Icon name="edit" size={14} /></button>}<button className="desk-icon" aria-label="Close game panel" onClick={onClose}><Icon name="close" size={14} /></button></header>
    <div className="game-panel-body">
      <label className="game-panel-project">Project<select aria-label="Project whose game this chat runs" value={choices.find(item => sameFolder(item.path, folder))?.path || folder} disabled={status?.running} title={status?.running ? 'Stop the game to choose another project' : folder} onChange={event => choose(event.target.value)}>{choices.map(item => <option key={item.path} value={item.path}>{item.name || folderName(item.path)}</option>)}</select></label>
      {error && <p className="game-panel-error" role="alert">{error}</p>}
      {game?.error && <p className="game-panel-error">{game.error}</p>}
      {editing ? <form className="game-panel-form" onSubmit={event => { event.preventDefault(); void save() }}>
        <label>Command <small>one program and its arguments, no shell operators</small><input autoFocus value={draft.command} onChange={event => setDraft({ ...draft, command: event.target.value })} placeholder="npm run dev · godot --path . · game.exe" /></label>
        <label>Folder <small>inside the project, optional</small><input value={draft.cwd || ''} onChange={event => setDraft({ ...draft, cwd: event.target.value })} placeholder="game" /></label>
        <label>Preview address <small>for a game in the browser, optional</small><input value={draft.url || ''} onChange={event => setDraft({ ...draft, url: event.target.value })} placeholder="http://localhost:5173" /></label>
        <div className="game-panel-actions"><button type="submit" className="desk-primary" disabled={busy || !draft.command.trim()}>Save</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      </form> : !game ? <p className="game-panel-note">Reading this project…</p> : !config ? <div className="game-panel-empty">
        <p>{folderName(folder)} has no game command yet. {session.agent === 'shell' ? 'Write it here, or ask an agent chat in this project to set it up' : 'The agent in this chat can find how the game starts and save it'} in <code>.agents/game.json</code> of that project. If this chat works on another project, choose it above.</p>
        <div className="game-panel-actions">{session.agent !== 'shell' && <button className="desk-primary" onClick={() => void setup()}>Ask the agent to set it up</button>}<button onClick={startEdit}>Write it myself</button></div>
      </div> : <>
        {confirming && !status?.running && launch && !launch.error ? <section className="game-panel-confirm" role="alertdialog" aria-label="Confirm game command">
          <strong>Run this command?</strong>
          <p>{launch.changed ? <><code>.agents/game.json</code> changed since you last ran this game. Check the new command.</> : <>It comes from <code>.agents/game.json</code> in this project. Mr. Mak runs it only after you confirm it, and asks again when the file changes.</>}</p>
          <dl>
            <dt>Program</dt><dd>{launch.program}</dd>
            {!!launch.args?.length && <><dt>Arguments</dt><dd>{launch.args.map(shown).join(' ')}</dd></>}
            <dt>Folder</dt><dd>{launch.folder}</dd>
            {config.url && <><dt>Preview</dt><dd>{config.url}</dd></>}
          </dl>
          <div className="game-panel-actions"><button className="desk-primary" disabled={busy} onClick={() => void confirm()}><Icon name="play" size={12} />Run it</button><button onClick={() => setConfirming(false)}>Cancel</button></div>
        </section> : <div className="game-panel-run">
          {status?.running ? <button className="desk-primary" disabled={busy} onClick={() => void act('/game/stop')}><Icon name="stop" size={12} />Stop game</button> : <button className="desk-primary" disabled={busy || !!launch?.error} onClick={run}><Icon name="play" size={12} />Run game</button>}
          <span className="game-panel-state">{status?.running ? 'Running' : status?.endedAt ? `Exited${status.exitCode != null ? ` · code ${status.exitCode}` : ''}` : launch && !launch.approved ? 'Asks before the first run' : 'Not running'}</span>
        </div>}
        {launch?.error && <p className="game-panel-error">{launch.error}</p>}
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
