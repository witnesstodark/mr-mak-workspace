import { useEffect, useState } from 'react'
import { api, onServiceEvent, useDesktop } from './client'
import type { Effort, Settings } from './types'
import { defaultEffort, efforts } from './effort'
import { Icon } from './Icons'
import DictationSettings from '../components/DictationSettings'
import { useDictation } from './useDictation'
import ThemePicker from '../components/ThemePicker'
import { isMac, shellName } from './platform'
import { languages, languageSetting, setLanguage, t, useLanguage, type LanguageSetting } from '../lib/i18n'

type NativeSettings = { available: boolean; winKey: boolean; label?: string; error?: string }
export default function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  useLanguage()
  const dictation = useDictation()
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
  return <div className="files-panel workspace-settings"><header><h2>{t('Settings')}</h2><button className="desk-icon" onClick={onClose} aria-label={t('Close settings')}><Icon name="close" size={17} /></button></header>
    <div className="settings-scroll"><section><h3>{t('Language')}</h3><label>{t('Interface language')}<select value={languageSetting()} onChange={event => setLanguage(event.target.value as LanguageSetting)}><option value="auto">{t('Automatic · follows your system')}</option>{languages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label></section><section><h3>{t('Appearance')}</h3><ThemePicker /><ThemePicker target="chat" /></section><section><h3>{isMac ? t('Shortcut') : 'Windows'}</h3><label className="setting-toggle"><span>{native.label || (isMac ? '⌃⌥⌘Space' : t('Win key'))} {t('shows Mr. Mak')}<small>{isMac ? t('Bring back open windows from any app.') : t('Bring back open windows. Win shortcuts keep working; Ctrl+Esc opens Start.')}</small></span><input type="checkbox" checked={native.winKey} disabled={busy || !native.available} onChange={event => void winKey(event.target.checked)} /></label>{!native.available && <p>{native.error || t('Available in the Windows and macOS desktop app.')}</p>}</section>
    <section><h3>{t('Chats')}</h3><label>{t('Default agent')}<select disabled={busy} value={settings.defaultAgent} onChange={event => void change({ defaultAgent: event.target.value as Settings['defaultAgent'] })}><option value="codex">{t('Codex')}</option><option value="claude">{t('Claude')}</option><option value="antigravity">{t('Antigravity')}</option><option value="opencode">{t('OpenCode')}</option><option value="kimi">{t('Kimi')}</option><option value="shell">{shellName}</option></select></label>
      <label>{t('Default reasoning effort')}<select disabled={busy} value={settings.defaultEffort || defaultEffort} onChange={event => void change({ defaultEffort: event.target.value as Effort })}>{efforts.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><p>{t('Applies to new Codex, Claude and Antigravity chats. Mr. Mak still chooses effort for the chats it opens.')}</p>
      <label>{t('Terminal text size')}<select disabled={busy} value={settings.terminalFontSize || 13} onChange={event => void change({ terminalFontSize: Number(event.target.value) })}>{Array.from({ length: 15 }, (_, i) => i + 10).map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
      <label>{t('Terminal appearance')}<select disabled={busy} value={settings.terminalAppearance || 'original'} onChange={event => void change({ terminalAppearance: event.target.value as Settings['terminalAppearance'] })}><option value="original">{t('Original CLI colors')}</option><option value="focus">{t('Mr. Mak Focus · muted colors')}</option></select></label><p>{t('Original preserves CLI colors, including added and removed lines. Focus uses muted colors. Your choice is saved for all chats and applies immediately without restarting them.')}</p>
      {isMac && <label className="setting-toggle"><span>{t('Use Option as Meta key')}<small>{t('Sends Meta shortcuts to the CLI. When off, Option types your keyboard layout\'s characters, such as @ or #.')}</small></span><input type="checkbox" checked={!!settings.terminalOptionMeta} disabled={busy} onChange={event => void change({ terminalOptionMeta: event.target.checked })} /></label>}
      <label className="setting-toggle"><span>{t('Bypass CLI permissions')}<small>{t('Default for new chats.')}</small></span><input type="checkbox" checked={settings.defaultBypass} disabled={busy} onChange={event => void change({ defaultBypass: event.target.checked })} /></label>
    </section><DictationSettings info={dictation.info} onChange={dictation.choose} /><section><h3>{t('Mr. Mak')}</h3><label>{t('Voice')}<select disabled={busy} value={settings.voiceName || 'cedar'} onChange={event => void change({ voiceName: event.target.value })}><option value="cedar">{t('Cedar')}</option><option value="marin">{t('Marin')}</option></select></label><label>{t('Coordinator reasoning')}<select disabled={busy} value={settings.coordinatorEffort || 'medium'} onChange={event => void change({ coordinatorEffort: event.target.value as Settings['coordinatorEffort'] })}><option value="medium">{t('Medium')}</option><option value="high">{t('High')}</option></select></label><p>{t('Voice changes apply to your next conversation.')}</p></section>
      <section><h3>{t('Project')}</h3><p className="settings-repo">{repo}</p><p>{t('Skills, knowledge and processes belong to this repository.')}</p></section>
      {error && <p className="desk-error-inline" role="alert">{error}</p>}
    </div></div>
}
