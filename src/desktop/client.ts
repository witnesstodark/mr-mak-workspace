import { useSyncExternalStore } from 'react'
import type { DesktopState, Preview, ServiceEvent } from './types'

const params = new URLSearchParams(window.location.search)
export const isDesktop = params.get('desktop') === '1'
export const surface = params.get('surface') === 'chats' ? 'chats' : 'workspace'
export const clientId = crypto.randomUUID()
let token = params.get('token') || sessionStorage.getItem('mrmak.token') || ''
if (isDesktop && token) {
  sessionStorage.setItem('mrmak.token', token)
  params.delete('token')
  history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`)
}
const listeners = new Set<() => void>()
const events = new Set<(event: ServiceEvent) => void>()
let state: DesktopState = {
  liveSources: [],
  ready: false, connected: false, error: null, repo: '', contentBase: '', agents: [], sessions: [], selectedId: null, notices: [],
  settings: { defaultAgent: 'codex', defaultBypass: false }, coordinator: 'idle', voice: { configured: false, owner: null }, operations: [], preview: null, voiceHistory: [],
}
let socket: WebSocket | null = null
let started = false
let reconnectTimer = 0
const update = (values: Partial<DesktopState>) => { state = { ...state, ...values }; listeners.forEach(listener => listener()) }
export const desktopState = () => state
export const useDesktop = () => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, desktopState)
export const onServiceEvent = (listener: (event: ServiceEvent) => void) => { events.add(listener); return () => { events.delete(listener) } }
export const setPreview = (preview: Preview | null) => update({ preview })
export const dismissError = () => update({ error: null })
export const reportError = (error: unknown) => update({ error: error instanceof Error ? error.message : String(error) })
export const contentUrl = (relative: string) => isDesktop ? `${state.contentBase}${relative}` : relative

export async function api<T>(path: string, data?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method || (data === undefined ? 'GET' : 'POST'),
    headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`)
  return value as T
}
export function pickFiles(): Promise<string[]> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const cleanup = () => { window.removeEventListener('mrmak-picked-files', picked); window.removeEventListener('pagehide', closed) }
    const picked = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId: string; paths: string[] }>).detail
      if (detail?.requestId !== requestId) return
      cleanup(); resolve(detail.paths)
    }
    const closed = () => { cleanup(); reject(new Error('The file picker window was closed.')) }
    window.addEventListener('mrmak-picked-files', picked)
    window.addEventListener('pagehide', closed)
    api('/files/pick', { requestId }).catch(error => { cleanup(); reject(error) })
  })
}
export async function uploadImage(file: File): Promise<{ path: string; name: string }> {
  const response = await fetch('/api/attachments', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'Screenshot.png') }, body: file })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'Image could not be saved')
  return value
}
export async function uploadFile(file: File, folder: string): Promise<{ path: string; name: string; renamed: boolean }> {
  const response = await fetch(`/api/files/import?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: file,
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'File could not be copied')
  return value
}
export function sendEvent(value: unknown) {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(value)); return true
}
export function selectChat(id: string) {
  update({ selectedId: id }); sendEvent({ type: 'selected', id })
  localStorage.setItem('mrmak.selectedChat', id)
}
export const windowAction = (window: 'workspace' | 'chats', action = 'show', value?: boolean) => api('/window', { window, action, value }).catch(reportError)

export async function startDesktop() {
  if (started) return
  started = true
  try {
    const initial = await api<DesktopState>('/bootstrap')
    const selected = localStorage.getItem('mrmak.selectedChat')
    if (surface === 'workspace' && !location.hash && initial.settings.workspaceRoute?.startsWith('#/')) history.replaceState(null, '', location.pathname + location.search + initial.settings.workspaceRoute)
    update({ ...initial, ready: true, error: null, selectedId: initial.sessions.some(item => item.id === selected) ? selected : initial.selectedId })
    connect()
  } catch (error) { started = false; reportError(error) }
}
function connect() {
  socket = new WebSocket(`${location.origin.replace('http:', 'ws:')}/events`)
  socket.onopen = () => socket?.send(JSON.stringify({ type: 'auth', token, clientId, surface }))
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data) as ServiceEvent
    if (event.type === 'connected') update({ connected: true, sessions: event.sessions || state.sessions, selectedId: event.selectedId ?? state.selectedId, coordinator: event.state || state.coordinator, error: null })
    if (event.type === 'connected' && event.liveSources) update({ liveSources: event.liveSources })
    if (event.type === 'live-source' && event.source) {
      const source = event.source
      update({ liveSources: state.liveSources.some(item => item.id === source.id) ? state.liveSources.map(item => item.id === source.id ? source : item) : [...state.liveSources, source] })
    }
    if (event.type === 'selection') update({ selectedId: event.selectedId || null })
    if (event.type === 'session' && event.session) {
      const next = event.session
      update({ sessions: state.sessions.some(item => item.id === next.id) ? state.sessions.map(item => item.id === next.id ? next : item) : [...state.sessions, next] })
    }
    if (event.type === 'removed') {
      const sessions = state.sessions.filter(item => item.id !== event.id)
      update({ sessions, selectedId: state.selectedId === event.id ? sessions[0]?.id || null : state.selectedId })
    }
    if (event.type === 'service-error') reportError(event.error || 'Connection error')
    if (event.type === 'coordinator-state') update({ coordinator: event.state || 'idle' })
    if (event.type === 'coordinator-result' && event.operation) {
      const operation = event.operation
      update({ operations: [...state.operations.filter(item => item.id !== operation.id), operation].slice(-50) })
    }
    if (event.type === 'settings' && event.settings) update({ settings: event.settings })
    if (event.type === 'notice' && event.notice) update({ notices: [...state.notices, event.notice].slice(-100) })
    if (event.type === 'voice-owner') update({ voice: { ...state.voice, owner: event.owner || null } })
    if (event.type === 'navigate') {
      if (event.sessionId) selectChat(event.sessionId)
      if (surface === 'workspace' && event.window === 'workspace') {
        if (event.route !== undefined) { setPreview(null); location.hash = event.route || '' }
        if (event.preview) setPreview(event.preview)
      }
    }
    if (event.type === 'workspace-changed') window.dispatchEvent(new Event('mrmak-workspace-changed'))
    events.forEach(listener => listener(event))
  }
  socket.onclose = () => {
    update({ connected: false })
    clearTimeout(reconnectTimer)
    reconnectTimer = window.setTimeout(connect, 1500)
    events.forEach(listener => listener({ type: 'disconnected' }))
  }
  socket.onerror = () => socket?.close()
}

// Exposing a capability through a DOM attribute would give report pages access to it.
// It lives only in this UI origin, which is separate from the report server.
window.addEventListener('pagehide', () => { token = ''; socket?.close(); clearTimeout(reconnectTimer) })
