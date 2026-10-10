import { useCallback, useEffect, useRef, useState, type IframeHTMLAttributes } from 'react'
import { useWorkspaceTheme } from '../lib/workspace-theme'
import { reportThemeCSS } from '../../desktop/service/report-theme.mjs'
import { onServiceEvent, useDesktop } from '../desktop/client'

type Props = Omit<IframeHTMLAttributes<HTMLIFrameElement>, 'src' | 'onLoad'> & { url: string; source?: string; onLoad?: () => void }

function ThemedFrame({ url, source, onLoad, ...props }: Props) {
  const { resolved } = useWorkspaceTheme()
  const { liveSources } = useDesktop()
  const builtAt = liveSources.find(item => item.id === source)?.builtAt
  const frame = useRef<HTMLIFrameElement>(null)
  const lastBuild = useRef(builtAt)
  const reload = useCallback(() => frame.current?.contentWindow?.postMessage({ type: 'mrmak:reload' }, new URL(url, location.href).origin), [url])
  useEffect(() => onServiceEvent(event => {
    if (source && event.type === 'live-source' && event.source?.id === source && event.source.state === 'ready') {
      lastBuild.current = event.source.builtAt
      reload()
    }
  }), [source, reload])
  // A reconnect snapshot may contain a completed build missed while offline.
  useEffect(() => {
    if (builtAt && lastBuild.current !== builtAt) { lastBuild.current = builtAt; reload() }
  }, [builtAt, reload])
  // Set the initial colour before a desktop report paints. Later theme changes
  // use a message, preserving scroll position and the report's interactive state.
  const [src] = useState(() => {
    const target = new URL(url, location.href)
    target.searchParams.set('mrmak-theme', resolved)
    return target.href
  })
  const applyTheme = useCallback(() => {
    const element = frame.current
    if (!element) return
    // Vite serves reports on the same origin. Desktop content is isolated on a
    // second origin, whose prelude accepts theme messages only from its UI.
    try {
      const doc = element.contentDocument
      if (doc?.documentElement) {
        if (!doc.querySelector('style[data-mrmak-report-theme]')) {
          const style = doc.createElement('style')
          style.dataset.mrmakReportTheme = ''
          style.textContent = reportThemeCSS
          ;(doc.head || doc.documentElement).append(style)
        }
        doc.documentElement.dataset.mrmakTheme = resolved
      }
    } catch { /* Cross-origin reports use the message below. */ }
    element.contentWindow?.postMessage({ type: 'mrmak:theme', theme: resolved }, new URL(url, location.href).origin)
  }, [resolved, url])
  useEffect(applyTheme, [applyTheme])
  return <iframe {...props} ref={frame} src={src} onLoad={() => { applyTheme(); onLoad?.() }} />
}

export default function ReportFrame(props: Props) {
  return <ThemedFrame key={props.url} {...props} />
}
