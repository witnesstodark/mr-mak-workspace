import type { ChatSession } from './types'

// Windows folders (drive letter or backslashes) compare without case.
export const projectKey = (folder: string) => { const clean = folder.replace(/[\\/]+$/, ''); return /^[a-z]:|\\/i.test(clean) ? clean.toLowerCase() : clean }
export const projectName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).slice(-1)[0] || folder

export const tabColors = [
  { name: 'Rose', value: '#dba3bb' }, { name: 'Peach', value: '#dfa48b' },
  { name: 'Gold', value: '#d7bd80' }, { name: 'Sage', value: '#a5bd91' },
  { name: 'Mint', value: '#8cc8b4' }, { name: 'Sky', value: '#91b6da' },
  { name: 'Lilac', value: '#b8a2d4' }, { name: 'Slate', value: '#a6afbc' },
]

function hash(text: string) {
  let value = 0
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return value
}

/** The chosen color for a group, otherwise a stable swatch from its name so a group keeps its color without storing one. */
export function groupColor(name: string, colors?: Record<string, string>) {
  return colors?.[name] || tabColors[hash(name.trim().toLowerCase()) % tabColors.length].value
}

/**
 * Grouped tabs sit together at the position of their earliest open member; a tab
 * without a group keeps its own position. The service applies the same rule in
 * `groupRanks`, so the shortcut order and the saved order never disagree.
 */
function groupRanks(items: ChatSession[]) {
  const ranks = new Map<string, number>()
  for (const item of items) {
    if (!item.open || !item.group) continue
    const key = `${item.pinned}:${item.group}`
    ranks.set(key, Math.min(ranks.get(key) ?? Infinity, item.tabOrder || 0))
  }
  return (item: ChatSession) => (item.group ? ranks.get(`${item.pinned}:${item.group}`) : undefined) ?? (item.tabOrder || 0)
}

/** Open tabs are grouped by project when each folder's tabs share one group that holds only that folder. The service's `projectGrouped` applies the same rule. */
export function projectGrouped(sessions: ChatSession[]) {
  const open = sessions.filter(item => item.open), groups = new Map<string, string>(), folders = new Map<string, string>()
  for (const item of open) {
    const key = projectKey(item.cwd)
    if (!item.group || (groups.get(key) ?? item.group) !== item.group || (folders.get(item.group) ?? key) !== key) return false
    groups.set(key, item.group); folders.set(item.group, key)
  }
  return open.length > 0
}

export function orderedChats(sessions: ChatSession[]) {
  const open = sessions.filter(item => item.open)
  const rank = groupRanks(open)
  return open.sort((a, b) => Number(b.pinned) - Number(a.pinned) || rank(a) - rank(b) || (a.tabOrder || 0) - (b.tabOrder || 0))
}

export interface TabGroup {
  /** null for a tab outside any group */
  name: string | null
  pinned: boolean
  items: ChatSession[]
  unread: boolean
  working: boolean
  color: string
}

/** Open tabs in display order, with consecutive members of one group folded together. An ungrouped tab is a one-item group without a name. */
export function groupedChats(sessions: ChatSession[], colors?: Record<string, string>): TabGroup[] {
  const result: TabGroup[] = []
  for (const item of orderedChats(sessions)) {
    const working = item.status === 'running' && item.activity === 'working'
    const last = result[result.length - 1]
    if (item.group && last && last.name === item.group && last.pinned === item.pinned) {
      last.items.push(item)
      last.unread = last.unread || !!item.unread
      last.working = last.working || working
      continue
    }
    result.push({ name: item.group || null, pinned: item.pinned, items: [item], unread: !!item.unread, working, color: item.group ? groupColor(item.group, colors) : '#dfa3b8' })
  }
  return result
}

/** How many open tabs and History chats carry each group, for the confirmations that delete one. */
export function groupCounts(sessions: ChatSession[]) {
  const counts: Record<string, { open: number; history: number }> = {}
  for (const item of sessions) {
    if (!item.group) continue
    counts[item.group] ??= { open: 0, history: 0 }
    counts[item.group][item.open ? 'open' : 'history']++
  }
  return counts
}

/** Known group names, most recently used first. Closed chats count, so a group that lives in History can still be chosen. */
export function groupNames(sessions: ChatSession[]) {
  const names: string[] = []
  for (const item of [...sessions].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
    if (item.group && !names.includes(item.group)) names.push(item.group)
  }
  return names
}
