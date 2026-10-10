import { useEffect, useRef, useState } from 'react'
import { api, desktopState, isDesktop } from '../desktop/client'
import type { LiveSource, Preview } from '../desktop/types'
import MarkdownDocument, { MarkdownView } from './MarkdownDocument'
import { ZoomImage } from './ImagePreview'
import { downloadImage } from '../lib/download'
import ReportFrame from './ReportFrame'

export default function ReportViewer({ url, title, relativePath, liveSource }: { url: string; title: string; relativePath: string; liveSource?: LiveSource }) {
  const markdown = /\.md$/i.test(relativePath)
  const image = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(relativePath)
  const [file, setFile] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [available, setAvailable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const paint = useRef(0)
  const waitingForBuild = !!liveSource && !liveSource.builtAt
  const reveal = () => {
    cancelAnimationFrame(paint.current)
    paint.current = requestAnimationFrame(() => { paint.current = requestAnimationFrame(() => setLoaded(true)) })
  }
  useEffect(() => {
    if (waitingForBuild) return
    const controller = new AbortController()
    if (markdown && isDesktop) {
      api<Preview>(`/preview?path=${encodeURIComponent(`${desktopState().repo}/${relativePath}`)}`).then(value => { if (!controller.signal.aborted) setFile(value) }).catch(error => { if (!controller.signal.aborted) setError(String(error.message || error)) })
    } else {
      fetch(url, { method: markdown ? 'GET' : 'HEAD', signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error(`Page unavailable (${response.status}).`)
        if (controller.signal.aborted) return
        setAvailable(true)
        if (markdown) setFile({ name: title, path: relativePath, kind: 'text', size: 0, text: await response.text(), url })
      }).catch(error => { if (!controller.signal.aborted) setError(String(error.message || error)) })
    }
    return () => { controller.abort(); cancelAnimationFrame(paint.current) }
  }, [url, title, relativePath, markdown, waitingForBuild])
  const errorLines = liveSource?.error?.trim().split(/\r?\n/)
  const lastError = errorLines?.[errorLines.length - 1]
  if (waitingForBuild) return liveSource?.state === 'failed'
    ? <div className="report-error" role="alert"><strong>The Codex build failed.</strong><p>{lastError}</p><details><summary>Full error</summary><pre>{liveSource.error}</pre></details></div>
    : <div className="report-loading" role="status">Building the Codex...</div>
  if (error) return <div className="report-error"><strong>{title}</strong><p>{error}</p><a href={url} target="_blank" rel="noreferrer">Open source file</a></div>
  if (markdown) return file ? isDesktop ? <MarkdownDocument file={file} /> : <div className="markdown-reader"><MarkdownView text={file.text || ''} baseUrl={url} /></div> : <div className="report-loading">Opening document…</div>
  if (image) return <div className="report-image"><nav><span>{title}</span><a href={url} target="_blank" rel="noreferrer">Open original</a><a href={url} onClick={event => { event.preventDefault(); void downloadImage(url).catch(error => setError(error.message)) }}>Download</a></nav><ZoomImage src={url} alt={title} /></div>
  const ready = available && loaded
  return <div className="report-document live-report" aria-busy={!ready}>
    {liveSource?.state === 'building' && <div className="live-source-status" role="status">Updating the Codex…</div>}
    {liveSource?.state === 'failed' && <div className="live-source-status failed" role="alert">Showing the build from {new Date(liveSource.builtAt!).toLocaleString()}. Latest rebuild failed: {lastError}<details><summary>Full error</summary><pre>{liveSource.error}</pre></details></div>}
    <ReportFrame url={url} source={liveSource?.id} title={title} className={`report-frame${ready ? ' loaded' : ''}`} sandbox={isDesktop ? liveSource ? 'allow-scripts allow-same-origin allow-popups allow-downloads' : 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads' : undefined} onLoad={reveal} onError={() => setError('This page could not be loaded.')} />
    {!ready && <div className="report-loading" role="status">Opening report…</div>}
  </div>
}
