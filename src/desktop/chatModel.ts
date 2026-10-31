import { useEffect, useState } from 'react'
import { api } from './client'
import type { ChatSession } from './types'
import { hasConversationView } from './chatView'

import type { ModelUsageStats } from './types'

// The model, reasoning effort and usage a chat last used, read from its transcript. It
// refreshes after each turn and every 15 s, which also catches a /model or /effort change.
export interface ChatCache { at: string; tokens: number; model: string | null; expiresAt: string; cold: boolean; writeUsd: number | null; readUsd: number | null }
// The chat's cache use over its whole transcript (chat-cache.mjs cacheHistory).
export type CacheRewriteReason = 'start' | 'expired' | 'model' | 'compact' | 'other'
export interface CacheRewrite { at: string; tokens: number; reason: CacheRewriteReason; model: string | null; writeUsd: number | null }
export interface CacheStats { replies: number; read: number; written: number; uncached: number; hitRate: number | null; readUsd: number | null; writeUsd: number | null; rewriteCount: number; rewriteUsd: number | null; rewrites: CacheRewrite[] }

export function useChatStats(session: ChatSession | undefined) {
  const [read, setRead] = useState<{ id: string; model: string | null; modelName: string | null; effort: string | null; usage: ModelUsageStats | null; cache: ChatCache | null; cacheStats: CacheStats | null } | null>(null)
  const id = session && hasConversationView(session) && session.hasConversation ? session.id : null
  useEffect(() => {
    if (!id) return
    let alive = true
    const load = () => api<{ model?: string | null; modelName?: string | null; effort?: string | null; usage?: ModelUsageStats | null; cache?: ChatCache | null; cacheStats?: CacheStats | null }>(`/sessions/${id}/stats`).then(value => {
      if (alive) setRead({ id, model: value.model || null, modelName: value.modelName || null, effort: value.effort || null, usage: value.usage || null, cache: value.cache || null, cacheStats: value.cacheStats || null })
    }).catch(() => {})
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 15000)
    // The footer's model menu asks for a fresh read after it applies a change.
    const changed = (event: Event) => { if ((event as CustomEvent<{ id?: string }>).detail?.id === id) void load() }
    window.addEventListener(chatStatsEvent, changed)
    return () => { alive = false; clearInterval(timer); window.removeEventListener(chatStatsEvent, changed) }
  }, [id, session?.completionVersion])
  return id && read?.id === id ? { model: read.model, modelName: read.modelName, effort: read.effort, usage: read.usage, cache: read.cache, cacheStats: read.cacheStats } : { model: null, modelName: null, effort: null, usage: null, cache: null, cacheStats: null }
}

export const chatStatsEvent = 'mrmak-chat-stats'
export const refreshChatStats = (id: string) => window.dispatchEvent(new CustomEvent(chatStatsEvent, { detail: { id } }))

export function useChatModel(session: ChatSession | undefined) {
  return useChatStats(session).model
}

// "claude-opus-5-5-20261001" reads as "opus-5-5"; other names are kept.
export const modelLabel = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}(?=$|\[)/, '')
