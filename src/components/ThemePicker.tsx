import { useState } from 'react'
import { setWorkspaceTheme, useWorkspaceTheme, type WorkspaceTheme, type ThemeTarget } from '../lib/workspace-theme'
import { themes, themePalette } from '../../desktop/service/appearance.mjs'

export default function ThemePicker({ target = 'workspace' }: { target?: ThemeTarget }) {
  const { preference, resolved } = useWorkspaceTheme(target)
  const palette = themePalette(resolved)
  const label = target === 'chat' ? 'Chat theme' : 'Workspace theme'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = async (value: WorkspaceTheme) => {
    setBusy(true); setError('')
    try { await setWorkspaceTheme(value, target) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className="workspace-theme-picker">
    <label>{label}<select aria-label={label} value={preference} disabled={busy} onChange={event => void change(event.target.value as WorkspaceTheme)}>
      <optgroup label="Inspired by your tools">{themes.slice(0, 3).map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</optgroup>
      <optgroup label="More palettes">{themes.slice(3).map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</optgroup>
      <optgroup label="Classic"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></optgroup>
    </select></label>
    <div className="theme-preview" aria-hidden="true" style={{ background: palette.bg, color: palette.text, borderColor: palette.muted + '55' }}>
      <div className="theme-preview-bar" style={{ background: palette.panel }}><i style={{ background: palette.accent }} /><span>{palette.name}</span><i style={{ background: palette.secondary }} /></div>
      <div className="theme-preview-copy"><span style={{ color: palette.muted }}>A clear space for your work</span><strong>Ideas with room to grow.</strong><span style={{ color: palette.accent }}>Aa <span style={{ color: palette.secondary }}>Aa</span></span></div>
    </div>
    <p>{palette.description} {target === 'chat' ? 'Applies to all chats, including Conversation and Terminal.' : 'Applies to Workspace and standard reports.'} System follows your device.</p>
    {error && <p role="alert">{error}</p>}
  </div>
}
