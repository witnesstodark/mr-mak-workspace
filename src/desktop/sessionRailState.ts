import { useEffect, useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

const openKey = 'mrmak.sessionRail.open'
export const stored = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
export const store = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* Kept for this window only. */ } }

// Whether the Session Rail is shown, for every Claude chat in this window.
export function useSessionRail() {
  const [open, setOpen] = useState(() => stored(openKey) === 'true')
  const toggle = () => { store(openKey, String(!open)); setOpen(!open) }
  return [open, toggle] as const
}

// The rail's view, remembered for this window. The cache chip opens the Cache view.
export type RailPanel = 'sessions' | 'prompts' | 'plan' | 'cache'
export const railPanelKey = 'mrmak.sessionRail.panel'
export const railPanelEvent = 'mrmak-rail-panel'
export function showRailPanel(panel: RailPanel) { store(railPanelKey, panel); window.dispatchEvent(new CustomEvent(railPanelEvent, { detail: panel })) }

// A prompt picked in the rail. Conversation scrolls to it once it has drawn it,
// also right after the rail switched a terminal chat to Conversation.
const jump: { pending: { sessionId: string; messageId: string; until: number } | null } = { pending: null }
const jumpEvent = 'mrmak-conversation-jump'
export function requestConversationJump(sessionId: string, messageId: string) {
  jump.pending = { sessionId, messageId, until: Date.now() + 10000 }
  window.dispatchEvent(new Event(jumpEvent))
}
export function useConversationJump(sessionId: string, scrollerRef: RefObject<HTMLDivElement | null>, followRef: { current: boolean }) {
  const [, setWake] = useState(0)
  useEffect(() => {
    const wake = () => setWake(value => value + 1)
    window.addEventListener(jumpEvent, wake)
    return () => window.removeEventListener(jumpEvent, wake)
  }, [])
  useLayoutEffect(() => {
    const target = jump.pending
    if (!target || target.sessionId !== sessionId) return
    if (Date.now() > target.until) { jump.pending = null; return }
    const node = scrollerRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(target.messageId)}"]`)
    if (!node) return
    jump.pending = null; followRef.current = false
    node.scrollIntoView({ block: 'center' })
    node.classList.remove('conversation-jump-target'); void node.offsetWidth; node.classList.add('conversation-jump-target')
    window.setTimeout(() => node.classList.remove('conversation-jump-target'), 1800)
  })
}
