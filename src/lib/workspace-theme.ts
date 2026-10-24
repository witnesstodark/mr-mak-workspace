import { useSyncExternalStore } from 'react'
import { api, isDesktop, useDesktop } from '../desktop/client'
import { isThemePreference, resolveTheme, type ThemePreference, type PaletteId } from '../../desktop/service/appearance.mjs'

export type WorkspaceTheme = ThemePreference
export type ResolvedTheme = PaletteId
export type ThemeTarget = 'workspace' | 'chat'
const changed = 'mrmak-workspace-theme'
const system = window.matchMedia('(prefers-color-scheme: dark)')
const valid = (value: unknown): WorkspaceTheme => isThemePreference(value) ? value : 'dark'
const readPreference = (target: ThemeTarget) => { try { return valid(localStorage.getItem(`mrmak.${target}Theme`)) } catch { return 'dark' as const } }
const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener)
  window.addEventListener(changed, listener)
  system.addEventListener('change', listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener(changed, listener)
    system.removeEventListener('change', listener)
  }
}
const snapshot = () => `${readPreference('workspace')}:${readPreference('chat')}:${system.matches}`

export function useWorkspaceTheme(target: ThemeTarget = 'workspace') {
  const { settings } = useDesktop()
  useSyncExternalStore(subscribe, snapshot)
  const preference = isDesktop ? valid(settings[`${target}Theme`]) : readPreference(target)
  const resolved = resolveTheme(preference, system.matches)
  return { preference, resolved }
}

export async function setWorkspaceTheme(preference: WorkspaceTheme, target: ThemeTarget = 'workspace') {
  if (isDesktop) await api('/settings', { [`${target}Theme`]: preference })
  else {
    localStorage.setItem(`mrmak.${target}Theme`, preference)
    window.dispatchEvent(new Event(changed))
  }
}
