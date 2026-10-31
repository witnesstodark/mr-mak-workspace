import { useEffect, useRef, type ComponentProps } from 'react'
import ReportFrame from './ReportFrame'
import { api, desktopState, isDesktop } from '../desktop/client'
import { createStudioBridge } from '../desktop/studioBridge'

type Props = ComponentProps<typeof ReportFrame>

// One bridge for the whole Workspace window, so a studio chat survives leaving
// and reopening the UI Studio.
let bridge: ReturnType<typeof createStudioBridge> | null = null
function studioBridge() {
  if (!bridge) bridge = createStudioBridge({
    api: (path, data, method) => api(path, data, method),
    repo: () => desktopState().repo,
    agents: () => desktopState().agents,
  })
  return bridge
}

// The Game UI Studio runs in the isolated report origin. Its Copilot requests
// are answered only for this frame and its origin (src/desktop/studioBridge.ts).
export default function UIStudioFrame(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const { url } = props
  useEffect(() => {
    if (!isDesktop) return
    const origin = new URL(url, location.href).origin
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow
      if (!target || event.source !== target || event.origin !== origin) return
      const data = event.data as { type?: unknown; id?: unknown; action?: unknown; payload?: unknown } | null
      if (!data || data.type !== 'mrmak:studio-request' || typeof data.id !== 'string') return
      const id = data.id
      studioBridge().handle(data.action, data.payload).then(
        value => target.postMessage({ type: 'mrmak:studio-response', id, ok: true, value }, origin),
        (error: unknown) => target.postMessage({ type: 'mrmak:studio-response', id, ok: false, error: error instanceof Error ? error.message : String(error) }, origin),
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [url])
  return <ReportFrame {...props} ref={frame} />
}
