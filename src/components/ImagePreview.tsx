import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../styles/report.css'
import { downloadImage } from '../lib/download'

export default function ImagePreview({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [actual, setActual] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const current = dialog.current; current?.showModal(); return () => current?.close() }, [])
  // StrictMode closes and reopens the dialog during its effect check. Ignore a
  // queued close event if the dialog has already reopened.
  return createPortal(<dialog ref={dialog} className="mak-lightbox" aria-label="Image preview" onClose={event => { if (!event.currentTarget.open) onClose() }}><div className="mak-lightbox-toolbar"><span className="mak-lightbox-caption">{title}</span><button onClick={() => setActual(value => !value)}>{actual ? 'Fit' : '100%'}</button><a href={url} target="_blank" rel="noreferrer">Open original</a><button onClick={() => void downloadImage(url).catch(error => setError(error.message))}>Download</button><button onClick={() => dialog.current?.close()}>Close</button></div><div className={`mak-lightbox-stage${actual ? ' actual' : ''}`}><img src={url} alt={title} onClick={() => setActual(value => !value)} onError={() => setError('This image could not be loaded.')} /></div><p className="mak-lightbox-note" role="status">{error || 'Esc to close'}</p></dialog>, document.body)
}

export function ZoomImage({ src, alt = '', onError }: { src?: string; alt?: string; onError?: () => void }) {
  const [open, setOpen] = useState(false)
  if (!src) return <span>{alt}</span>
  return <><a href={src} target="_blank" rel="noreferrer" title="Open image" onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setOpen(true) } }}><img src={src} alt={alt} loading="lazy" onError={onError} /></a>{open && <ImagePreview url={src} title={alt || 'Image'} onClose={() => setOpen(false)} />}</>
}
