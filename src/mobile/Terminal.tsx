import { useEffect, useRef, useState } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Icon } from '../desktop/Icons'
import { mobileChatPosition, saveMobileChatPosition, type TerminalView } from './app-state'
import { mobileApi, mobileEvent, onMobileEvent, useMobile } from './client'

// Reading text for the phone. The CLI draws for the desktop's column width, so
// the terminal cannot be re-wrapped; its rows become text the browser wraps.
// Soft-wrapped rows are joined, box padding and long rules are shortened.
function terminalText(term: Xterm, limit = 2000) {
  const buffer = term.buffer.active, lines: string[] = []
  for (let index = Math.max(0, buffer.length - limit); index < buffer.length; index++) {
    const line = buffer.getLine(index)
    if (!line) continue
    const text = line.translateToString(!buffer.getLine(index + 1)?.isWrapped)
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text
    else lines.push(text)
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.map(line => line.replace(/\s+[│┃║]\s*$/, '').replace(/[─━═]{6,}/g, '──────').trimEnd()).join('\n')
}

export default function Terminal({ id }: { id: string }) {
  const viewport = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), terminalRef = useRef<Xterm | null>(null)
  const state = useMobile(), [error, setError] = useState(''), [view, setView] = useState<TerminalView>(() => mobileChatPosition(id).terminalView || 'wrap')
  const text = useRef<HTMLPreElement>(null), reader = useRef<HTMLDivElement>(null)
  const fitRef = useRef(view === 'fit'), viewRef = useRef(view), layoutRef = useRef<(() => void) | null>(null), readRef = useRef<((jump?: boolean) => void) | null>(null)
  useEffect(() => { fitRef.current = view === 'fit'; viewRef.current = view; saveMobileChatPosition(id, { terminalView: view }); layoutRef.current?.(); readRef.current?.(true) }, [view, id])
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
    let frame = 0
    // Rebuild the reading text at most once per frame, keeping the reader at the end when it was there.
    const read = (jump = false) => {
      if (viewRef.current !== 'wrap' || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const box = reader.current
        if (!box || !text.current) return
        const atEnd = jump || box.scrollHeight - box.scrollTop - box.clientHeight < 80
        text.current.textContent = terminalText(terminal)
        if (atEnd) box.scrollTop = box.scrollHeight
      })
    }
    readRef.current = read
    const parsed = terminal.onWriteParsed(() => read())
    const observer = new ResizeObserver(layout)
    if (viewport.current) observer.observe(viewport.current)
    observer.observe(element)
    let ready = false, sequence = -1, queued: { data: string; sequence: number }[] = [], generation = 0
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
        terminal.write(event.data || '', () => { if (current !== generation) return; for (const chunk of queued) if (chunk.sequence > sequence) { terminal.write(chunk.data); sequence = chunk.sequence }; queued = []; const saved = mobileChatPosition(id); if (saved.terminalFollow === false) terminal.scrollToLine(saved.terminalLine || 0); else terminal.scrollToBottom(); ready = true; read(true) })
      }
      if (event.type === 'output' && event.id === id) {
        if (!ready) { queued.push({ data: event.data || '', sequence: event.sequence || 0 }); return }
        if ((event.sequence || 0) > sequence) { terminal.write(event.data || ''); sequence = event.sequence || 0 }
      }
    })
    subscribe()
    return () => { generation++; off(); scroll.dispose(); parsed.dispose(); cancelAnimationFrame(frame); observer.disconnect(); layoutRef.current = null; readRef.current = null; terminal.dispose(); terminalRef.current = null }
  }, [id])
  async function key(value: string) {
    if (value === 'interrupt' && !window.confirm('Interrupt the current task in this chat?')) return
    try { await mobileApi(`/sessions/${id}/key`, { key: value }); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  return <div className="mobile-terminal"><div className="mobile-terminal-hint"><span>{view === 'wrap' ? 'Live terminal · lines wrap to your screen' : 'Live terminal · pinch to zoom'}</span><div className="mobile-terminal-views" role="group" aria-label="Terminal text">{([['wrap', 'Wrap', 'Wrap lines to the screen'], ['fit', 'Fit', 'Fit terminal to screen'], ['actual', 'Actual', 'Show terminal at actual size']] as const).map(([value, label, name]) => <button key={value} aria-label={name} title={name} aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}</div></div>{view === 'wrap' && <div className="mobile-terminal-reader" ref={reader}><pre ref={text} /></div>}<div className={`mobile-terminal-viewport ${view === 'wrap' ? 'reading' : ''}`} ref={viewport} aria-hidden={view === 'wrap'}><div className="mobile-terminal-stage" ref={stage}><div className="mobile-terminal-surface" ref={host} /></div></div><div className="mobile-terminal-keys" role="group" aria-label="Terminal keys">{[['left', 'back', 'Arrow left'], ['up', 'up', 'Arrow up'], ['down', 'down', 'Arrow down'], ['right', 'arrow', 'Arrow right'], ['escape', 'escape', 'Escape'], ['enter', 'enter', 'Enter'], ['tab', 'tab', 'Tab'], ['interrupt', 'stop', 'Stop task']].map(([value, icon, name]) => <button key={value} aria-label={name} title={name} disabled={!state.connected} onClick={() => key(value)}>{value === 'escape' ? 'Esc' : value === 'tab' ? 'Tab' : <Icon name={icon} size={18} />}</button>)}<button aria-label="Copy" title="Copy terminal text" onClick={async () => { const term = terminalRef.current; if (!term) return; const buffer = term.buffer.active; const lines = []; for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) || ''); try { await navigator.clipboard.writeText((view === 'wrap' ? window.getSelection()?.toString() : term.getSelection()) || lines.join('\n')); setError('') } catch { setError('Copy is unavailable in this browser.') } }}><Icon name="copy" size={18} /></button></div>{error && <p className="mobile-error" role="alert">{error}</p>}</div>
}
