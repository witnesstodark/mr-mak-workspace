import { useEffect, useState } from 'react'
import { api, onServiceEvent, useDesktop } from './client'
import type { Settings } from './types'
import { Icon } from './Icons'

type NativeSettings = { available: boolean; winKey: boolean; error?: string }
export default function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  const { settings, repo } = useDesktop()
  const [native, setNative] = useState<NativeSettings>({ available: false, winKey: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const refresh = () => api<NativeSettings>('/native/settings').then(setNative).catch(error => setError(String(error.message || error)))
    void refresh()
    return onServiceEvent(event => { if (event.type === 'native-settings') void refresh() })
  }, [])
  const change = async (patch: Partial<Settings>) => {
    setBusy(true); setError('')
    try { await api('/settings', patch) } catch (error) { setError(String(error instanceof Error ? error.message : error)) }
    finally { setBusy(false) }
  }
  const winKey = async (enabled: boolean) => {
    setBusy(true); setError('')
    try { setNative(await api<NativeSettings>('/native/settings', { winKey: enabled })) }
    catch (error) { setError(String(error instanceof Error ? error.message : error)) }
    finally { setBusy(false) }
  }
  return <div className="files-panel workspace-settings"><header><h2>Settings</h2><button className="desk-icon" onClick={onClose} aria-label="Close settings"><Icon name="close" size={17} /></button></header>
    <div className="settings-scroll"><section><h3>Windows</h3><label className="setting-toggle"><span>Win key shows Mr. Mak<small>Bring back open windows. Win shortcuts keep working; Ctrl+Esc opens Start.</small></span><input type="checkbox" checked={native.winKey} disabled={busy || !native.available} onChange={event => void winKey(event.target.checked)} /></label>{!native.available && <p>{native.error || 'Available in the Windows desktop app.'}</p>}</section>
    <section><h3>Chats</h3><label>Default agent<select disabled={busy} value={settings.defaultAgent} onChange={event => void change({ defaultAgent: event.target.value as Settings['defaultAgent'] })}><option value="codex">Codex</option><option value="claude">Claude</option><option value="kimi">Kimi</option><option value="shell">{navigator.userAgent.includes('Windows') ? 'PowerShell' : 'Bash'}</option></select></label>
      <label>Terminal text size<select disabled={busy} value={settings.terminalFontSize || 13} onChange={event => void change({ terminalFontSize: Number(event.target.value) })}>{Array.from({ length: 15 }, (_, i) => i + 10).map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
      <label>Terminal appearance<select disabled={busy} value={settings.terminalAppearance || 'focus'} onChange={event => void change({ terminalAppearance: event.target.value as Settings['terminalAppearance'] })}><option value="focus">Focus · clearer answers</option><option value="original">Original CLI colours</option></select></label>
      <label className="setting-toggle"><span>Bypass CLI permissions<small>Default for new chats.</small></span><input type="checkbox" checked={settings.defaultBypass} disabled={busy} onChange={event => void change({ defaultBypass: event.target.checked })} /></label>
    </section><section><h3>Mr. Mak</h3><label>Voice<select disabled={busy} value={settings.voiceName || 'cedar'} onChange={event => void change({ voiceName: event.target.value })}><option value="cedar">Cedar</option><option value="marin">Marin</option></select></label><label>Coordinator reasoning<select disabled={busy} value={settings.coordinatorEffort || 'medium'} onChange={event => void change({ coordinatorEffort: event.target.value as Settings['coordinatorEffort'] })}><option value="medium">Medium</option><option value="high">High</option></select></label><p>Voice changes apply to your next conversation.</p></section>
      <section><h3>Project</h3><p className="settings-repo">{repo}</p><p>Skills, knowledge and processes belong to this repository.</p></section>
      {error && <p className="desk-error-inline" role="alert">{error}</p>}
    </div></div>
}
