import { useEffect, useRef, useState } from 'react'
import { api, contentUrl, desktopState, isDesktop } from '../desktop/client'
import type { Preview } from '../desktop/types'
import MarkdownDocument, { MarkdownView } from './MarkdownDocument'
import { ZoomImage } from './ImagePreview'
import { downloadImage } from '../lib/download'
import ReportFrame, { REPORT_SANDBOX } from './ReportFrame'
import ConfirmLayer from './ConfirmSend'
import { createConfirmQueue } from '../lib/confirm-queue'
import { handleAssetRequest, MAX_SOURCE_CHARS, SOURCE, type AssetBridgeDeps, type AssetCard } from '../desktop/assetBridge'

// A card's asset library asks to send an item to a chat (src/desktop/assetBridge.ts).
// The owner confirms each request here; leaving the card cancels what waits.
const assetQueue = createConfirmQueue({ max: 3, timeoutMs: 10 * 60 * 1000 })

async function readRepositoryFile(relative: string) {
  const response = await fetch(contentUrl(`/${relative}`), { cache: 'no-store' })
  if (response.status === 404) throw new Error(`This card has no ${SOURCE}.`)
  if (!response.ok) throw new Error(`${relative} could not be read (${response.status}).`)
  if (Number(response.headers.get('content-length')) > MAX_SOURCE_CHARS) throw new Error(`${SOURCE} is too large.`)
  return response.text()
}

const assetDeps: AssetBridgeDeps = {
  api: (path, data) => api(path, data),
  read: readRepositoryFile,
  repo: () => desktopState().repo,
  sessions: () => desktopState().sessions,
  selectedId: () => desktopState().selectedId,
  agentLabel: agent => desktopState().agents.find(item => item.id === agent)?.label || agent,
  confirm: view => assetQueue.confirm(view),
}

// Where a desktop page runs: the shared port redirects every page to its
// folder's own port. The service names that port first, and the frame is
// answered only from its origin, never from the initial URL's.
interface Site { url: string; origin: string }

export default function ReportViewer({ url, title, relativePath, card }: { url: string; title: string; relativePath: string; card?: AssetCard }) {
  const markdown = /\.md$/i.test(relativePath)
  const image = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(relativePath)
  const page = /\.html?$/i.test(relativePath.split(/[?#]/)[0])
  const [file, setFile] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [available, setAvailable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [site, setSite] = useState<Site | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const paint = useRef(0)
  const reveal = () => {
    cancelAnimationFrame(paint.current)
    paint.current = requestAnimationFrame(() => { paint.current = requestAnimationFrame(() => setLoaded(true)) })
  }
  useEffect(() => {
    const controller = new AbortController()
    if (markdown && isDesktop) {
      api<Preview>(`/preview?path=${encodeURIComponent(`${desktopState().repo}/${relativePath}`)}`).then(value => { if (!controller.signal.aborted) setFile(value) }).catch(error => { if (!controller.signal.aborted) setError(String(error.message || error)) })
    } else {
      // A desktop HTML report redirects to its folder's own port; the redirect itself confirms the page exists.
      fetch(url, { method: markdown ? 'GET' : 'HEAD', redirect: markdown ? 'follow' : 'manual', signal: controller.signal }).then(async response => {
        if (!response.ok && response.type !== 'opaqueredirect') throw new Error(`Page unavailable (${response.status}).`)
        if (controller.signal.aborted) return
        // The origin of the final address, the only one the frame's messages are trusted from.
        if (page && isDesktop) {
          const value = await api<Site>('/content/resolve', { url: new URL(url, location.href).href })
          if (controller.signal.aborted) return
          setSite(value)
        }
        setAvailable(true)
        if (markdown) setFile({ name: title, path: relativePath, kind: 'text', size: 0, text: await response.text(), url })
      }).catch(error => { if (!controller.signal.aborted) setError(String(error.message || error)) })
    }
    return () => { controller.abort(); cancelAnimationFrame(paint.current) }
  }, [url, title, relativePath, markdown, page])

  // The card's fields come from workspace.json, never from the page.
  const cardId = card?.id, cardTitle = card?.title, cardFolder = card?.folder, cardProject = card?.project
  useEffect(() => {
    if (!site || !cardId || !cardFolder) return
    const owner: AssetCard = { id: cardId, title: cardTitle || cardId, folder: cardFolder, project: cardProject }
    const detach = assetQueue.attach()
    const { origin } = site
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow
      if (!target || event.source !== target || event.origin !== origin) return
      const data = event.data as { type?: unknown; id?: unknown } | null
      if (!data || data.type !== 'mrmak:asset-request' || typeof data.id !== 'string' || data.id.length > 100) return
      const id = data.id
      // The target origin keeps a reply from reaching a page the frame navigated to meanwhile.
      const reply = (value: Record<string, unknown>) => target.postMessage({ type: 'mrmak:asset-response', id, ...value }, origin)
      handleAssetRequest(assetDeps, owner, data, () => reply({ waiting: true })).then(
        value => reply({ ok: true, text: value.text }),
        (reason: unknown) => reply({ ok: false, error: reason instanceof Error ? reason.message : String(reason) }),
      )
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      detach()
    }
  }, [site, cardId, cardTitle, cardFolder, cardProject])

  if (error) return <div className="report-error"><strong>{title}</strong><p>{error}</p><a href={url} target="_blank" rel="noreferrer">Open source file</a></div>
  if (markdown) return file ? isDesktop ? <MarkdownDocument file={file} /> : <div className="markdown-reader"><MarkdownView text={file.text || ''} baseUrl={url} /></div> : <div className="report-loading">Opening document…</div>
  if (image) return <div className="report-image"><nav><span>{title}</span><a href={url} target="_blank" rel="noreferrer">Open original</a><a href={url} onClick={event => { event.preventDefault(); void downloadImage(url).catch(error => setError(error.message)) }}>Download</a></nav><ZoomImage src={url} alt={title} /></div>
  const ready = available && loaded
  return <div className="report-document" aria-busy={!ready}>
    <ReportFrame ref={frame} url={url} title={title} className={`report-frame${ready ? ' loaded' : ''}`} sandbox={isDesktop ? REPORT_SANDBOX : undefined} onLoad={reveal} onError={() => setError('This page could not be loaded.')} />
    {!ready && <div className="report-loading" role="status">Opening report…</div>}
    {site && <ConfirmLayer queue={assetQueue} />}
  </div>
}
