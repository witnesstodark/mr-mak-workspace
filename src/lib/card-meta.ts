import type { WorkspaceEntity } from '../types'

/**
 * The optional `cover`, `progress` and `phase` fields are written by other
 * tools into workspace.json, so every one is checked before it is drawn: a bad
 * value drops that one element and the card renders as it always did.
 * desktop/service/workspace.mjs applies the same rules for the phone.
 */

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined

export function cardCover(entity: WorkspaceEntity): string | null {
  return text(entity.cover, 300) ?? null
}

export function cardPhase(entity: WorkspaceEntity): string | null {
  return text(entity.phase, 80) ?? null
}

export interface CardProgress {
  done: number
  total: number
  label?: string
  percent: number
}

export function cardProgress(entity: WorkspaceEntity): CardProgress | null {
  const value: unknown = entity.progress
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { done, total, label } = value as Record<string, unknown>
  if (typeof done !== 'number' || typeof total !== 'number') return null
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done < 0 || done > total) return null
  return { done, total, label: text(label, 60), percent: Math.round((done / total) * 1000) / 10 }
}
