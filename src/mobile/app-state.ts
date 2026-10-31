import { useSyncExternalStore } from 'react'

export type MobileView = 'list' | 'chat' | 'results'
interface Navigation { view: MobileView; history: boolean }
export interface ChatPosition { mode?: 'messages' | 'terminal'; top?: number; follow?: boolean; terminalLine?: number; terminalFollow?: boolean; terminalView?: TerminalView }
export type TerminalView = 'wrap' | 'fit' | 'actual'
const navigationKey = 'mrmak.mobile.navigation'
function read(key: string): unknown { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } }
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Keep in-memory navigation when storage is unavailable. */ } }
function initialNavigation(): Navigation {
  const value = read(navigationKey) as Partial<Navigation> | null
  if (value && ['list', 'chat', 'results'].includes(value.view || '') && typeof value.history === 'boolean') return { view: value.view!, history: value.history }
  return { view: localStorage.getItem('mrmak.mobile.selected') ? 'chat' : 'list', history: false }
}
let navigation = initialNavigation()
const listeners = new Set<() => void>()
function update(value: Partial<Navigation>) { navigation = { ...navigation, ...value }; save(navigationKey, navigation); listeners.forEach(listener => listener()); syncBack() }
export function useMobileNavigation() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => navigation) }
export function setMobileView(view: MobileView) { update({ view }) }
export function setMobileHistory(history: boolean) { update({ history }) }
export function resetMobileNavigation() { workspaceSelection = { id: null, step: 0 }; workspaceListeners.forEach(listener => listener()); navigation = { view: 'list', history: false }; listeners.forEach(listener => listener()); syncBack() }

// The phone's back gesture returns to the screen above the current one instead of leaving the app:
// a report to the Workspace list, the Workspace or a chat to the chat list, History to the open chats.
// While a screen has one, a close watcher takes the back request, as an open dialog does. A history
// entry would not work here: a report frame's own navigations sit in the same session history.
function previousScreen(): (() => void) | null {
  if (navigation.view === 'results' && workspaceSelection.id) return () => selectMobileWorkspace(null)
  if (navigation.view !== 'list') return () => update({ view: 'list' })
  if (navigation.history) return () => update({ history: false })
  return null
}
interface CloseWatcher { onclose: (() => void) | null; destroy(): void }
const CloseWatcher = (globalThis as unknown as { CloseWatcher?: new () => CloseWatcher }).CloseWatcher
let backInstalled = false, watcher: CloseWatcher | null = null
function syncBack() {
  if (!backInstalled || !CloseWatcher) return
  const deeper = !!previousScreen()
  if (deeper && !watcher) {
    const current = new CloseWatcher(); watcher = current
    current.onclose = () => { if (watcher === current) { watcher = null; mobileBack() } }
  } else if (!deeper && watcher) { watcher.destroy(); watcher = null }
}
/** Steps back one screen; an open report frame calls this for a back request that reached it. */
export function mobileBack() { previousScreen()?.(); syncBack() }
export function installMobileBack() {
  backInstalled = true; syncBack()
  return () => { backInstalled = false; watcher?.destroy(); watcher = null }
}
export function mobileChatPosition(id: string): ChatPosition {
  const value = read(`mrmak.mobile.position.${id}`) as ChatPosition | null
  if (!value || typeof value !== 'object') return {}
  return { mode: value.mode === 'terminal' || value.mode === 'messages' ? value.mode : undefined, top: Number.isFinite(value.top) && value.top! >= 0 ? value.top : undefined, follow: typeof value.follow === 'boolean' ? value.follow : undefined, terminalLine: Number.isInteger(value.terminalLine) && value.terminalLine! >= 0 ? value.terminalLine : undefined, terminalFollow: typeof value.terminalFollow === 'boolean' ? value.terminalFollow : undefined, terminalView: value.terminalView === 'wrap' || value.terminalView === 'fit' || value.terminalView === 'actual' ? value.terminalView : undefined }
}
export function saveMobileChatPosition(id: string, value: ChatPosition) { save(`mrmak.mobile.position.${id}`, { ...mobileChatPosition(id), ...value }) }

export interface WorkspaceSelection { id: string | null; step: number }
export interface ReportPosition { path?: string; hash?: string; top: number; left: number; scrollers?: { selector: string; top: number; left: number }[] }
const workspaceKey = 'mrmak.mobile.workspace'
function initialWorkspace(): WorkspaceSelection {
  const value = read(workspaceKey) as Partial<WorkspaceSelection> | null
  return { id: typeof value?.id === 'string' ? value.id : null, step: Number.isInteger(value?.step) && value!.step! >= 0 ? value!.step! : 0 }
}
let workspaceSelection = initialWorkspace()
const workspaceListeners = new Set<() => void>()
export function mobileWorkspaceSelection() { return workspaceSelection }
export function useMobileWorkspace() { return useSyncExternalStore(listener => { workspaceListeners.add(listener); return () => { workspaceListeners.delete(listener) } }, () => workspaceSelection) }
export function selectMobileWorkspace(id: string | null, step?: number) { const lastStep = id ? read(`mrmak.mobile.report-step.${id}`) : null; step = step ?? (typeof lastStep === 'number' && Number.isInteger(lastStep) && lastStep >= 0 ? lastStep : 0); if (id) save(`mrmak.mobile.report-step.${id}`, step); workspaceSelection = { id, step }; save(workspaceKey, workspaceSelection); workspaceListeners.forEach(listener => listener()); syncBack() }
// A tab's document is stable when tabs move; its numeric position and preview grant are not.
function reportEntry(url: string): string | null {
  try { return /^\/mobile\/view\/[^/]+\/(.+)$/.exec(new URL(url, location.origin).pathname)?.[1] || null } catch { return null }
}
function reportPositionKey(id: string, step: number, entryUrl?: string): string {
  const entry = entryUrl && reportEntry(entryUrl)
  return `mrmak.mobile.report.${id}.${entry ? `page.${encodeURIComponent(entry)}` : step}`
}
export function reportPosition(id: string, step: number, entryUrl?: string): ReportPosition {
  const value = validReportPosition(read(reportPositionKey(id, step, entryUrl)))
  if (value) return value
  const entry = entryUrl && reportEntry(entryUrl), prefix = `mrmak.mobile.report.${id}.`
  if (entry) {
    // Migrate only legacy routes whose owning entry page is known. An old inner
    // route has no ownership information and must not redirect a different tab.
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)
        if (!key?.startsWith(prefix) || !/^\d+$/.test(key.slice(prefix.length))) continue
        const legacy = validReportPosition(read(key))
        if (legacy?.path === entry) return legacy
      }
    } catch { /* Keep the report usable when storage is unavailable. */ }
    const legacy = validReportPosition(read(prefix + step))
    if (legacy && !legacy.path) return legacy
  }
  return { top: 0, left: 0 }
}
export function validReportPosition(value: unknown): ReportPosition | null {
  if (!value || typeof value !== 'object') return null
  const state = value as ReportPosition
  if (![state.top, state.left].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e7)) return null
  if (state.path !== undefined && (typeof state.path !== 'string' || state.path.length > 2000 || (/[?#\\]/.test(state.path) || Array.from(state.path).some(char => char.charCodeAt(0) < 32)) || state.path.startsWith('/') || state.path.split('/').some(part => part === '..' || part === '.'))) return null
  if (state.hash !== undefined && (typeof state.hash !== 'string' || state.hash.length > 1500 || state.hash && !state.hash.startsWith('#'))) return null
  const scrollers = Array.isArray(state.scrollers) ? state.scrollers.slice(0, 12).filter(item => item && typeof item.selector === 'string' && item.selector.length <= 500 && [item.top,item.left].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e7)) : undefined
  return { path: state.path, hash: state.hash, top: state.top, left: state.left, ...(scrollers ? { scrollers } : {}) }
}
export function saveReportPosition(id: string, step: number, value: ReportPosition, entryUrl?: string) { const valid = validReportPosition(value); if (valid) save(reportPositionKey(id, step, entryUrl), valid) }
