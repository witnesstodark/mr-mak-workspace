import { useEffect, useRef, useState } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Icon } from '../desktop/Icons'
import { mobileApi, mobileEvent, onMobileEvent, useMobile } from './client'

export default function Terminal({ id }: { id: string }) {
  const viewport = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), terminalRef = useRef<Xterm | null>(null)
  const state = useMobile(), [error, setError] = useState(''), [fit, setFit] = useState(true)
  const fitRef = useRef(true), layoutRef = useRef<(() => void) | null>(null)
  useEffect(() => { fitRef.current = fit; layoutRef.current?.() }, [fit])
  useEffect(() => {
    if (!host.current) return
    const element = host.current
    const terminal = new Xterm({ disableStdin: true, cursorBlink: false, fontSize: 12, lineHeight: 1.25, fontFamily: 'ui-monospace, monospace', scrollback: 3000, theme: { background: '#101116', foreground: '#dedbe3', cursor: '#c4a7b8' } })
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
        terminal.write(event.data || '', () => { if (current !== generation) return; for (const chunk of queued) if (chunk.sequence > sequence) { terminal.write(chunk.data); sequence = chunk.sequence }; queued = []; ready = true })
      }
      if (event.type === 'output' && event.id === id) {
        if (!ready) { queued.push({ data: event.data || '', sequence: event.sequence || 0 }); return }
        if ((event.sequence || 0) > sequence) { terminal.write(event.data || ''); sequence = event.sequence || 0 }
      }
    })
    subscribe()
    return () => { generation++; off(); observer.disconnect(); layoutRef.current = null; terminal.dispose(); terminalRef.current = null }
  }, [id])
  async function key(value: string) {
    if (value === 'interrupt' && !window.confirm('Interrupt the current task in this chat?')) return
    try { await mobileApi(`/sessions/${id}/key`, { key: value }); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  return <div className="mobile-terminal"><div className="mobile-terminal-hint"><span>Live terminal · pinch to zoom</span><button aria-label={fit ? 'Show terminal at actual size' : 'Fit terminal to screen'} aria-pressed={fit} onClick={() => setFit(!fit)}>{fit ? 'Actual size' : 'Fit to screen'}</button></div><div className="mobile-terminal-viewport" ref={viewport}><div className="mobile-terminal-stage" ref={stage}><div className="mobile-terminal-surface" ref={host} /></div></div><div className="mobile-terminal-keys" role="group" aria-label="Terminal keys">{[['left', 'back', 'Arrow left'], ['up', 'up', 'Arrow up'], ['down', 'down', 'Arrow down'], ['right', 'arrow', 'Arrow right'], ['escape', 'escape', 'Escape'], ['enter', 'enter', 'Enter'], ['tab', 'tab', 'Tab'], ['interrupt', 'stop', 'Stop task']].map(([value, icon, name]) => <button key={value} aria-label={name} title={name} disabled={!state.connected} onClick={() => key(value)}>{value === 'escape' ? 'Esc' : value === 'tab' ? 'Tab' : <Icon name={icon} size={18} />}</button>)}<button aria-label="Copy" title="Copy terminal text" onClick={async () => { const term = terminalRef.current; if (!term) return; const buffer = term.buffer.active; const lines = []; for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) || ''); try { await navigator.clipboard.writeText(term.getSelection() || lines.join('\n')); setError('') } catch { setError('Copy is unavailable in this browser.') } }}><Icon name="copy" size={18} /></button></div>{error && <p className="mobile-error" role="alert">{error}</p>}</div>
}
