import { useEffect, useState } from 'react'
import { api, reportError } from './client'
import type { RecentProject } from './types'
import { Icon } from './Icons'
import { isWindows } from './platform'

const sameFolder = (a: string, b: string) => {
  const clean = (value: string) => value.trim().replace(/[\\/]+$/, '').replace(/\//g, isWindows ? '\\' : '/')
  return isWindows ? clean(a).toLowerCase() === clean(b).toLowerCase() : clean(a) === clean(b)
}
const sourceLabel = (project: RecentProject) => project.sources.includes('workspace') ? 'Mr. Mak Workspace' : project.sources.includes('claude') ? 'Claude Code' : project.sources.includes('codex') ? 'Codex' : 'Mr. Mak'

// Recent folders from Claude Code, Codex and earlier Mr. Mak chats, pinned favorites
// first. The folder field stays editable.
export default function ProjectPicker({ cwd, choose }: { cwd: string; choose: (path: string) => void }) {
  const [projects, setProjects] = useState<RecentProject[] | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => { let alive = true; api<RecentProject[]>('/recent-projects').then(value => { if (alive) setProjects(value) }).catch(() => { if (alive) setProjects([]) }); return () => { alive = false } }, [])
  const pin = (project: RecentProject) => api<RecentProject[]>('/recent-projects/pin', { path: project.path, pinned: !project.pinned }).then(setProjects).catch(reportError)
  const shown = (projects || []).filter(item => `${item.name} ${item.path}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="desk-field project-field">
    <span className="project-field-heading">Project <small>Synced with Claude Code, Codex and your chats</small></span>
    {(projects?.length || 0) > 6 && <div className="project-search"><Icon name="search" size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a project…" aria-label="Find a project" /></div>}
    <div className="project-list" role="radiogroup" aria-label="Recent projects">
      {shown.map(item => { const selected = sameFolder(item.path, cwd); return <div key={item.path} className={`project-row ${selected ? 'selected' : ''}`}>
        <button type="button" role="radio" aria-checked={selected} className="project-choice" title={item.path} onClick={() => choose(item.path)}><Icon name="folder" size={16} /><span><strong>{item.name}</strong><small>{item.path}</small></span><em>{sourceLabel(item)}</em></button>
        {!item.sources.includes('workspace') && <button type="button" className={`desk-icon project-pin ${item.pinned ? 'active' : ''}`} aria-pressed={item.pinned} aria-label={`${item.pinned ? 'Unpin' : 'Pin'} ${item.name}`} title={item.pinned ? 'Unpin project' : 'Pin to the top'} onClick={() => void pin(item)}><Icon name="pin" size={13} /></button>}
      </div> })}
      {!projects && <p className="desk-muted">Loading projects…</p>}
      {projects && !shown.length && <p className="desk-muted">{query ? 'No matching projects.' : 'Projects you open in Claude Code or here will be listed.'}</p>}
    </div>
  </div>
}
