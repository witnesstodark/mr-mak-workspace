import { useCallback, useEffect, useState } from 'react'
import { api, useDesktop } from './client'
import { Icon } from './Icons'
import type { RecentProject } from './types'
import { fileManager } from './platform'
import './rules.css'

type Rule = { line: number; text: string }
type Rules = { path: string; exists: boolean; rules: Rule[] }
type Candidate = { name: string; description: string; count: number | null; examples: string[]; steps: string[] }
const GLOBAL = 'global'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const folderName = (folder: string) => folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folder

// The rules an agent follows in one project. They are stored in the project's
// repository, and agents add one when the owner corrects how they work.
export default function RulesPanel({ onClose }: { onClose: () => void }) {
  const { repo, sessions, selectedId } = useDesktop()
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [folder, setFolder] = useState(() => sessions.find(item => item.id === selectedId)?.cwd || repo)
  const [value, setValue] = useState<Rules | null>(null)
  const [draft, setDraft] = useState(''), [editing, setEditing] = useState<Rule | null>(null), [edit, setEdit] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const global = folder === GLOBAL
  const refresh = useCallback(async () => {
    try { setValue(await api<Rules>(folder === GLOBAL ? '/rules?scope=global' : `/rules?path=${encodeURIComponent(folder)}`)); setError('') } catch (cause) { setError(message(cause)) }
  }, [folder])
  const [skills, setSkills] = useState<{ folder: string; prompts: number; candidates: Candidate[] } | null>(null)
  const [finding, setFinding] = useState(false), [created, setCreated] = useState<Record<string, string>>({})
  useEffect(() => { api<RecentProject[]>('/recent-projects').then(setProjects).catch(() => setProjects([])) }, [])
  useEffect(() => {
    void Promise.resolve().then(refresh)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(onFocus, 15000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer) }
  }, [refresh])
  const change = async (body: Record<string, unknown>) => {
    setBusy(true); setError('')
    try { setValue(await api<Rules>('/rules', global ? { scope: GLOBAL, ...body } : { path: folder, ...body })); return true }
    catch (cause) { setError(message(cause)); await refresh(); return false }
    finally { setBusy(false) }
  }
  const add = async () => { if (draft.trim() && await change({ action: 'add', text: draft })) setDraft('') }
  const save = async () => { if (editing && edit.trim() && await change({ action: 'update', line: editing.line, expected: editing.text, text: edit })) setEditing(null) }
  const choices = global || projects.some(item => item.path.toLowerCase() === folder.toLowerCase()) ? projects : [{ path: folder, name: folderName(folder) } as RecentProject, ...projects]
  const discover = async () => {
    setFinding(true); setError('')
    try { setSkills({ folder, ...await api<{ prompts: number; candidates: Candidate[] }>('/skills/discover', { path: folder }) }) } catch (cause) { setError(message(cause)) } finally { setFinding(false) }
  }
  const create = async (candidate: Candidate) => {
    try { const result = await api<{ path: string }>('/skills/create', { path: folder, candidate }); setCreated(current => ({ ...current, [candidate.name]: result.path })) } catch (cause) { setError(message(cause)) }
  }
  return <div className="files-panel rules-panel"><header><h2>Rules</h2><div>
    <button className="desk-icon" onClick={() => void refresh()} title="Refresh rules" aria-label="Refresh rules"><Icon name="refresh" size={15} /></button>
    <button className="desk-icon" onClick={onClose} aria-label="Close rules"><Icon name="close" size={17} /></button>
  </div></header>
    <div className="rules-project"><label>Project<select aria-label="Project for these rules" value={folder} onChange={event => { setFolder(event.target.value); setValue(null); setEditing(null) }}><option value={GLOBAL}>Global · every chat</option>{choices.map(item => <option key={item.path} value={item.path}>{item.name || folderName(item.path)}</option>)}</select></label>
      <p>{value ? `${value.rules.length} ${value.rules.length === 1 ? 'rule' : 'rules'}` : 'Reading rules…'} · new Claude Code, Codex and OpenCode chats {global ? 'in every project' : 'in this project'} start with them. Start a message with "remember:" or "lembre:" to propose one from a chat.</p></div>
    <div className="rules-scroll">
      {error && <p className="desk-error-inline" role="alert">{error}</p>}
      <ol className="rules-list">{value?.rules.map(rule => <li key={`${rule.line}:${rule.text}`}>
        {editing?.line === rule.line ? <form onSubmit={event => { event.preventDefault(); void save() }}>
          <textarea aria-label="Edit rule" value={edit} maxLength={500} rows={3} autoFocus onChange={event => setEdit(event.target.value.replace(/\s*\n\s*/g, ' '))} onKeyDown={event => { if (event.key === 'Escape') setEditing(null); if (event.key === 'Enter') { event.preventDefault(); void save() } }} />
          <div><button type="submit" disabled={busy || !edit.trim()}>Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
        </form> : <><p>{rule.text}</p><div>
          <button className="desk-icon" disabled={busy} onClick={() => { setEditing(rule); setEdit(rule.text) }} title="Edit rule" aria-label={`Edit rule: ${rule.text}`}><Icon name="edit" size={13} /></button>
          <button className="desk-icon" disabled={busy} onClick={() => void change({ action: 'remove', line: rule.line, expected: rule.text })} title="Remove rule" aria-label={`Remove rule: ${rule.text}`}><Icon name="trash" size={13} /></button>
        </div></>}
      </li>)}</ol>
      {value && !value.rules.length && <p className="rules-empty">{global ? 'No global rules yet. Add one here, or save one from a chat.' : 'No rules yet. Add one here, or correct an agent and it adds the rule itself.'}</p>}
      <form className="rules-add" onSubmit={event => { event.preventDefault(); void add() }}>
        <textarea aria-label="New rule" placeholder="For example: Keep every UI text in English." value={draft} maxLength={500} rows={2} onChange={event => setDraft(event.target.value.replace(/\s*\n\s*/g, ' '))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void add() } }} />
        <button type="submit" disabled={busy || !draft.trim()}><Icon name="plus" size={13} />Add rule</button>
      </form>
      {!global && <section className="skill-discovery" aria-label="Skill discovery">
        <h3>Repeated requests</h3>
        <p>Reads the last two weeks of Claude Code and Codex requests in this project and proposes skills for what you ask again and again. One Claude call on your account.</p>
        <button className="desk-secondary" disabled={finding} onClick={() => void discover()}>{finding ? 'Reading the requests…' : 'Find skill ideas'}</button>
        {skills?.folder === folder && <>
          <small>{skills.prompts} requests read · {skills.candidates.length ? `${skills.candidates.length} ideas` : 'nothing repeats often enough'}</small>
          {skills.candidates.map(item => <article key={item.name} className="skill-candidate">
            <header><strong>{item.name}</strong>{item.count != null && <span>×{item.count}</span>}</header>
            <p>{item.description}</p>
            <details><summary>Steps and examples</summary><ol>{item.steps.map(step => <li key={step}>{step}</li>)}</ol>{item.examples.map(example => <blockquote key={example}>{example}</blockquote>)}</details>
            {created[item.name] ? <small title={created[item.name]}>Draft created · {created[item.name]}</small> : <button onClick={() => void create(item)}>Create draft skill</button>}
          </article>)}
        </>}
      </section>}
    </div>
    {value && <footer className="rules-footer"><p>{global ? 'Stored with Mr. Mak at' : 'Stored in the repository at'} <code>{value.path}</code>. Chats already open keep the rules they started with until they restart.</p>{value.exists && <button onClick={() => api('/reveal', { path: value.path }).catch(cause => setError(message(cause)))}>Show in {fileManager} <Icon name="external" size={12} /></button>}</footer>}
  </div>
}
