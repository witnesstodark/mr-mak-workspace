import { useLayoutEffect } from 'react'
import { surface } from '../desktop/client'
import { useWorkspaceTheme } from '../lib/workspace-theme'
import { themePalette, themeVariables } from '../../desktop/service/appearance.mjs'

export default function WorkspaceTheme() {
  const { resolved } = useWorkspaceTheme(surface === 'chats' ? 'chat' : 'workspace')
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.themeSwitching = ''
    root.dataset.workspaceTheme = resolved
    root.dataset.colorScheme = themePalette(resolved).scheme
    root.style.colorScheme = themePalette(resolved).scheme
    Object.entries(themeVariables(resolved)).forEach(([key, value]) => root.style.setProperty(key, value))
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { delete root.dataset.themeSwitching }) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); delete root.dataset.themeSwitching }
  }, [resolved])
  return null
}
