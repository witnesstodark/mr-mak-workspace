import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, useDesktop } from './client'
import { Icon } from './Icons'
import { ansiColorKeys, contrastRatio, effectiveTerminalColor, terminalRoleColors, terminalTheme, type TerminalAppearance } from './terminalAppearance'
import type { TerminalColors as Colors } from './types'
import './terminal-colors.css'

const hex = /^#[0-9a-f]{6}$/i
const without = (record: Record<string, string>, key: string) => { const next = { ...record }; delete next[key]; return next }
const base: [string, string][] = [['background', 'Background'], ['foreground', 'Text'], ['cursor', 'Cursor'], ['selection', 'Selection']]
const roles: [string, string][] = [['user', 'You'], ['agent', 'Agent'], ['detail', 'Details'], ['attention', 'Attention']]
const ansi: [string, string][] = ansiColorKeys.map(key => [key, key.startsWith('bright') ? `Bright ${key.slice(6).toLowerCase()}` : key[0].toUpperCase() + key.slice(1)])

// Overrides are saved as #rrggbb in settings.terminalColors and laid over the
// selected appearance in every open terminal, on the desktop and the phone.
export default function TerminalColors({ onClose }: { onClose: () => void }) {
  const { settings } = useDesktop()
  const [colors, setColors] = useState<Colors>(() => settings.terminalColors || {})
  const [preview, setPreview] = useState<TerminalAppearance>(settings.terminalAppearance || 'original')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const pending = useRef<Colors | null>(null), timer = useRef(0)
  const flush = () => {
    clearTimeout(timer.current)
    const next = pending.current; pending.current = null
    if (next) api('/settings', { terminalColors: next }).then(() => setError('')).catch(err => setError(err instanceof Error ? err.message : String(err)))
  }
  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush })
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('keydown', escape); flushRef.current() }
  }, [onClose])
  // A colour picker reports every movement; terminals follow after a short pause.
  function save(next: Colors) {
    setColors(next); pending.current = next
    clearTimeout(timer.current); timer.current = window.setTimeout(() => flushRef.current(), 180)
  }
  const setColor = (key: string, value: string) => {
    const next = { ...colors }
    if (value) next[key] = value.toLowerCase(); else delete next[key]
    save(next)
  }
  const effective = (key: string) => effectiveTerminalColor(key, preview, colors)
  const theme = terminalTheme(preview, colors), role = terminalRoleColors(colors), focus = preview === 'focus'
  const ratio = contrastRatio(effective('foreground'), effective('background'))
  const custom = Object.keys(colors).length
  const row = ([key, label]: [string, string]) => {
    const value = effective(key), draft = drafts[key]
    return <div className="terminal-color-row" key={key}>
      <span className="terminal-color-label">{label}{colors[key] && <small>Custom</small>}</span>
      <input type="color" aria-label={`${label} color`} value={value} onChange={event => { setDrafts(current => without(current, key)); setColor(key, event.target.value) }} />
      <input className={`terminal-color-hex ${draft !== undefined && !hex.test(draft) ? 'invalid' : ''}`} aria-label={`${label} hex`} aria-invalid={draft !== undefined && !hex.test(draft)} spellCheck={false} maxLength={7} value={draft ?? value}
        onChange={event => { const text = event.target.value.trim(); setDrafts(current => ({ ...current, [key]: text })); if (hex.test(text)) setColor(key, text) }}
        onBlur={() => setDrafts(current => without(current, key))} />
      <button type="button" className="terminal-color-reset" disabled={!colors[key]} aria-label={`Reset ${label}`} title="Reset to the appearance's colour" onClick={() => setColor(key, '')}><Icon name="refresh" size={14} /></button>
    </div>
  }
  // Outside the settings panel, so none of its header or footer styles apply.
  return createPortal(<div className="terminal-colors-scrim" onClick={onClose}>
    <section className="terminal-colors-dialog" role="dialog" aria-modal="true" aria-label="Terminal colors" onClick={event => event.stopPropagation()}>
      <header><div><h2>Terminal colors</h2><p>Laid over Original and Iaar Focus. Open chats change at once; nothing restarts.</p></div><button className="desk-icon" aria-label="Close terminal colors" onClick={onClose}><Icon name="close" size={17} /></button></header>
      <div className="terminal-colors-body">
        <div className="terminal-color-preview-wrap">
          <div className="terminal-color-preview-switch" role="group" aria-label="Preview appearance">{([['original', 'Original'], ['focus', 'Iaar Focus']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={preview === value} onClick={() => setPreview(value)}>{label}</button>)}</div>
          <div className="terminal-color-preview" aria-label="Preview" style={{ background: theme.background, color: theme.foreground }}>
            <div style={{ color: focus ? role.user : theme.foreground }}>❯ Make the banner warmer</div>
            <div style={{ color: focus ? role.agent : theme.foreground }}>● I'll update the banner colours.</div>
            <div style={{ color: focus ? role.detail : theme.brightBlack }}>  ⎿ Read src/styles/banner.css</div>
            <div style={{ color: role.attention }}>  Needs your decision: warm or cold?</div>
            <div style={{ color: theme.yellow }}>  Do you want to make this edit?</div>
            <div><span style={{ background: theme.selectionBackground }}>selected text</span> <span style={{ color: theme.green }}>+ added</span> <span style={{ color: theme.red }}>- removed</span> <span className="terminal-color-cursor" style={{ background: theme.cursor }} /></div>
            <div className="terminal-color-ansi" aria-hidden="true">{ansi.map(([key]) => <i key={key} style={{ background: effective(key) }} />)}</div>
          </div>
          {ratio < 4.5 && <p className="terminal-color-warning" role="status"><Icon name="bell" size={13} />Text on this background has a contrast of {ratio.toFixed(1)}:1. 4.5:1 or more is easier to read.</p>}
        </div>
        <div className="terminal-color-groups">
          <h3>Terminal</h3>{base.map(row)}
          <h3>Roles</h3><p className="terminal-color-note">You, Agent and Details colour lines in Iaar Focus. Attention colours the blocks an agent starts with "Needs your decision:", "For your review:", "Questions for you:" or "Flag:", in both appearances. The CLI's own yellow prompts use Yellow under All CLI colours.</p>{roles.map(row)}
          <details className="terminal-color-ansi-list"><summary>All CLI colours <small>16 ANSI colours</small></summary>{ansi.map(row)}</details>
        </div>
      </div>
      <footer><span>{custom ? `${custom} custom colour${custom === 1 ? '' : 's'}` : 'Using the appearance colours'}</span><button type="button" disabled={!custom} onClick={() => { setDrafts({}); save({}) }}>Reset all</button><button type="button" className="terminal-colors-done" onClick={onClose}>Done</button></footer>
      {error && <p className="desk-error-inline" role="alert">{error}</p>}
    </section>
  </div>, document.body)
}
