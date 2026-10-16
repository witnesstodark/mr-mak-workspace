import { useSyncExternalStore } from 'react'

export type MobileView = 'list' | 'chat' | 'results'
interface Navigation { view: MobileView; history: boolean }
export interface ChatPosition { mode?: 'messages' | 'terminal'; top?: number; follow?: boolean; terminalLine?: number; terminalFollow?: boolean; terminalFit?: boolean }
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
function update(value: Partial<Navigation>) { navigation = { ...navigation, ...value }; save(navigationKey, navigation); listeners.forEach(listener => listener()) }
export function useMobileNavigation() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => navigation) }
export function setMobileView(view: MobileView) { update({ view }) }
export function setMobileHistory(history: boolean) { update({ history }) }
export function resetMobileNavigation() { workspaceSelection = { id: null, step: 0 }; workspaceListeners.forEach(listener => listener()); navigation = { view: 'list', history: false }; listeners.forEach(listener => listener()) }
export function mobileChatPosition(id: string): ChatPosition {
  const value = read(`mrmak.mobile.position.${id}`) as ChatPosition | null
  if (!value || typeof value !== 'object') return {}
  return { mode: value.mode === 'terminal' || value.mode === 'messages' ? value.mode : undefined, top: Number.isFinite(value.top) && value.top! >= 0 ? value.top : undefined, follow: typeof value.follow === 'boolean' ? value.follow : undefined, terminalLine: Number.isInteger(value.terminalLine) && value.terminalLine! >= 0 ? value.terminalLine : undefined, terminalFollow: typeof value.terminalFollow === 'boolean' ? value.terminalFollow : undefined, terminalFit: typeof value.terminalFit === 'boolean' ? value.terminalFit : undefined }
}
export function saveMobileChatPosition(id: string, value: ChatPosition) { save(`mrmak.mobile.position.${id}`, { ...mobileChatPosition(id), ...value }) }

export interface WorkspaceSelection { id: string | null; step: number }
// `entry` is the page the tab opened with when this was saved: a position only comes back on that
// tab while it still opens that page, so a tab moved to another place on its card (or a position
// saved from another tab's page) doesn't open the wrong page.
export interface ReportPosition { path?: string; entry?: string; hash?: string; top: number; left: number; scrollers?: { selector: string; top: number; left: number }[] }
const workspaceKey = 'mrmak.mobile.workspace'
function initialWorkspace(): WorkspaceSelection {
  const value = read(workspaceKey) as Partial<WorkspaceSelection> | null
  return { id: typeof value?.id === 'string' ? value.id : null, step: Number.isInteger(value?.step) && value!.step! >= 0 ? value!.step! : 0 }
}
let workspaceSelection = initialWorkspace()
const workspaceListeners = new Set<() => void>()
export function mobileWorkspaceSelection() { return workspaceSelection }
export function useMobileWorkspace() { return useSyncExternalStore(listener => { workspaceListeners.add(listener); return () => { workspaceListeners.delete(listener) } }, () => workspaceSelection) }
export function selectMobileWorkspace(id: string | null, step?: number) { const lastStep = id ? read(`mrmak.mobile.report-step.${id}`) : null; step = step ?? (typeof lastStep === 'number' && Number.isInteger(lastStep) && lastStep >= 0 ? lastStep : 0); if (id) save(`mrmak.mobile.report-step.${id}`, step); workspaceSelection = { id, step }; save(workspaceKey, workspaceSelection); workspaceListeners.forEach(listener => listener()) }
export function reportPosition(id: string, step: number, entry?: string): ReportPosition {
  const value = validReportPosition(read(`mrmak.mobile.report.${id}.${step}`))
  if (!value || (entry !== undefined && value.entry !== entry)) return { top: 0, left: 0 }
  return value
}
export function validReportPosition(value: unknown): ReportPosition | null {
  if (!value || typeof value !== 'object') return null
  const state = value as ReportPosition
  if (![state.top, state.left].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e7)) return null
  if (state.path !== undefined && (typeof state.path !== 'string' || state.path.length > 2000 || (/[?#\\]/.test(state.path) || Array.from(state.path).some(char => char.charCodeAt(0) < 32)) || state.path.startsWith('/') || state.path.split('/').some(part => part === '..' || part === '.'))) return null
  if (state.entry !== undefined && (typeof state.entry !== 'string' || state.entry.length > 2000 || (/[?#\\]/.test(state.entry) || Array.from(state.entry).some(char => char.charCodeAt(0) < 32)) || state.entry.startsWith('/') || state.entry.split('/').some(part => part === '..' || part === '.'))) return null
  if (state.hash !== undefined && (typeof state.hash !== 'string' || state.hash.length > 1500 || state.hash && !state.hash.startsWith('#'))) return null
  const scrollers = Array.isArray(state.scrollers) ? state.scrollers.slice(0, 12).filter(item => item && typeof item.selector === 'string' && item.selector.length <= 500 && [item.top,item.left].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e7)) : undefined
  return { path: state.path, entry: state.entry, hash: state.hash, top: state.top, left: state.left, ...(scrollers ? { scrollers } : {}) }
}
export function saveReportPosition(id: string, step: number, value: ReportPosition) { const valid = validReportPosition(value); if (valid) save(`mrmak.mobile.report.${id}.${step}`, valid) }
