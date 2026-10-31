export const CACHE_TTL_MINUTES: number
export const IDLE_CACHE_MINUTES: number
export const IDLE_CACHE_MIN_TOKENS: number
export function compactCommand(agent: string): string | null
export interface IdleCacheAlert { at: string; tokens: number; idleMinutes: number; expiresInMinutes: number }
export function idleCacheAlert(input: {
  agent: string; status: string; activity: string
  usage: { at?: string | null; tokens?: { current?: number } | null } | null | undefined
  now?: number; minutes?: number; minTokens?: number; dismissed?: string | null
}): IdleCacheAlert | null
