import { useState } from 'react'
import { keepUrl, linkTarget } from '../components/messageLinks'
import type { ChatSession } from '../desktop/types'
import { mobileApi } from './client'
import { selectMobileWorkspace, setMobileView } from './app-state'

export interface LinkedFile { name: string; url: string; kind: 'html' | 'markdown' | 'image' | 'video' | 'other'; text?: string }

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
