import type { ModelRateLimitEntry, ModelRateLimitWindow, ModelUsageStats } from './types'

// A value no CLI reported is shown as a dash.
export const DASH = '—'

export function formatReset(resetsAt: number, now: number): string {
  if (!resetsAt) return 'Reset time not reported'
  const totalMinutes = Math.max(0, Math.floor((resetsAt * 1000 - now) / 60_000))
  const hours = Math.floor(totalMinutes / 60), days = Math.floor(hours / 24)
  const rel = days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${totalMinutes % 60}m` : `${totalMinutes}m`
  const at = new Date(resetsAt * 1000)
  const when = days > 0 ? at.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `Resets in ${rel} · ${when}`
}

export const tone = (used: number | null): 'normal' | 'warning' | 'alert' => used === null ? 'normal' : used >= 90 ? 'alert' : used >= 75 ? 'warning' : 'normal'

// A window still in effect. One whose reset time has passed no longer says how much is used.
export function current(window: ModelRateLimitWindow | null | undefined, now: number): ModelRateLimitWindow | null {
  if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return null
  if (window.resetsAt > 0 && window.resetsAt * 1000 <= now) return null
  return window
}

// The session window lasts hours; the weekly one seven days.
function planWindows(entry: ModelRateLimitEntry | null, now: number) {
  const all = [entry?.primary, entry?.secondary].filter((item): item is ModelRateLimitWindow => !!item)
  const byLength = (test: (minutes: number) => boolean) => all.find(item => item.windowMinutes > 0 && test(item.windowMinutes))
  const session = byLength(minutes => minutes <= 24 * 60) ?? (entry?.primary && !entry.primary.windowMinutes ? entry.primary : undefined)
  const weekly = byLength(minutes => minutes >= 7 * 24 * 60 - 60) ?? (entry?.secondary && !entry.secondary.windowMinutes ? entry.secondary : undefined)
  return { session: current(session, now), weekly: current(weekly, now), sessionMinutes: session?.windowMinutes || 300 }
}

// The plan's general limits: the session window, its label and the weekly window.
export function planLimits(usage: ModelUsageStats | null | undefined, now: number) {
  const list = usage?.rateLimitsList || (usage?.rateLimits ? [usage.rateLimits] : [])
  const general = list.find(item => !item.isExclusive) || null
  const { session, weekly, sessionMinutes } = planWindows(general, now)
  const sessionLabel = sessionMinutes === 300 ? '5h' : sessionMinutes >= 60 ? `${Math.round(sessionMinutes / 60)}h` : `${sessionMinutes}m`
  return { list, general, session, weekly, sessionLabel }
}

export const shown = (value: number | null) => value === null ? DASH : `${Math.round(value)}%`
