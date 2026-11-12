import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import ReportFrame from './ReportFrame'
import { api, desktopState, isDesktop } from '../desktop/client'
import { createStudioBridge, type StudioConfirmation } from '../desktop/studioBridge'
import './ui-studio.css'

// Requests waiting for the owner, shown one at a time in the Workspace window.
interface Pending { id: number; request: StudioConfirmation; resolve: (value: boolean) => void }
const MAX_PENDING = 3
// The studio waits up to ten minutes for a confirmation (agent-link.mjs).
const PENDING_MS = 9 * 60 * 1000
let pending: Pending[] = []
let mounted = 0
let nextId = 0
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(listener => listener())
function settle(id: number, value: boolean) {
  const item = pending.find(entry => entry.id === id)
  if (!item) return
  pending = pending.filter(entry => entry !== item)
  item.resolve(value)
  changed()
}
function confirm(request: StudioConfirmation): Promise<boolean> {
  // Nothing is sent while the studio is closed or when requests pile up.
  if (!mounted || pending.length >= MAX_PENDING) return Promise.resolve(false)
  return new Promise(resolve => {
    const id = ++nextId
    pending = [...pending, { id, request, resolve }]
    setTimeout(() => settle(id, false), PENDING_MS)
    changed()
  })
}
const usePending = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => pending)

// One bridge for the whole Workspace window, so a studio chat survives leaving
// and reopening the UI Studio.
let bridge: ReturnType<typeof createStudioBridge> | null = null
function studioBridge() {
  if (!bridge) bridge = createStudioBridge({
    api: (path, data, method) => api(path, data, method),
    repo: () => desktopState().repo,
    agents: () => desktopState().agents,
    confirm,
  })
  return bridge
}

const HEADINGS: Record<StudioConfirmation['kind'], string> = {
  start: 'Start a studio chat',
  send: 'Send to the studio chat',
  answer: 'Answer the chat’s menu',
}

// Drawn by the Workspace window, outside the studio frame, which cannot draw
// over it or press its buttons. Send is armed after a short pause so a click
// meant for the studio cannot land on it.
function Confirmation({ item }: { item: Pending }) {
  const { request } = item
  const [armed, setArmed] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.focus()
    const timer = setTimeout(() => setArmed(true), 600)
    return () => clearTimeout(timer)
  }, [])
  const text = request.kind === 'answer' ? null : request.text
  return (
    <div className="studio-confirm-layer">
      <div
        ref={box}
        className="studio-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-confirm-title"
        tabIndex={-1}
        onKeyDown={event => { if (event.key === 'Escape') settle(item.id, false) }}
      >
        <h2 id="studio-confirm-title">{HEADINGS[request.kind]}</h2>
        <p className="studio-confirm-lead">The Game UI Studio asks to {request.kind === 'start' ? (text ? 'start this chat and send it the message below' : 'start this chat') : request.kind === 'send' ? 'send the message below to this chat' : 'answer this chat’s menu'}. Nothing reaches the chat unless you choose {request.kind === 'answer' ? 'Answer' : 'Send'}.</p>
        <dl className="studio-confirm-facts">
          <dt>Chat</dt><dd>{request.chat}</dd>
          <dt>Agent</dt><dd>{request.agent}{request.kind === 'start' ? ` · ${request.effort} effort · permissions not bypassed` : ''}</dd>
          <dt>Folder</dt><dd>{request.folder}</dd>
        </dl>
        {request.kind === 'answer' ? (
          <dl className="studio-confirm-facts">
            <dt>Menu</dt><dd>{request.question || '(no question)'}</dd>
            <dt>Answer</dt><dd className="studio-confirm-answer">{request.answer}</dd>
          </dl>
        ) : text !== null && (
          <>
            <div className="studio-confirm-size">Message: {text.length.toLocaleString()} characters</div>
            <pre className="studio-confirm-text" aria-label="Message to send" tabIndex={0}>{text}</pre>
          </>
        )}
        <div className="studio-confirm-actions">
          <button type="button" onClick={() => settle(item.id, false)}>Cancel</button>
          <button type="button" className="primary" disabled={!armed} onClick={() => settle(item.id, true)}>{request.kind === 'answer' ? 'Answer' : 'Send'}</button>
        </div>
      </div>
    </div>
  )
}

interface Site { url: string; origin: string }

// The Game UI Studio ships with the app and runs on an isolated port of its
// own. The service names that page's final address and origin first, so the
// frame loads it directly and its messages are answered only from that frame
// and origin (src/desktop/studioBridge.ts). After navigating anywhere else, the
// frame gets no replies.
export default function UIStudioFrame() {
  const frame = useRef<HTMLIFrameElement>(null)
  const [site, setSite] = useState<Site | null>(null)
  const [error, setError] = useState('')
  const queue = usePending()

  useEffect(() => {
    if (!isDesktop) return
    let live = true
    api<Site>('/ui-studio/open', {}).then(value => { if (live) setSite(value) }, (reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!site) return
    mounted++
    const { origin } = site
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow
      if (!target || event.source !== target || event.origin !== origin) return
      const data = event.data as { type?: unknown; id?: unknown; action?: unknown; payload?: unknown } | null
      if (!data || data.type !== 'mrmak:studio-request' || typeof data.id !== 'string' || data.id.length > 100) return
      const id = data.id
      // The target origin keeps a reply from reaching a page the frame navigated to meanwhile.
      studioBridge().handle(data.action, data.payload).then(
        value => target.postMessage({ type: 'mrmak:studio-response', id, ok: true, value }, origin),
        (reason: unknown) => target.postMessage({ type: 'mrmak:studio-response', id, ok: false, error: reason instanceof Error ? reason.message : String(reason) }, origin),
      )
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      mounted--
      // Leaving the studio cancels what it was waiting to send.
      if (!mounted) for (const item of [...pending]) settle(item.id, false)
    }
  }, [site])

  if (!isDesktop) return <div className="studio-unavailable">The Game UI Studio runs in the Mr. Mak desktop app.</div>
  if (error) return <div className="studio-unavailable" role="alert">The Game UI Studio could not open: {error}</div>
  if (!site) return <div className="report-loading">Opening the Game UI Studio…</div>
  return (
    <div className="studio-host">
      <ReportFrame
        url={site.url}
        ref={frame}
        title="Game UI Studio"
        className="report-frame loaded"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
      />
      {queue[0] && <Confirmation key={queue[0].id} item={queue[0]} />}
    </div>
  )
}
