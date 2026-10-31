import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { api, desktopState, reportError, setPreview, uploadFile, useDesktop, windowAction } from './client'
import type { FileEntry, Folder, Preview } from './types'
import { Icon } from './Icons'
import MarkdownDocument from '../components/MarkdownDocument'
import WorkspaceSettings from './WorkspaceSettings'
import McpPanel from './McpPanel'
import RulesPanel from './RulesPanel'
import { ZoomImage } from '../components/ImagePreview'
import ReportFrame, { REPORT_SANDBOX } from '../components/ReportFrame'
import { fileManager, isMac, trashName } from './platform'
import { gitMark, showDiff, showMap, useAgentFiles, useFollow, useGitStatus, type GitFile } from './fileInsights'
import { DiffView, FolderMap } from './FileExtras'

export function FilePreview({ file }: { file: Preview }) {
  // A format the webview cannot play (ProRes, HEIC before Safari 17, odd codecs) falls back to the desktop-app card.
  const [failed, setFailed] = useState('')
  const kind = file.url && failed === file.url ? 'unsupported' : file.kind
  const reason = kind === file.kind ? file.reason : 'Open this file in its desktop application.'
  const fail = () => setFailed(file.url || '')
  return <div className="file-preview"><header><span><Icon name="files" size={16} /><strong title={file.name}>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB</small></span><div><button className="desk-icon" onClick={() => api('/reveal', { path: file.path }).catch(reportError)} title={`Show in ${fileManager}`}><Icon name="external" size={17} /></button><button className="desk-icon" onClick={() => setPreview(null)} title="Back to Workspace" aria-label="Close file preview"><Icon name="close" size={18} /></button></div></header><div className={`file-preview-body ${kind}`}>
    {file.kind === 'diff' && <DiffView text={file.text || ''} />}
    {file.kind === 'map' && file.map && <FolderMap map={file.map} />}
    {file.kind === 'text' && (/\.md$/i.test(file.name) ? <MarkdownDocument key={`${file.path}:${file.revision}`} file={file} /> : <pre>{file.text}</pre>)}
    {file.kind === 'document' && file.url && <ReportFrame url={file.url} title={file.name} sandbox={REPORT_SANDBOX} />}
    {kind === 'image' && <ZoomImage src={file.url} alt={file.name} onError={fail} />}
    {kind === 'video' && <video src={file.url} controls onError={fail} />}
    {kind === 'audio' && <audio src={file.url} controls onError={fail} />}
    {kind === 'unsupported' && <div className="file-unsupported"><Icon name="files" size={38} /><h2>{file.name}</h2><p>{reason}</p><button className="desk-secondary" onClick={() => api('/reveal', { path: file.path }).catch(reportError)}>Show in {fileManager}</button></div>}
  </div></div>
}

// A backslash is a legal file-name character on macOS, not a separator.
const separator = isMac ? /\// : /[\\/]/
const pathKey = (path: string) => (isMac ? path : path.replace(/\\/g, '/')).replace(/\/$/, '').toLowerCase()
const fileName = (path: string) => path.replace(isMac ? /\/$/ : /[\\/]$/, '').split(separator).pop() || path
const parentPath = (path: string) => path.replace(isMac ? /\/[^/]+$/ : /[\\/][^\\/]+$/, '')
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
function RevealFolder({ path, name }: { path: string; name: string }) {
  return <button className="file-reveal" title={`Show ${name} in ${fileManager}`} aria-label={`Show ${name} in ${fileManager}`} onClick={event => { event.stopPropagation(); api('/reveal', { path }).catch(reportError) }}><Icon name="external" size={14} /></button>
}
function RowAction({ label, text, onClick }: { label: string; text: string; onClick: () => void }) {
  return <button className="file-reveal file-action" title={label} aria-label={label} onClick={event => { event.stopPropagation(); onClick() }}>{text}</button>
}
// Deep folders keep indenting, in smaller steps, so every level stays visible.
const indent = (depth: number) => 8 + Math.min(depth, 6) * 14 + Math.max(0, depth - 6) * 6
const lines = (file?: GitFile) => file && (file.added || file.removed) ? `+${file.added ?? 0} −${file.removed ?? 0}` : ''
type TreeControls = {
  expanded: Set<string>; selected: string; dropTarget: string; query: string; revision: number
  git: ReturnType<typeof useGitStatus>; touched: ReturnType<typeof useAgentFiles>['touched']
  toggle: (path: string) => void
  preview: (entry: FileEntry) => void
  drag: (event: DragEvent, path: string, directory: boolean) => void
  dropProps: (path: string) => {
    onDragOver: (event: DragEvent) => void
    onDragLeave: (event: DragEvent) => void
    onDrop: (event: DragEvent) => void
  }
}

function FolderBranch({ path, mode = 'all', depth = 1, ancestors = [], tree, onLoad }: {
  path: string; mode?: 'main' | 'all'; depth?: number; ancestors?: string[]; tree: TreeControls; onLoad?: (folder: Folder) => void
}) {
  const [folder, setFolder] = useState<Folder | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    api<Folder>(`/files?path=${encodeURIComponent(path)}&mode=${mode}`).then(value => {
      if (!abort.signal.aborted) { setFolder(value); setError(''); onLoad?.(value) }
    }).catch(error => { if (!abort.signal.aborted) setError(message(error)) })
    return () => abort.abort()
  }, [path, mode, tree.revision, onLoad])
  if (error) return <p className="file-tree-note desk-error-inline">{error}</p>
  if (!folder) return <p className="file-tree-note">Loading folder…</p>
  if (ancestors.includes(pathKey(folder.path))) return <p className="file-tree-note">Linked folder already shown above.</p>
  if (depth > 20) return <button className="file-tree-note" onClick={() => api('/reveal', { path }).catch(reportError)}>Open this deep folder in {fileManager}</button>
  const entries = folder.entries.filter(entry => entry.directory || entry.name.normalize('NFC').toLowerCase().includes(tree.query.normalize('NFC').toLowerCase()))
  return <div role="group" className="file-group" style={{ ['--guide' as string]: `${indent(depth) + 4}px` }} {...tree.dropProps(folder.path)}>{entries.map(entry => {
    const expanded = tree.expanded.has(pathKey(entry.path))
    const git = entry.directory ? undefined : tree.git.lookup(entry.path), changed = entry.directory && tree.git.changedFolder(entry.path)
    const agent = tree.touched.get(pathKey(entry.path))
    const actions = entry.directory ? 2 : git && git.status !== 'deleted' ? 1 : 0
    return <div role="none" key={entry.path}>
      <div role="none" className={`file-entry ${actions ? 'has-reveal' : ''}`} style={actions ? { ['--actions' as string]: `${actions * 28 + 4}px` } : undefined} {...(entry.directory ? tree.dropProps(entry.path) : {})}>
      <button role="treeitem" data-path={entry.path} aria-level={depth + 1} aria-expanded={entry.directory ? expanded : undefined} aria-selected={pathKey(tree.selected) === pathKey(entry.path)}
        className={`file-row ${entry.directory ? 'directory' : ''} ${pathKey(tree.selected) === pathKey(entry.path) ? 'selected' : ''} ${tree.dropTarget === pathKey(entry.path) ? 'drop-target' : ''} ${git ? `git-${git.status}` : changed ? 'git-folder' : ''} ${agent ? `agent-${agent.kind} ${agent.recent ? 'agent-recent' : ''}` : ''}`}
        style={{ paddingLeft: indent(depth) }} title={[entry.path, git && `Git: ${git.status}${git.staged ? ' (staged)' : ''}`, agent && `Agent ${agent.kind === 'write' ? 'wrote' : 'read'} this file`].filter(Boolean).join('\n')}
        onClick={() => entry.directory ? tree.toggle(entry.path) : tree.preview(entry)}
        draggable onDragStart={event => tree.drag(event, entry.path, entry.directory)}
        {...tree.dropProps(entry.directory ? entry.path : folder.path)}>
        <Icon name="arrow" size={11} style={{ visibility: entry.directory ? 'visible' : 'hidden', transform: expanded ? 'rotate(90deg)' : undefined }} />
        <Icon name={entry.directory ? 'folder' : 'files'} size={15} /><span>{entry.name}</span>
        {changed && <i className="file-git-dot" aria-label="Has changes" />}
        {git && lines(git) && <small className="file-lines">{lines(git)}</small>}
        {!entry.directory && !git && <small>{entry.size < 1024 * 1024 ? `${Math.max(1, Math.round(entry.size / 1024))}k` : `${(entry.size / (1024 * 1024)).toFixed(1)}m`}</small>}
        {git && <b className={`file-git-mark ${git.status}`} aria-label={`Git: ${git.status}`}>{gitMark[git.status]}</b>}
      </button>
      {actions > 0 && <div className="file-actions">
        {entry.directory && <RowAction label={`Size map of ${entry.name}`} text="▦" onClick={() => void showMap(entry.path)} />}
        {entry.directory && <RevealFolder path={entry.path} name={entry.name} />}
        {!entry.directory && <RowAction label={`Diff of ${entry.name}`} text="±" onClick={() => void showDiff(entry.path)} />}
      </div>}
      </div>
      {entry.directory && expanded && <FolderBranch path={entry.path} depth={depth + 1} ancestors={[...ancestors, pathKey(folder.path)]} tree={tree} />}
    </div>
  })}{!entries.length && <p className="file-tree-note" style={{ paddingLeft: indent(depth) + 14 }}>{tree.query ? 'No matching files.' : 'Empty folder · drop files here'}</p>}
    {folder.truncated && <p className="file-tree-note">First 1,500 entries shown. Open {fileManager} for the complete folder.</p>}
  </div>
}

function treeKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'))
  const current = rows.indexOf(document.activeElement as HTMLButtonElement)
  if (current < 0) return
  event.preventDefault()
  const row = rows[current], expanded = row.getAttribute('aria-expanded')
  if (event.key === 'ArrowRight' && expanded === 'false') return row.click()
  if (event.key === 'ArrowLeft' && expanded === 'true' && current > 0) return row.click()
  let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : current + (event.key === 'ArrowUp' ? -1 : 1)
  if (event.key === 'ArrowLeft') {
    next = current - 1
    while (next > 0 && Number(rows[next].getAttribute('aria-level')) >= Number(row.getAttribute('aria-level'))) next--
  }
  rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus()
}

export default function FilesRail() {
  const { repo, selectedId, sessions } = useDesktop()
  const storageKey = `mrmak.files.${pathKey(repo)}`
  const [open, setOpen] = useState(() => localStorage.getItem(`${storageKey}.open`) === 'true')
  const [panel, setPanel] = useState<'files' | 'skills' | 'rules' | 'mcp' | 'settings'>('files')
  const [root, setRoot] = useState(repo)
  const [typedPath, setTypedPath] = useState(repo)
  const [rootFolder, setRootFolder] = useState<Folder | null>(null)
  const [mode, setMode] = useState<'main' | 'all'>('main')
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(`${storageKey}.expanded`) || '[]'); return new Set(Array.isArray(saved) ? saved.filter(item => typeof item === 'string') : []) } catch { return new Set() }
  })
  const [selected, setSelected] = useState(repo)
  const [destination, setDestination] = useState(repo)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [revision, setRevision] = useState(0)
  const [dropTarget, setDropTarget] = useState('')
  const [copying, setCopying] = useState(false)
  const copyLock = useRef(false)
  const internalDrag = useRef<{ path: string; directory: boolean; handled: boolean } | null>(null)
  const recycleLock = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  const [follow, setFollow] = useState(() => localStorage.getItem('mrmak.files.follow') !== 'false')
  const showsTree = open && (panel === 'files' || panel === 'skills')
  const git = useGitStatus(root, revision, showsTree)
  const chat = sessions.find(item => item.id === selectedId && item.agent !== 'shell') || null
  const agentFiles = useAgentFiles(chat?.id || null, showsTree)
  useFollow(agentFiles.latest, root, follow && showsTree, useCallback((folders: string[], file: string) => {
    setExpanded(current => new Set([...current, ...folders]))
    setSelected(file)
    // The folders load one by one; scroll once the file's row exists.
    let tries = 0
    const reveal = () => { const node = document.querySelector(`.file-list [data-path="${CSS.escape(file)}"]`); if (node) node.scrollIntoView({ block: 'nearest' }); else if (++tries < 30) window.setTimeout(reveal, 150) }
    reveal()
  }, []))
  const loaded = useCallback((folder: Folder) => setRootFolder(folder), [])
  useEffect(() => { localStorage.setItem(`${storageKey}.open`, String(open)) }, [storageKey, open])
  useEffect(() => { localStorage.setItem(`${storageKey}.expanded`, JSON.stringify([...expanded].slice(-300))) }, [storageKey, expanded])
  useEffect(() => {
    if (!open) return
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 10000)
    return () => { window.removeEventListener('focus', refresh); clearInterval(timer) }
  }, [open, refresh])
  useEffect(() => {
    const complete = (event: Event) => {
      const result = (event as CustomEvent<{ dropped: boolean; error?: string }>).detail
      if (result.error) setError(result.error)
      const gesture = internalDrag.current
      window.setTimeout(() => {
        if (internalDrag.current !== gesture) return
        if (!gesture?.handled) setStatus(result.dropped ? 'Path handed to the destination.' : '')
        internalDrag.current = null
      }, 150)
    }
    const recycled = (event: Event) => {
      const result = (event as CustomEvent<{ path: string; recycled: boolean; error?: string }>).detail
      recycleLock.current = false
      if (result.error) { setError(result.error); setStatus(''); return }
      setStatus(`${fileName(result.path)} moved to ${trashName}.`)
      const preview = desktopState().preview
      if (preview && (pathKey(preview.path) === pathKey(result.path) || pathKey(preview.path).startsWith(pathKey(result.path) + '/'))) setPreview(null)
      const parent = parentPath(result.path)
      setSelected(parent); setDestination(parent); refresh()
    }
    window.addEventListener('mrmak-native-drag-result', complete)
    window.addEventListener('mrmak-recycle-result', recycled)
    return () => { window.removeEventListener('mrmak-native-drag-result', complete); window.removeEventListener('mrmak-recycle-result', recycled) }
  }, [refresh])
  const navigate = (path: string) => { setRoot(path); setTypedPath(path); setSelected(path); setDestination(path); if (pathKey(path) !== pathKey(root)) setRootFolder(null); setQuery(''); setError('') }
  const showPanel = (next: 'files' | 'skills' | 'rules' | 'mcp' | 'settings') => {
    if (open && panel === next) { setOpen(false); return }
    if (next === 'skills') { setMode('all'); navigate(`${repo}/.claude/skills`) }
    if (next === 'files' && panel !== 'files') { setMode('main'); navigate(repo) }
    setPanel(next); setOpen(true)
  }
  const toggle = (path: string) => {
    setSelected(path); setDestination(path)
    setExpanded(current => { const next = new Set(current), key = pathKey(path); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  const copy = useCallback(async (files: File[], folder: string) => {
    if (copyLock.current || !files.length) return
    if (files.length > 100) { setError('Copy up to 100 files at a time.'); return }
    if (files.some(file => file.size > 1024 * 1024 * 1024)) { setError('Choose files of 1 GB or less.'); return }
    copyLock.current = true; setCopying(true); setError(''); setDropTarget('')
    let count = 0, renamed = 0
    try {
      for (const file of files) {
        setStatus(`Copying ${count + 1} of ${files.length} to ${fileName(folder)}…`)
        const result = await uploadFile(file, folder)
        count++; if (result.renamed) renamed++
      }
      setStatus(`Copied ${count} ${count === 1 ? 'file' : 'files'} to ${fileName(folder)}.${renamed ? ' Existing files kept; copies renamed.' : ''}`)
    } catch (error) { setError(message(error)); setStatus(count ? `Copied ${count} of ${files.length} files before the error.` : '') }
    finally {
      copyLock.current = false; setCopying(false); setSelected(folder); setDestination(folder)
      setExpanded(current => new Set([...current, pathKey(folder)])); refresh()
    }
  }, [refresh])
  const dropFiles = useCallback(async (event: DragEvent, folder: string) => {
    event.preventDefault(); event.stopPropagation(); setDropTarget('')
    const gesture = internalDrag.current
    if (gesture) {
      gesture.handled = true
      if (gesture.directory) { setStatus(''); setError(`Drop folders into Chats to insert their paths. Use ${fileManager} to move folders.`); return }
      if (copyLock.current) return
      copyLock.current = true; setCopying(true); setError('')
      try {
        const result = await api<{ path: string; moved: boolean }>('/files/move', { path: gesture.path, folder })
        setStatus(result.moved ? `Moved ${fileName(result.path)} to ${fileName(folder)}.` : '')
        if (result.moved) { setSelected(result.path); setDestination(folder); setExpanded(current => new Set([...current, pathKey(folder)])) }
      } catch (error) { setError(message(error)); setStatus('') }
      finally { copyLock.current = false; setCopying(false); refresh() }
      return
    }
    if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) { setError(`Drop individual files into a folder. Folder transfers are available in ${fileManager}.`); return }
    await copy(Array.from(event.dataTransfer.files), folder)
  }, [copy, refresh])
  const deleteKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // Mac keyboards have no forward Delete key; accept Finder's ⌘⌫ as well.
    if (event.key !== 'Delete' && !(isMac && event.metaKey && event.key === 'Backspace')) { treeKeys(event); return }
    event.preventDefault(); event.stopPropagation()
    const path = (event.target as HTMLElement).closest('[role="treeitem"]')?.getAttribute('data-path')
    if (event.repeat || !path || recycleLock.current || copyLock.current) return
    recycleLock.current = true; setError(''); setStatus(`Moving ${fileName(path)} to ${trashName}…`)
    api('/files/recycle', { path }).catch(error => { recycleLock.current = false; setError(message(error)); setStatus('') })
  }
  const dropProps = (folder: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = copyLock.current ? 'none' : 'copy'; setDropTarget(pathKey(folder))
    },
    onDragLeave: (event: DragEvent) => {
      event.stopPropagation()
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget('')
    },
    onDrop: (event: DragEvent) => {
      // eslint-disable-next-line react-hooks/refs -- This returned event handler runs on a user drop, never during render.
      void dropFiles(event, folder)
    },
  })
  const tree: TreeControls = {
    expanded, selected, dropTarget, query, revision, toggle, dropProps, git, touched: agentFiles.touched,
    preview: entry => { setSelected(entry.path); setDestination(parentPath(entry.path)); api<Preview>(`/preview?path=${encodeURIComponent(entry.path)}`).then(setPreview).catch(reportError) },
    drag: (event, path, directory) => {
      // Hand the held mouse gesture to the OS (Windows OLE / macOS drag session) with real file paths.
      event.preventDefault(); internalDrag.current = { path, directory, handled: false }; setError(''); setStatus(directory ? 'Drop into Chats to insert this folder path. Esc cancels.' : 'Drop into Chats to insert a path, or into another folder to move. Esc cancels.')
      api('/files/drag', { paths: [path] }).catch(error => { internalDrag.current = null; setError(message(error)); setStatus('') })
    },
  }
  return <aside className={`files-container ${open ? 'expanded' : ''}`}>
    {open && panel === 'settings' && <WorkspaceSettings onClose={() => setOpen(false)} />}
    {open && panel === 'mcp' && <McpPanel onClose={() => setOpen(false)} />}
    {open && panel === 'rules' && <RulesPanel onClose={() => setOpen(false)} />}
    {open && (panel === 'files' || panel === 'skills') && <div className="files-panel"><header><h2>{panel === 'skills' ? 'Skills' : 'Files'}</h2><div>
      <button className="desk-icon" disabled={copying} onClick={() => input.current?.click()} title={`Copy files into ${fileName(destination)}`} aria-label="Add files"><Icon name="plus" size={16} /></button>
      <button className={`desk-icon file-follow ${follow ? 'active' : ''}`} aria-pressed={follow} onClick={() => { setFollow(!follow); localStorage.setItem('mrmak.files.follow', String(!follow)) }} title={follow ? `Following ${chat?.name || 'the selected chat'}: its files open as it reads and writes them` : 'Follow the selected chat\'s agent'} aria-label="Follow the agent"><Icon name="eye" size={15} /></button>
      <button className="desk-icon" onClick={refresh} title="Refresh files"><Icon name="refresh" size={15} /></button><button className="desk-icon" onClick={() => setOpen(false)} title="Collapse files"><Icon name="close" size={17} /></button>
    </div></header>
      <input ref={input} type="file" multiple hidden onChange={event => { void copy(Array.from(event.target.files || []), destination); event.target.value = '' }} />
      {panel === 'files' ? <><div className="file-mode"><button className={mode === 'main' ? 'selected' : ''} onClick={() => { setMode('main'); navigate(repo) }}>Main folders</button><button className={mode === 'all' ? 'selected' : ''} onClick={() => setMode('all')}>All files</button></div>
      <div className="file-shortcuts">{['inbox', 'projects', 'workspace', 'knowledge', 'processes'].map(name => <button key={name} {...dropProps(`${repo}/${name}`)} className={dropTarget === pathKey(`${repo}/${name}`) ? 'drop-target' : ''} onClick={() => { navigate(repo); const path = `${repo}/${name}`; setExpanded(current => new Set([...current, pathKey(path)])); setSelected(path); setDestination(path) }}><Icon name="folder" size={14} />{name}</button>)}</div></> : <div className="skill-locations">{[['Claude', '.claude/skills'], ['Codex', '.agents/skills'], ['Knowledge', 'knowledge'], ['Processes', 'processes']].map(([label, path]) => <button key={path} aria-pressed={pathKey(root) === pathKey(`${repo}/${path}`)} onClick={() => { setMode('all'); navigate(`${repo}/${path}`) }}>{label}</button>)}<p>Project skills · open a SKILL.md to read or edit.</p></div>}
      <form className="file-path" onSubmit={event => { event.preventDefault(); setMode('all'); navigate(typedPath) }}><button type="button" title="Parent folder" onClick={() => { setMode('all'); navigate(rootFolder?.parent || repo) }}><Icon name="up" size={15} /></button><input value={typedPath} onChange={event => setTypedPath(event.target.value)} spellCheck={false} aria-label="Folder path" /><button type="submit" title="Open folder"><Icon name="arrow" size={14} /></button></form>
      {git.status?.branch && <p className="file-branch" title={git.status.repository || ''}><span>⎇ {git.status.branch.name}</span>{git.status.branch.upstream && <small>{git.status.branch.ahead ? `↑${git.status.branch.ahead} ` : ''}{git.status.branch.behind ? `↓${git.status.branch.behind} ` : ''}{!git.status.branch.ahead && !git.status.branch.behind ? 'up to date' : ''}</small>}<small>{git.status.files.length} changed</small>{chat && <small className="file-agent" title={chat.cwd}>{chat.name}</small>}</p>}
      <div className="file-filter"><Icon name="search" size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter file names…" aria-label="Filter file names in expanded folders" /></div>
      <div className={`file-list ${dropTarget === pathKey(destination) ? 'drop-area' : ''}`} role="tree" aria-label="Folder tree" onKeyDown={deleteKey} {...dropProps(destination)}>
        <div role="none" className="file-entry has-reveal" {...dropProps(root)}><button role="treeitem" aria-level={1} aria-expanded="true" aria-selected={pathKey(selected) === pathKey(root)} className={`file-row file-root-row ${dropTarget === pathKey(root) ? 'drop-target' : ''}`} onClick={() => { setSelected(root); setDestination(root) }} {...dropProps(root)} title={root}><Icon name="arrow" size={11} style={{ transform: 'rotate(90deg)' }} /><Icon name="folder" size={15} /><span>{pathKey(root) === pathKey(repo) ? 'MR-MAK' : fileName(root)}</span></button><RevealFolder path={root} name={pathKey(root) === pathKey(repo) ? 'MR-MAK' : fileName(root)} /></div>
        <FolderBranch key={`${root}:${mode}`} path={root} mode={mode} tree={tree} onLoad={loaded} />
      </div>
      <div className="file-transfer-status" aria-live="polite">{error && <p className="desk-error-inline">{error}</p>}{status && <p>{status}</p>}<small title={destination}>{copying ? 'Transferring files…' : `Drag to move · ${isMac ? '⌘⌫' : 'Delete'} to ${trashName}`}</small></div>
      <footer><button onClick={() => navigate(repo)}>MR-MAK root</button></footer>
    </div>}
    <div className="files-rail">{(['files', 'skills', 'rules', 'mcp', 'settings'] as const).map(name => <button key={name} className={`rail-tool ${open && panel === name ? 'active' : ''}`} onClick={() => showPanel(name)} title={name === 'mcp' ? 'MCP' : name[0].toUpperCase() + name.slice(1)} aria-label={`Toggle ${name}`} aria-pressed={open && panel === name}><Icon name={name === 'files' ? 'folder' : name} size={18} /><span>{name === 'mcp' ? 'MCP' : name}</span></button>)}<button className="rail-tool" title="Workspace help" aria-label="Open Workspace help" onClick={() => api<Preview>('/preview?path=workspace%2F_shared%2Fhelp.md').then(setPreview).catch(reportError)}><Icon name="help" size={18} /><span>Help</span></button><div className="rail-spacer" /><button className="desk-icon" title="Show Chats" onClick={() => windowAction('chats')}><Icon name="chats" size={18} /></button></div>
  </aside>
}
