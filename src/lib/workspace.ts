import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceEntity, WorkspaceState } from '../types'
import { api, isDesktop } from '../desktop/client'

const POLL_MS = 30_000
const ARCHIVE_DAYS = 7

export type EntityPatch = Partial<Pick<WorkspaceEntity, 'status' | 'category' | 'pinned'>>

export async function updateWorkspaceEntity(id: string, patch: EntityPatch) {
  const route = `/workspace/entities/${encodeURIComponent(id)}`
  if (!isDesktop) throw new Error('Open the desktop app to edit Workspace cards.')
  await api(route, patch, 'PATCH')
  window.dispatchEvent(new Event('mrmak-workspace-changed'))
}

export function archiveCutoff(): string {
  const d = new Date()
  d.setDate(d.getDate() - ARCHIVE_DAYS)
  return d.toISOString().slice(0, 10)
}

/**
 * Loads workspace.json and keeps it fresh: refetch on window focus /
 * visibility and a light poll while the tab is visible. State only
 * changes when the file content actually changed, so re-renders are
 * cheap. A failed fetch (or a mid-write half-file from an agent)
 * flips `offline` and keeps the last good data.
 */
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [offline, setOffline] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const rawRef = useRef('')

  const reload = useCallback(async () => {
    try {
      const res = isDesktop ? null : await fetch('/workspace/workspace.json', { cache: 'no-store' })
      if (res && !res.ok) throw new Error(`HTTP ${res.status}`)
      const text = res ? await res.text() : JSON.stringify(await api<WorkspaceState>('/workspace'))
      if (text !== rawRef.current) {
        const parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as WorkspaceState
        rawRef.current = text
        setWorkspace(parsed)
      }
      setOffline(false)
      setLastSync(new Date())
    } catch {
      setOffline(true)
      setWorkspace(w => w ?? { entities: [] })
    }
  }, [])

  useEffect(() => {
    // Initial fetch — every setState inside reload happens after an await,
    // never synchronously, so cascading-render concerns don't apply here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
    const refresh = () => {
      if (document.visibilityState === 'visible') reload()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('mrmak-workspace-changed', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, POLL_MS)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('mrmak-workspace-changed', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(timer)
    }
  }, [reload])

  return { workspace, offline, lastSync, reload }
}
