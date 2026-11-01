import { useEffect, useRef, useState } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Icon } from '../desktop/Icons'
import { mobileChatPosition, saveMobileChatPosition } from './app-state'
import { mobileApi, mobileEvent, onMobileEvent, useMobile } from './client'
import { withTerminalColors } from '../desktop/terminalAppearance'

const phoneTheme = { background: '#101116', foreground: '#dedbe3', cursor: '#c4a7b8' }

export default function Terminal({ id }: { id: string }) {
  const viewport = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), terminalRef = useRef<Xterm | null>(null)
  const state = useMobile(), [error, setError] = useState(''), [fit, setFit] = useState(() => mobileChatPosition(id).terminalFit !== false)
  // A fullscreen CLI (such as Claude's fullscreen view) keeps its history itself:
  // the terminal holds one screen, so page keys scroll the CLI instead.
  const [fullscreen, setFullscreen] = useState(false)
  // Colours chosen on the desktop (Settings → Change terminal colors), applied live.
  const colorKey = JSON.stringify(state.terminalColors || {}), theme = withTerminalColors(phoneTheme, state.terminalColors)
  const fitRef = useRef(fit), layoutRef = useRef<(() => void) | null>(null)
  useEffect(() => { fitRef.current = fit; saveMobileChatPosition(id, { terminalFit: fit }); layoutRef.current?.() }, [fit, id])
  useEffect(() => {
    if (!host.current) return
    const element = host.current
    // Holds the service's whole retained scrollback (3000 lines plus the screen).
    const terminal = new Xterm({ disableStdin: true, cursorBlink: false, fontSize: 12, lineHeight: 1.25, fontFamily: 'ui-monospace, monospace', scrollback: 5000, theme: phoneTheme })
    terminal.loadAddon(new WebLinksAddon((event, text) => { event.preventDefault(); try { const url = new URL(text); if (['http:', 'https:'].includes(url.protocol)) window.open(url.href, '_blank', 'noopener,noreferrer') } catch { /* Invalid terminal link. */ } }))
    terminal.open(element); terminalRef.current = terminal
    const layout = () => {
      if (!viewport.current || !stage.current || !element.offsetWidth) return
      const available = Math.max(1, viewport.current.clientWidth - 16)
      const scale = fitRef.current ? Math.min(1, available / element.offsetWidth) : 1
      element.style.transform = `scale(${scale})`
      stage.current.style.width = `${element.offsetWidth * scale}px`
      stage.current.style.height = `${element.offsetHeight * scale}px`
      if (fitRef.current) viewport.current.scrollLeft = 0
    }
    layoutRef.current = layout
    const observer = new ResizeObserver(layout)
    if (viewport.current) observer.observe(viewport.current)
    observer.observe(element)
    let ready = false, sequence = -1, queued: { data: string; sequence: number }[] = [], generation = 0
    const buffer = terminal.buffer.onBufferChange(active => setFullscreen(active.type === 'alternate'))
    const scroll = terminal.onScroll(line => { if (ready) saveMobileChatPosition(id, { terminalLine: line, terminalFollow: terminal.buffer.active.viewportY >= terminal.buffer.active.baseY }) })
    const subscribe = () => { ready = false; generation++; queued = []; mobileEvent({ type: 'subscribe', id }) }
    const off = onMobileEvent(event => {
      if (event.type === 'connected' || (['screen-cleared', 'terminal-resized'].includes(event.type) && event.id === id)) subscribe()
      if (event.type === 'disconnected') ready = false
      if (event.type === 'snapshot' && event.session?.id === id) {
        const current = generation; sequence = event.sequence || 0
        terminal.reset(); terminal.resize(event.session.cols, event.session.rows)
        element.style.width = `${Math.ceil(event.session.cols * 7.3 + 16)}px`
        element.style.height = `${Math.ceil(event.session.rows * 15 + 5)}px`
        layout()
        terminal.write(event.data || '', () => { if (current !== generation) return; for (const chunk of queued) if (chunk.sequence > sequence) { terminal.write(chunk.data); sequence = chunk.sequence }; queued = []; const saved = mobileChatPosition(id); if (saved.terminalFollow === false) terminal.scrollToLine(saved.terminalLine || 0); else terminal.scrollToBottom(); ready = true })
      }
      if (event.type === 'output' && event.id === id) {
        if (!ready) { queued.push({ data: event.data || '', sequence: event.sequence || 0 }); return }
        if ((event.sequence || 0) > sequence) { terminal.write(event.data || ''); sequence = event.sequence || 0 }
      }
    })
    subscribe()
    return () => { generation++; off(); scroll.dispose(); buffer.dispose(); observer.disconnect(); layoutRef.current = null; terminal.dispose(); terminalRef.current = null }
  }, [id])
  // Runs after the terminal exists, so the first snapshot already has these colours.
  useEffect(() => { if (terminalRef.current) terminalRef.current.options.theme = withTerminalColors(phoneTheme, JSON.parse(colorKey)) }, [colorKey, id])
  async function key(value: string) {
    if (value === 'interrupt' && !window.confirm('Interrupt the current task in this chat?')) return
    try { await mobileApi(`/sessions/${id}/key`, { key: value }); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  return <div className="mobile-terminal" style={{ background: theme.background }}><div className="mobile-terminal-hint"><span>{fullscreen ? 'Fullscreen CLI · page through its history' : 'Live terminal · pinch to zoom'}</span>{fullscreen && <><button aria-label="Page up in the CLI" title="Scroll the CLI's history up" disabled={!state.connected} onClick={() => key('pageup')}>Page up</button><button aria-label="Page down in the CLI" title="Scroll the CLI's history down" disabled={!state.connected} onClick={() => key('pagedown')}>Page down</button></>}<button aria-label={fit ? 'Show terminal at actual size' : 'Fit terminal to screen'} aria-pressed={fit} onClick={() => setFit(!fit)}>{fit ? 'Actual size' : 'Fit to screen'}</button></div><div className="mobile-terminal-viewport" ref={viewport}><div className="mobile-terminal-stage" ref={stage}><div className="mobile-terminal-surface" ref={host} /></div></div><div className="mobile-terminal-keys" role="group" aria-label="Terminal keys">{[['left', 'back', 'Arrow left'], ['up', 'up', 'Arrow up'], ['down', 'down', 'Arrow down'], ['right', 'arrow', 'Arrow right'], ['escape', 'escape', 'Escape'], ['enter', 'enter', 'Enter'], ['tab', 'tab', 'Tab'], ['interrupt', 'stop', 'Stop task']].map(([value, icon, name]) => <button key={value} aria-label={name} title={name} disabled={!state.connected} onClick={() => key(value)}>{value === 'escape' ? 'Esc' : value === 'tab' ? 'Tab' : <Icon name={icon} size={18} />}</button>)}<button aria-label="Copy" title="Copy terminal text" onClick={async () => { const term = terminalRef.current; if (!term) return; const buffer = term.buffer.active; const lines = []; for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) || ''); try { await navigator.clipboard.writeText(term.getSelection() || lines.join('\n')); setError('') } catch { setError('Copy is unavailable in this browser.') } }}><Icon name="copy" size={18} /></button></div>{error && <p className="mobile-error" role="alert">{error}</p>}</div>
}
