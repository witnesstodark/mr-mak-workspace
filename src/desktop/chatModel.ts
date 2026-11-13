import { useEffect, useState } from 'react'
import { api } from './client'
import type { ChatSession } from './types'
import { hasConversationView } from './chatView'

// The model and reasoning effort a chat last used: for Claude the change confirmed in
// the footer menu or its status line's report, otherwise the transcript's model. It
// refreshes after each turn and every 15 s, which also catches a /model or /effort typed
// in the terminal.
export interface ChatStats { model: string | null; modelName: string | null; effort: string | null }
const empty: ChatStats = { model: null, modelName: null, effort: null }

export function useChatStats(session: ChatSession | undefined): ChatStats {
  const [read, setRead] = useState<(ChatStats & { id: string }) | null>(null)
  const id = session && hasConversationView(session) && session.hasConversation ? session.id : null
  useEffect(() => {
    if (!id) return
    let alive = true
    const load = () => api<{ model?: string | null; modelName?: string | null; effort?: string | null }>(`/sessions/${id}/stats`).then(value => {
      if (alive) setRead({ id, model: value.model || null, modelName: value.modelName || null, effort: value.effort || null })
    }).catch(() => {})
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 15000)
    // The footer's model menu asks for a fresh read after it applies a change.
    const changed = (event: Event) => { if ((event as CustomEvent<{ id?: string }>).detail?.id === id) void load() }
    window.addEventListener(chatStatsEvent, changed)
    return () => { alive = false; clearInterval(timer); window.removeEventListener(chatStatsEvent, changed) }
  }, [id, session?.completionVersion])
  return id && read?.id === id ? { model: read.model, modelName: read.modelName, effort: read.effort } : empty
}

export const chatStatsEvent = 'mrmak-chat-stats'
export const refreshChatStats = (id: string) => window.dispatchEvent(new CustomEvent(chatStatsEvent, { detail: { id } }))

export function useChatModel(session: ChatSession | undefined) {
  return useChatStats(session).model
}

// "claude-opus-5-5-20261001" reads as "opus-5-5"; other names are kept.
export const modelLabel = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}(?=$|\[)/, '')
