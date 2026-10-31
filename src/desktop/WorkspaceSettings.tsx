import { useEffect, useState } from 'react'
import { api, onServiceEvent, useDesktop } from './client'
import type { Settings } from './types'
import { Icon } from './Icons'
import DictationSettings from '../components/DictationSettings'
import { useDictation } from './useDictation'
import ThemePicker from '../components/ThemePicker'
import { isMac, isWindows, shellName } from './platform'
import { IDLE_CACHE_MINUTES, IDLE_CACHE_MIN_TOKENS } from '../../desktop/service/context-alerts.mjs'

type NativeSettings = { available: boolean; winKey: boolean; label?: string; error?: string }
export default function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  const dictation = useDictation()
  const { settings, repo, agents } = useDesktop()
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
    <div className="settings-scroll"><section><h3>Appearance</h3><ThemePicker /><ThemePicker target="chat" /></section><section><h3>{isMac ? 'Shortcut' : 'Windows'}</h3><label className="setting-toggle"><span>{native.label || (isMac ? '⌃⌥⌘Space' : 'Win key')} shows Mr. Mak<small>{isMac ? 'Bring back open windows from any app.' : 'Bring back open windows. Win shortcuts keep working; Ctrl+Esc opens Start.'}</small></span><input type="checkbox" checked={native.winKey} disabled={busy || !native.available} onChange={event => void winKey(event.target.checked)} /></label>{!native.available && <p>{native.error || 'Available in the Windows and macOS desktop app.'}</p>}</section>
    <section><h3>Chats</h3><label>Default agent<select disabled={busy} value={settings.defaultAgent} onChange={event => void change({ defaultAgent: event.target.value as Settings['defaultAgent'] })}><option value="codex">Codex</option><option value="claude">Claude</option><option value="antigravity">Antigravity</option><option value="opencode">OpenCode</option><option value="kimi">Kimi</option><option value="shell">{shellName}</option></select></label>
      <label>Terminal text size<select disabled={busy} value={settings.terminalFontSize || 13} onChange={event => void change({ terminalFontSize: Number(event.target.value) })}>{Array.from({ length: 15 }, (_, i) => i + 10).map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
      <label>Terminal appearance<select disabled={busy} value={settings.terminalAppearance || 'original'} onChange={event => void change({ terminalAppearance: event.target.value as Settings['terminalAppearance'] })}><option value="original">Original CLI colors</option><option value="focus">Mr. Mak Focus · muted colors</option></select></label><p>Original preserves CLI colors, including added and removed lines. Focus uses muted colors. Your choice is saved for all chats and applies immediately without restarting them.</p>
      {isMac && <label className="setting-toggle"><span>Use Option as Meta key<small>Sends Meta shortcuts to the CLI. When off, Option types your keyboard layout's characters, such as @ or #.</small></span><input type="checkbox" checked={!!settings.terminalOptionMeta} disabled={busy} onChange={event => void change({ terminalOptionMeta: event.target.checked })} /></label>}
      <label className="setting-toggle"><span>Bypass CLI permissions<small>Default for new chats.</small></span><input type="checkbox" checked={settings.defaultBypass} disabled={busy} onChange={event => void change({ defaultBypass: event.target.checked })} /></label>
      <label className="setting-toggle"><span>Plan tool<small>Gives new Claude Code, Codex and OpenCode chats a report_plan tool for the Plan panel. When off, they keep the plan in a file instead.</small></span><input type="checkbox" checked={!!settings.planTool} disabled={busy} onChange={event => void change({ planTool: event.target.checked })} /></label>
      <label>Effort advice<select disabled={busy} value={settings.effortAdvice || 'off'} onChange={event => void change({ effortAdvice: event.target.value as Settings['effortAdvice'] })}><option value="off">Off</option><option value="ask">Ask before switching</option><option value="auto">Switch automatically</option></select></label><p>Before a Claude chat's message is sent, a quick Sonnet check names the effort level it needs, adding a few seconds and a little plan usage. Ask holds the message and offers the switch; the footer shows the level at once. On the phone, Ask sends the message as it is.</p>
      <label>Agent CPU priority<select disabled={busy} value={settings.agentPriority || 'below-normal'} onChange={event => void change({ agentPriority: event.target.value as Settings['agentPriority'] })}><option value="normal">Normal</option><option value="below-normal">Below normal · recommended</option><option value="low">Low · only when idle</option></select></label><p>Agents, their tools and MCP servers yield the processor to the apps you are using, so the computer stays responsive with many chats. Applies to running chats too{isWindows ? '' : '; raising it again reaches new chats only'}. {shellName} tabs keep normal priority.</p>
    </section>
    <section><h3>Long chats</h3><label>Suggest compacting<select disabled={busy} value={settings.handoffAfter ?? 40} onChange={event => void change({ handoffAfter: Number(event.target.value) })}>{[[0, 'Off'], [20, 'After 20 messages'], [40, 'After 40 messages'], [60, 'After 60 messages'], [100, 'After 100 messages']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Idle cache alert<select disabled={busy} value={settings.idleCacheMinutes ?? IDLE_CACHE_MINUTES} onChange={event => void change({ idleCacheMinutes: Number(event.target.value) })}>{[[0, 'Off'], [30, 'After 30 min idle'], [45, 'After 45 min idle'], [50, 'After 50 min idle'], [55, 'After 55 min idle']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Idle alert from<select disabled={busy || settings.idleCacheMinutes === 0} value={settings.idleCacheMinTokens ?? IDLE_CACHE_MIN_TOKENS} onChange={event => void change({ idleCacheMinTokens: Number(event.target.value) })}>{[50000, 100000, 150000, 200000, 300000, 500000].map(value => <option key={value} value={value}>{value / 1000}k tokens of context</option>)}</select></label>
      <p>A long chat offers Compact, or a summary in a fresh chat. Claude Code keeps a chat's prompt cache for about an hour after its last request, so an idle Claude chat with a large context offers Compact before the cache expires. Nothing is compacted without your click.</p>
    </section><DictationSettings info={dictation.info} onChange={dictation.choose} /><section><h3>Mr. Mak</h3><label>Voice<select disabled={busy} value={settings.voiceName || 'cedar'} onChange={event => void change({ voiceName: event.target.value })}><option value="cedar">Cedar</option><option value="marin">Marin</option></select></label><label>Coordinator<select disabled={busy} value={settings.coordinatorAgent || 'codex'} onChange={event => void change({ coordinatorAgent: event.target.value as Settings['coordinatorAgent'] })}>{(['codex', 'claude'] as const).map(id => { const agent = agents.find(item => item.id === id); return <option key={id} value={id} disabled={!agent?.available}>{agent?.label || id}{agent?.available ? '' : ' (not installed)'}</option> })}</select></label><label className="setting-toggle"><span>Overseer mode<small>Mr. Mak checks open chats every few minutes, resumes stalled ones and splits large requests across chats.</small></span><input type="checkbox" checked={!!settings.overseer} disabled={busy} onChange={event => void change({ overseer: event.target.checked })} /></label><label>Coordinator reasoning<select disabled={busy} value={settings.coordinatorEffort || 'medium'} onChange={event => void change({ coordinatorEffort: event.target.value as Settings['coordinatorEffort'] })}><option value="medium">Medium</option><option value="high">High</option></select></label><p>Voice changes apply to your next conversation. The coordinator answers Talk to Mr. Mak on that agent's sign-in.</p></section>
      <section><h3>Project</h3><p className="settings-repo">{repo}</p><p>Skills, knowledge and processes belong to this repository.</p></section>
      {error && <p className="desk-error-inline" role="alert">{error}</p>}
    </div></div>
}
