import { useEffect, useRef, useState } from 'react'
import { Icon } from '../desktop/Icons'

export interface ConversationImage { url?: string; name: string; unavailable?: boolean }
interface Position { scale: number; x: number; y: number }
const initial: Position = { scale: 1, x: 0, y: 0 }

export default function ImageViewer({ image, onClose }: { image: ConversationImage; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), stage = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(initial)
  const current = useRef(initial), pointers = useRef(new Map<number, { x: number; y: number }>())
  const baseline = useRef<{ position: Position; x: number; y: number; distance: number } | null>(null)
  const [error, setError] = useState('')
  function apply(next: Position) {
    const scale = Math.max(1, Math.min(8, next.scale))
    const box = stage.current?.getBoundingClientRect()
    const maxX = box ? box.width * (scale - 1) / 2 : 0, maxY = box ? box.height * (scale - 1) / 2 : 0
    current.current = { scale, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) }
    setPosition(current.current)
  }
  function gesture() {
    const points = [...pointers.current.values()]
    if (!points.length) { baseline.current = null; return }
    const first = points[0], second = points[1] || first
    baseline.current = { position: { ...current.current }, x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, distance: points.length > 1 ? Math.hypot(second.x - first.x, second.y - first.y) : 0 }
  }
  function zoom(factor: number) { apply({ ...current.current, scale: current.current.scale * factor }) }
  useEffect(() => {
    const node = dialog.current, viewport = stage.current
    node?.showModal()
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15) }
    const preventGesture = (event: Event) => event.preventDefault()
    viewport?.addEventListener('wheel', wheel, { passive: false })
    node?.addEventListener('gesturestart', preventGesture, { passive: false })
    node?.addEventListener('gesturechange', preventGesture, { passive: false })
    const resize = () => apply(initial)
    window.addEventListener('resize', resize)
    return () => { viewport?.removeEventListener('wheel', wheel); node?.removeEventListener('gesturestart', preventGesture); node?.removeEventListener('gesturechange', preventGesture); window.removeEventListener('resize', resize); node?.close() }
    // This viewer mounts separately for each opened image; gestures read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <dialog ref={dialog} className="mobile-image-viewer" aria-label="Shared image preview" onCancel={event => { event.preventDefault(); onClose() }}>
    <header><button type="button" aria-label="Close image" onClick={onClose}><Icon name="close" size={24} /></button><span>{image.name}</span><a href={`${image.url}?download=1`} download aria-label="Download image"><Icon name="down" size={23} /></a></header>
    <div ref={stage} className="mobile-image-stage" aria-label="Image zoom area" onDoubleClick={() => { if (current.current.scale > 1) apply(initial); else zoom(2) }} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); gesture() }} onPointerMove={event => {
      if (!pointers.current.has(event.pointerId) || !baseline.current) return
      event.preventDefault(); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const points = [...pointers.current.values()], first = points[0], second = points[1] || first, base = baseline.current
      const centerX = (first.x + second.x) / 2, centerY = (first.y + second.y) / 2
      const scale = base.distance ? Math.max(1, Math.min(8, base.position.scale * Math.hypot(second.x - first.x, second.y - first.y) / base.distance)) : base.position.scale
      const ratio = scale / base.position.scale, rect = event.currentTarget.getBoundingClientRect()
      apply({ scale, x: base.position.x * ratio + centerX - base.x + (base.x - rect.left - rect.width / 2) * (1 - ratio), y: base.position.y * ratio + centerY - base.y + (base.y - rect.top - rect.height / 2) * (1 - ratio) })
    }} onPointerUp={event => { pointers.current.delete(event.pointerId); gesture() }} onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture() }}>
      {error ? <p role="status">{error}</p> : <img src={image.url} alt={image.name} draggable={false} onError={() => setError('This image is no longer available. Close and reopen it from the conversation.')} style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${position.scale})` }} />}
    </div><footer><button type="button" aria-label="Zoom out" disabled={position.scale <= 1} onClick={() => zoom(1 / 1.5)}>−</button><button type="button" aria-label="Reset image zoom" onClick={() => apply(initial)}>{Math.round(position.scale * 100)}%</button><button type="button" aria-label="Zoom in" disabled={position.scale >= 8} onClick={() => zoom(1.5)}>+</button></footer>
  </dialog>
}
