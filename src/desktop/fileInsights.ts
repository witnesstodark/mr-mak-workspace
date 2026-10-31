import { useEffect, useMemo, useRef, useState } from 'react'
import { api, reportError, setPreview } from './client'
import type { FolderMapData } from './types'
import { isMac } from './platform'

// The Files tab's Git state and the selected chat's file activity.
export type GitState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'
export interface GitFile { path: string; status: GitState; staged: boolean; added?: number | null; removed?: number | null }
export interface GitStatus { repository: string | null; branch: { name: string; upstream: string | null; ahead: number; behind: number } | null; files: GitFile[] }
export interface AgentFile { path: string; kind: 'read' | 'write'; at: string }

export const pathKey = (path: string) => (isMac ? path : path.replace(/\\/g, '/')).replace(/\/$/, '').toLowerCase()
const ancestors = (key: string, stop: string) => {
  const list: string[] = []
  for (let at = key.lastIndexOf('/'); at > 0; at = key.lastIndexOf('/', at - 1)) { const folder = key.slice(0, at); if (folder.length < stop.length) break; list.push(folder) }
  return list
}

export const gitMark: Record<GitState, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' }

export function useGitStatus(root: string, revision: number, enabled: boolean) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    api<GitStatus>(`/files/git?path=${encodeURIComponent(root)}`).then(value => { if (!stopped) setStatus(value) }).catch(() => { if (!stopped) setStatus(null) })
    return () => { stopped = true }
  }, [root, revision, enabled])
  return useMemo(() => {
    const files = new Map<string, GitFile>(), folders = new Set<string>(), untrackedFolders: string[] = []
    const top = status?.repository ? pathKey(status.repository) : ''
    for (const file of status?.files || []) {
      const key = pathKey(file.path)
      // An untracked folder comes as one entry ending with a separator.
      if (file.status === 'untracked' && /[\\/]$/.test(file.path)) untrackedFolders.push(key)
      files.set(key, file)
      for (const folder of ancestors(key, top)) folders.add(folder)
    }
    const lookup = (path: string): GitFile | undefined => {
      const key = pathKey(path), own = files.get(key)
      if (own) return own
      const folder = untrackedFolders.find(item => key.startsWith(`${item}/`))
      return folder ? { path, status: 'untracked', staged: false } : undefined
    }
    return { status, lookup, changedFolder: (path: string) => { const key = pathKey(path); return folders.has(key) || untrackedFolders.some(item => key === item || key.startsWith(`${item}/`)) } }
  }, [status])
}

// The selected chat's reads and writes. `latest` is the newest event, for following it.
export function useAgentFiles(chatId: string | null, enabled: boolean) {
  const [read, setRead] = useState<{ chatId: string; files: AgentFile[]; at: number } | null>(null)
  useEffect(() => {
    if (!chatId || !enabled) return
    let stopped = false
    const load = () => { if (document.visibilityState !== 'hidden') api<{ files: AgentFile[] }>(`/files/activity?id=${encodeURIComponent(chatId)}`).then(value => { if (!stopped) setRead({ chatId, files: value.files, at: Date.now() }) }).catch(() => {}) }
    load()
    const timer = window.setInterval(load, 3000)
    return () => { stopped = true; clearInterval(timer) }
  }, [chatId, enabled])
  const files = useMemo(() => read && read.chatId === chatId && enabled ? read.files : [], [read, chatId, enabled]), now = read?.at || 0
  return useMemo(() => {
    // Recent activity glows; anything older in this conversation keeps a quiet mark.
    const touched = new Map<string, { kind: 'read' | 'write'; recent: boolean }>()
    for (const file of files) {
      const key = pathKey(file.path), recent = now - Date.parse(file.at) < 120000, previous = touched.get(key)
      touched.set(key, { kind: previous?.kind === 'write' || file.kind === 'write' ? 'write' : 'read', recent: recent || !!previous?.recent })
    }
    return { touched, latest: files[files.length - 1] || null }
  }, [files, now])
}

// Opens the folders between the root and the newest file the agent touched, once per event.
export function useFollow(latest: AgentFile | null, root: string, follow: boolean, open: (folders: string[], file: string) => void) {
  const seen = useRef('')
  useEffect(() => {
    if (!latest || !follow) return
    const id = `${latest.path}|${latest.at}`
    if (seen.current === id) return
    const first = !seen.current
    seen.current = id
    const key = pathKey(latest.path), top = pathKey(root)
    // The first read only records where the agent is; it follows what happens next.
    if (first || !key.startsWith(`${top}/`)) return
    open(ancestors(key, top).filter(item => item.length > top.length), latest.path)
  }, [latest, root, follow, open])
}

export const showDiff = (path: string) => api<{ path: string; name: string; text: string; truncated?: boolean }>(`/files/diff?path=${encodeURIComponent(path)}`)
  .then(value => setPreview({ path: value.path, name: `${value.name} · diff`, size: value.text.length, kind: 'diff', text: value.text || 'No changes against the last commit.' })).catch(reportError)
export const showMap = (path: string) => api<FolderMapData>(`/files/map?path=${encodeURIComponent(path)}`)
  .then(value => setPreview({ path: value.path, name: `${value.name} · size map`, size: value.size, kind: 'map', map: value })).catch(reportError)


export interface MapBox { item: FolderMapData['children'][number]; x: number; y: number; w: number; h: number }
// Squarified treemap: rows laid along the shorter side keep the boxes close to square.
export function squarify(items: FolderMapData['children'], width: number, height: number): MapBox[] {
  const total = items.reduce((sum, item) => sum + item.size, 0)
  const boxes: MapBox[] = []
  if (!total || width <= 0 || height <= 0) return boxes
  const scale = (width * height) / total
  let rest = items.filter(item => item.size > 0), x = 0, y = 0, w = width, h = height
  const worst = (row: typeof rest, side: number) => {
    const areas = row.map(item => item.size * scale), sum = areas.reduce((a, b) => a + b, 0)
    return Math.max(...areas.map(area => Math.max((side * side * area) / (sum * sum), (sum * sum) / (side * side * area))))
  }
  while (rest.length) {
    const side = Math.min(w, h)
    let row = [rest[0]]
    for (let i = 1; i < rest.length && worst([...row, rest[i]], side) <= worst(row, side); i++) row = [...row, rest[i]]
    const sum = row.reduce((a, item) => a + item.size * scale, 0), thick = sum / side
    let offset = 0
    for (const item of row) {
      const length = (item.size * scale) / thick
      boxes.push(w >= h ? { item, x, y: y + offset, w: thick, h: length } : { item, x: x + offset, y, w: length, h: thick })
      offset += length
    }
    if (w >= h) { x += thick; w -= thick } else { y += thick; h -= thick }
    rest = rest.slice(row.length)
  }
  return boxes
}

