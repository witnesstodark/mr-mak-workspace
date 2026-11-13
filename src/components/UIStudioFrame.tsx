import { useEffect, useRef, useState } from 'react'
import ReportFrame from './ReportFrame'
import ConfirmLayer from './ConfirmSend'
import { createConfirmQueue, type ConfirmView } from '../lib/confirm-queue'
import { api, desktopState, isDesktop } from '../desktop/client'
import { createStudioBridge, type StudioConfirmation } from '../desktop/studioBridge'
import './ui-studio.css'

// Requests waiting for the owner, shown one at a time in the Workspace window.
// The studio waits up to ten minutes for a confirmation (agent-link.mjs).
const queue = createConfirmQueue({ max: 3, timeoutMs: 9 * 60 * 1000 })

const HEADINGS: Record<StudioConfirmation['kind'], string> = {
  start: 'Start a studio chat',
  send: 'Send to the studio chat',
  answer: 'Answer the chat’s menu',
}

// What the owner reads before a studio request reaches a chat.
function studioView(request: StudioConfirmation): ConfirmView {
  const text = request.kind === 'answer' ? null : request.text
  const asked = request.kind === 'start' ? (text ? 'start this chat and send it the message below' : 'start this chat') : request.kind === 'send' ? 'send the message below to this chat' : 'answer this chat’s menu'
  const action = request.kind === 'answer' ? 'Answer' : 'Send'
  return {
    title: HEADINGS[request.kind],
    lead: `The Game UI Studio asks to ${asked}. Nothing reaches the chat unless you choose ${action}.`,
    facts: [
      { label: 'Chat', value: request.chat },
      { label: 'Agent', value: `${request.agent}${request.kind === 'start' ? ` · ${request.effort} effort · permissions not bypassed` : ''}` },
      { label: 'Folder', value: request.folder },
    ],
    details: request.kind === 'answer' ? [{ label: 'Menu', value: request.question || '(no question)' }, { label: 'Answer', value: request.answer, strong: true }] : undefined,
    text,
    action,
  }
}

// One bridge for the whole Workspace window, so a studio chat survives leaving
// and reopening the UI Studio.
let bridge: ReturnType<typeof createStudioBridge> | null = null
function studioBridge() {
  if (!bridge) bridge = createStudioBridge({
    api: (path, data, method) => api(path, data, method),
    repo: () => desktopState().repo,
    agents: () => desktopState().agents,
    confirm: request => queue.confirm(studioView(request)),
  })
  return bridge
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

  useEffect(() => {
    if (!isDesktop) return
    let live = true
    api<Site>('/ui-studio/open', {}).then(value => { if (live) setSite(value) }, (reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!site) return
    // Leaving the studio cancels what it was waiting to send.
    const detach = queue.attach()
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
      detach()
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
      <ConfirmLayer queue={queue} />
    </div>
  )
}
