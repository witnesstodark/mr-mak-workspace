import { useSyncExternalStore } from 'react'
import type { AgentInfo, ChatSession } from '../desktop/types'
import { clearVoiceDrafts, type VoiceDraft } from './voice-drafts'

export interface DictationInfo { available: boolean; provider: string | null; providers?: { id: string; label: string; available: boolean; detail: string }[]; maxSeconds: number; maxBytes: number }

interface MobileState {
  ready: boolean; authenticated: boolean; connected: boolean; error: string
  sessions: ChatSession[]; agents: AgentInfo[]; selectedId: string | null
  device?: { id: string; name: string }; defaultAgent?: string; defaultBypass?: boolean
  dictation?: DictationInfo
}
export interface MobileEvent { type: string; id?: string; session?: ChatSession; sessions?: ChatSession[]; data?: string; sequence?: number; error?: string; dictation?: DictationInfo }
let state: MobileState = { ready: false, authenticated: false, connected: false, error: '', sessions: [], agents: [], selectedId: localStorage.getItem('mrmak.mobile.selected') }
const listeners = new Set<() => void>(), events = new Set<(event: MobileEvent) => void>()
let socket: WebSocket | null = null, timer = 0, heartbeat = 0, starting = false, stopped = false
const update = (value: Partial<MobileState>) => { state = { ...state, ...value }; listeners.forEach(listener => listener()) }
export function useMobile() { return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => state) }
export class MobileError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }
export async function mobileApi<T = unknown>(route: string, data?: unknown): Promise<T> {
  const response = await fetch(`/mobile/api${route}`, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(25000) })
  const result = await response.json()
  if (!response.ok) {
    if (response.status === 401) { update({ authenticated: false, connected: false }); socket?.close() }
    throw new MobileError(result.error || 'Could not connect to your computer.', response.status)
  }
  return result
}
export async function uploadMobileImage(file: File): Promise<{ id: string; name: string }> {
  const response = await fetch('/mobile/api/images', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file, signal: AbortSignal.timeout(60000) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Image upload failed.')
  return result
}
export async function transcribeMobileAudio(recording: VoiceDraft, signal: AbortSignal): Promise<{ text: string }> {
  const response = await fetch('/mobile/api/transcribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': recording.audio.type, 'X-Transcription-Id': recording.id }, body: recording.audio, signal: AbortSignal.any([signal, AbortSignal.timeout(270000)]) })
  const result = await response.json()
  if (!response.ok) throw new MobileError(result.error || 'Could not transcribe this recording. Try again.', response.status)
  return result
}
export function selectMobileChat(id: string) { localStorage.setItem('mrmak.mobile.selected', id); update({ selectedId: id }) }
export function onMobileEvent(listener: (event: MobileEvent) => void) { events.add(listener); return () => { events.delete(listener) } }
export function mobileEvent(event: Record<string, unknown>) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)) }
let lastReply = 0, lastPing = 0
function recoverSocket(ws: WebSocket) {
  if (socket !== ws) return
  socket = null; clearInterval(heartbeat)
  update({ connected: false, error: 'Connection stalled. Reconnecting…' })
  events.forEach(listener => listener({ type: 'disconnected' }))
  ws.close(); reconnect()
}
function reconnect() { clearTimeout(timer); if (!stopped && document.visibilityState !== 'hidden') timer = window.setTimeout(() => void startMobile(), 2500) }
export async function startMobile() {
  if (starting || stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  starting = true
  try {
    const initial = await mobileApi<Pick<MobileState, 'sessions' | 'agents' | 'device' | 'defaultAgent' | 'defaultBypass' | 'dictation'>>('/bootstrap')
    update({ ...initial, ready: true, authenticated: true, error: '', selectedId: initial.sessions.some(item => item.id === state.selectedId) ? state.selectedId : initial.sessions.find(item => item.open)?.id || initial.sessions[0]?.id || null })
    const url = new URL('/mobile/events', location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(url); socket = ws; lastReply = Date.now(); lastPing = 0
    ws.onmessage = message => {
      if (socket !== ws) return
      let event: MobileEvent
      try { event = JSON.parse(message.data) } catch { return }
      lastReply = Date.now()
      if (event.type === 'connected') update({ connected: true, sessions: event.sessions || state.sessions, error: '' })
      if (event.type === 'session' && event.session) { const next = event.session; update({ sessions: state.sessions.some(item => item.id === next.id) ? state.sessions.map(item => item.id === next.id ? next : item) : [...state.sessions, next] }) }
      if (event.type === 'dictation' && event.dictation) update({ dictation: event.dictation })
      if (event.type === 'error') update({ error: event.error || 'Connection error' })
      events.forEach(listener => listener(event))
    }
    ws.onclose = () => { if (socket !== ws) return; socket = null; clearInterval(heartbeat); update({ connected: false }); events.forEach(listener => listener({ type: 'disconnected' })); reconnect() }
    ws.onerror = () => ws.close()
    clearInterval(heartbeat); heartbeat = window.setInterval(() => {
      if (socket !== ws || document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastReply >= 45000) { recoverSocket(ws); return }
      if (ws.readyState === WebSocket.OPEN && now - lastPing >= 15000) { lastPing = now; mobileEvent({ type: 'ping' }) }
    }, 5000)
  } catch (error) {
    update({ ready: true, connected: false, error: error instanceof MobileError && error.status === 401 ? '' : 'Your computer is unavailable. Keep Mr. Mak running and Tailscale connected.' })
    if (!(error instanceof MobileError && error.status === 401)) reconnect()
  } finally { starting = false }
}
export async function disconnectMobile() {
  await mobileApi('/disconnect', {}); stopped = true; clearTimeout(timer); clearInterval(heartbeat); socket?.close(); socket = null
  for (const key of Object.keys(localStorage)) if (key.startsWith('mrmak.mobile.')) localStorage.removeItem(key)
  sessionStorage.removeItem('mrmak.mobile.pair'); sessionStorage.removeItem('mrmak.mobile.pending')
  await clearVoiceDrafts().catch(() => {})
  update({ authenticated: false, connected: false, sessions: [], selectedId: null }); stopped = false
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void startMobile(); else { clearTimeout(timer); socket?.close() } })
window.addEventListener('online', () => void startMobile())
window.addEventListener('offline', () => socket?.close())
window.addEventListener('pagehide', () => { clearTimeout(timer); socket?.close() })
window.addEventListener('pageshow', () => { if (state.ready && state.authenticated) void startMobile() })

export async function chooseMobileDictation(provider: string) { const dictation = await mobileApi<DictationInfo>('/dictation', { provider }); update({ dictation }); return dictation }
