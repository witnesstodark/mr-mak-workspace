import { useState, useEffect } from 'react'
import { keepUrl, linkTarget } from '../components/messageLinks'
import type { ChatSession, ModelUsageStats } from '../desktop/types'
import type { ChatPlan } from '../desktop/chatPlan'
import type { ChatCache } from '../desktop/chatModel'
import { mobileApi } from './client'
import { selectMobileWorkspace, setMobileView } from './app-state'

export interface Rule { id: string; rule: string; at: string }
export interface Change { path: string; name: string; status: string; folder?: boolean; added?: number | null; removed?: number | null }
export interface ChatDetails { plan: ChatPlan | null; usage: ModelUsageStats | null; cache: ChatCache | null; rules: Rule[]; changes: Change[]; changeCount: number }
export interface LinkedFile { name: string; url: string; kind: 'html' | 'markdown' | 'image' | 'video' | 'other'; text?: string }

// Everything the phone shows beside a chat, read every few seconds while it is open.
export function useChatDetails(session: ChatSession, active: boolean) {
  const [read, setRead] = useState<{ id: string; value: ChatDetails } | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!active || session.agent === 'shell') return
    let stopped = false
    const load = () => { if (document.visibilityState !== 'hidden') mobileApi<ChatDetails>(`/sessions/${session.id}/details`).then(value => { if (!stopped) setRead({ id: session.id, value }) }).catch(() => {}) }
    load(); const timer = window.setInterval(load, 6000)
    return () => { stopped = true; clearInterval(timer) }
  }, [session.id, session.agent, session.completionVersion, active, version])
  return { details: read?.id === session.id ? read.value : null, reload: () => setVersion(value => value + 1) }
}

// Links in a chat message. Web links open in the browser; a local file opens as its
// Workspace report or in the file viewer, instead of reloading the app.
export function useMessageLinks(session: ChatSession) {
  const [file, setFile] = useState<LinkedFile | null>(null), [error, setError] = useState('')
  async function open(path: string) {
    setError('')
    try {
      const result = await mobileApi<{ report?: { entityId: string; step: number }; file?: LinkedFile }>(`/sessions/${session.id}/open`, { path })
      if (result.report) { selectMobileWorkspace(result.report.entityId, result.report.step); setMobileView('results') }
      else if (result.file?.kind === 'other') window.open(result.file.url, '_blank', 'noopener')
      else if (result.file) setFile(result.file)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const link = ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const target = linkTarget(href)
    if (target.kind === 'web') return <a href={href} target="_blank" rel="noreferrer">{children}</a>
    if (target.kind === 'text') return <span>{children}</span>
    return <a href={href} onClick={event => { event.preventDefault(); void open(target.path) }}>{children}</a>
  }
  return { link, urlTransform: keepUrl, file, close: () => setFile(null), error }
}
