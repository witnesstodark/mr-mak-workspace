import { useCallback, useEffect, useRef, useState, type IframeHTMLAttributes } from 'react'
import { useWorkspaceTheme } from '../lib/workspace-theme'
import { reportThemeCSS } from '../../desktop/service/report-theme.mjs'

type Props = Omit<IframeHTMLAttributes<HTMLIFrameElement>, 'src' | 'onLoad'> & { url: string; onLoad?: () => void }

function ThemedFrame({ url, onLoad, ...props }: Props) {
  const { resolved } = useWorkspaceTheme()
  const frame = useRef<HTMLIFrameElement>(null)
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
    // Only touch the document when same-origin: WebKit reports every blocked
    // cross-origin access as an error, even inside try/catch.
    const sameOrigin = new URL(url, location.href).origin === location.origin
    if (sameOrigin) try {
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
    // A desktop report runs in an opaque origin, which no target origin can name.
    // The message only carries the theme name.
    element.contentWindow?.postMessage({ type: 'mrmak:theme', theme: resolved }, '*')
  }, [resolved, url])
  useEffect(applyTheme, [applyTheme])
  return <iframe {...props} ref={frame} src={src} onLoad={() => { applyTheme(); onLoad?.() }} />
}

export default function ReportFrame(props: Props) {
  return <ThemedFrame key={props.url} {...props} />
}
