import { useRef, useState } from 'react'
import type { TouchEvent } from 'react'

/** Finger travel that triggers a refresh, and the indicator's offset for a pull. */
export const PULL_REFRESH_DISTANCE = 80
export const pullOffset = (distance: number) => Math.min(72, distance * .5)

function atTop(node: Element | null, root: Element) {
  for (; node && node !== root.parentElement; node = node.parentElement) if (node.scrollTop > 0) return false
  return true
}

/**
 * Pull to refresh for a view whose own scrollers are at the top. `pull` also takes a pull reported
 * by an embedded report frame, whose touches never reach this document.
 */
export function usePullRefresh(refresh: () => void, enabled: boolean) {
  const [distance, setDistance] = useState(0), start = useRef<{ x: number; y: number; distance: number } | null>(null)
  function pull(value: number, done: boolean) {
    if (!enabled) { setDistance(0); return }
    setDistance(done ? 0 : value)
    if (done && value >= PULL_REFRESH_DISTANCE) refresh()
  }
  function end(cancelled: boolean) { const current = start.current; start.current = null; if (current?.distance) pull(cancelled ? 0 : current.distance, true) }
  const touch = {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      const target = event.target as Element, first = event.touches[0]
      start.current = enabled && event.touches.length === 1 && event.currentTarget.contains(target) && atTop(target, event.currentTarget) ? { x: first.clientX, y: first.clientY, distance: 0 } : null
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      const current = start.current
      if (!current) return
      const first = event.touches[0], dx = first.clientX - current.x, dy = first.clientY - current.y
      if (event.touches.length > 1 || dy < 0 || (!current.distance && Math.abs(dx) > dy)) { end(true); return }
      current.distance = dy; pull(dy, false)
    },
    onTouchEnd() { end(false) },
    onTouchCancel() { end(true) },
  }
  return { distance, pull, touch }
}
