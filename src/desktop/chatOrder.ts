import type { ChatSession } from './types'

// Windows folders (drive letter or backslashes) compare without case.
export const projectKey = (folder: string) => { const clean = folder.replace(/[\\/]+$/, ''); return /^[a-z]:|\\/i.test(clean) ? clean.toLowerCase() : clean }
export const projectName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).slice(-1)[0] || folder

// Tab order, also used by the Alt/Cmd+number shortcuts. Grouped by project, each
// project keeps the position of its first tab and its own tab order.
export function orderedChats(sessions: ChatSession[], grouped = false) {
  const ordered = sessions.filter(item => item.open).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.tabOrder || 0) - (b.tabOrder || 0))
  if (!grouped) return ordered
  const groups = new Map<string, ChatSession[]>()
  for (const item of ordered) { const key = projectKey(item.cwd); groups.set(key, [...(groups.get(key) || []), item]) }
  return [...groups.values()].flat()
}

export const tabColors = [
  { name: 'Rose', value: '#dba3bb' }, { name: 'Peach', value: '#dfa48b' },
  { name: 'Gold', value: '#d7bd80' }, { name: 'Sage', value: '#a5bd91' },
  { name: 'Mint', value: '#8cc8b4' }, { name: 'Sky', value: '#91b6da' },
  { name: 'Lilac', value: '#b8a2d4' }, { name: 'Slate', value: '#a6afbc' },
]
