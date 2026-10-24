import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { api, onServiceEvent, pickFiles, reportError, sendEvent, uploadImage } from './client'
import { Icon } from './Icons'
import type { AgentId } from './types'
import { decorateTerminal, originalTheme, terminalTheme, terminalRoleColors, type TerminalAppearance } from './terminalAppearance'
import { useWorkspaceTheme } from '../lib/workspace-theme'
import { fileManager, isMac, modKey, modLabel } from './platform'
import { deferredClipboardWrite, terminalClipboardGate, terminalCopyWindow, type PendingCopy } from './terminalClipboard'

export default function TerminalPane({ id, agent, fontSize, appearance, optionMeta, onAttachmentStatus }: { id: string; agent: AgentId; fontSize: number; appearance: TerminalAppearance; optionMeta: boolean; onAttachmentStatus: (id: string, text: string) => void }) {
  const { resolved } = useWorkspaceTheme('chat')
  const host = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [dragging, setDragging] = useState(false)
  const statusTimer = useRef(0)
  const uploading = useRef(false)
  const choosing = useRef(false)
  async function pasteImages(files: File[]) {
    if (!files.length || uploading.current) return
    clearTimeout(statusTimer.current)
    uploading.current = true; setDragging(false); onAttachmentStatus(id, 'Saving image to inbox…')
    try {
      if (files.length > 12) throw new Error('Attach up to 12 images at a time.')
      const paths: string[] = []
      for (const file of files) paths.push((await uploadImage(file)).path)
      await api(`/sessions/${id}/attach`, { paths })
      onAttachmentStatus(id, `${paths.length === 1 ? 'Image' : `${paths.length} images`} saved in inbox · path inserted`)
      terminalRef.current?.focus()
    } catch (error) { onAttachmentStatus(id, 'Image was not attached'); reportError(error) }
    finally { uploading.current = false; clearTimeout(statusTimer.current); statusTimer.current = window.setTimeout(() => onAttachmentStatus(id, ''), 1600) }
  }
  async function attachPaths(paths: string[]) {
    if (!paths.length || uploading.current) return
    clearTimeout(statusTimer.current)
    uploading.current = true; setDragging(false)
    try {
      await api(`/sessions/${id}/attach`, { paths })
      onAttachmentStatus(id, `${paths.length === 1 ? 'Path' : `${paths.length} paths`} inserted`)
      terminalRef.current?.focus()
    } catch (error) { onAttachmentStatus(id, 'Paths were not inserted'); reportError(error) }
    finally { uploading.current = false; clearTimeout(statusTimer.current); statusTimer.current = window.setTimeout(() => onAttachmentStatus(id, ''), 1600) }
  }
  const pasteImagesRef = useRef(pasteImages), attachPathsRef = useRef(attachPaths)
  useEffect(() => { pasteImagesRef.current = pasteImages; attachPathsRef.current = attachPaths })
  useEffect(() => {
    const nativeDrop = (event: Event) => {
      const detail = (event as CustomEvent<{ phase: string; paths?: string[]; x?: number; y?: number }>).detail
      if (!detail) return
      if (detail.phase === 'leave') { setDragging(false); return }
      if (!Number.isFinite(detail.x) || !Number.isFinite(detail.y)) return
      const target = document.elementFromPoint(detail.x!, detail.y!)
      // Do not attach through History, the voice overlay or another control.
      const inside = !!target && !!area.current?.contains(target)
      setDragging(detail.phase !== 'drop' && inside)
      if (detail.phase === 'drop' && inside) void attachPathsRef.current(detail.paths || [])
    }
    const pick = async () => {
      if (choosing.current) return
      choosing.current = true
      // Keep the initiating chat, even if another tab is selected during the picker.
      const attach = attachPathsRef.current
      try { await attach(await pickFiles()) } catch (error) { reportError(error) }
      finally { choosing.current = false }
    }
    window.addEventListener('mrmak-file-drop', nativeDrop)
    window.addEventListener('mrmak-attach-file', pick)
    return () => { window.removeEventListener('mrmak-file-drop', nativeDrop); window.removeEventListener('mrmak-attach-file', pick) }
  }, [id])
  useEffect(() => {
    if (!host.current) return
    const openLink = (event: MouseEvent, text: string) => {
      event.preventDefault()
      try {
        const url = new URL(text)
        if (url.protocol === 'https:' || url.protocol === 'http:') window.open(url.href, '_blank', 'noopener,noreferrer')
      } catch { /* Invalid terminal text is not a web link. */ }
    }
    // Automatic focus leaves a text field the person is typing in elsewhere, such as a tab rename.
    const focusIdle = () => {
      const active = document.activeElement as HTMLElement | null
      if (active && !host.current?.contains(active) && (active.matches('input, textarea, select') || active.isContentEditable)) return
      terminal.focus()
    }
    const terminal = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace', fontSize: 13, lineHeight: 1.18,
      cursorBlink: true, cursorStyle: 'bar', scrollback: 3000, allowTransparency: false, allowProposedApi: true,
      theme: originalTheme,
      // macOS: Option types the layout's characters (@, {, | on many non-US layouts),
      // as in Terminal.app. Settings can turn it into Meta; see the effect below.
      macOptionIsMeta: false,
      // xterm forces a selection over terminal mouse tracking with Shift elsewhere, Option+click on macOS.
      macOptionClickForcesSelection: true,
      linkHandler: { activate: openLink },
    })
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.loadAddon(new WebLinksAddon(openLink)); terminal.open(host.current)
    terminalRef.current = terminal; fitRef.current = fit
    let sequence = -1
    let ready = false
    let queued: { sequence: number; data: string }[] = []
    const clipboardGate = terminalClipboardGate(), element = host.current
    // macOS only: the clipboard write must start inside the gesture (see deferredClipboardWrite).
    let pendingCopy: PendingCopy | null = null, pendingTimer = 0
    const dropCopy = () => { clearTimeout(pendingTimer); pendingCopy?.cancel(); pendingCopy = null }
    const arm = (event: Event, deferred = true) => {
      clipboardGate.arm(event.isTrusted)
      if (!isMac || !event.isTrusted) return
      dropCopy()
      if (!deferred) return
      pendingCopy = deferredClipboardWrite(navigator.clipboard, reportError)
      pendingTimer = window.setTimeout(dropCopy, terminalCopyWindow)
    }
    let pointer: { x: number; y: number } | null = null
    const selectionStart = (event: PointerEvent) => { pointer = event.isTrusted && event.button === 0 ? { x: event.clientX, y: event.clientY } : null }
    const selectionEnd = (event: PointerEvent) => {
      if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3) arm(event)
      pointer = null
    }
    // Cmd+C with a selection already writes it synchronously below; do not race it.
    const copyGesture = (event: KeyboardEvent) => { if (modKey(event) && event.key.toLowerCase() === 'c') arm(event, !terminal.hasSelection()) }
    const multipleClick = (event: MouseEvent) => { if (event.detail >= 2) arm(event) }
    const cancelCopy = () => { pointer = null; clipboardGate.clear(); dropCopy() }
    element.addEventListener('pointerdown', selectionStart, true)
    element.addEventListener('pointerup', selectionEnd, true)
    element.addEventListener('keydown', copyGesture, true)
    element.addEventListener('click', multipleClick, true)
    window.addEventListener('blur', cancelCopy)
    document.addEventListener('visibilitychange', cancelCopy)
    const clipboard = terminal.parser.registerOscHandler(52, data => {
      const text = clipboardGate.read(data, ready, document.visibilityState === 'visible' && document.hasFocus() && element.contains(document.activeElement))
      if (text !== null && pendingCopy) { pendingCopy.fill(text); pendingCopy = null; clearTimeout(pendingTimer) }
      else if (text !== null) navigator.clipboard.writeText(text).catch(reportError)
      return true
    })
    const resize = () => {
      if (!host.current?.clientWidth || !host.current?.clientHeight) return
      fit.fit()
      sendEvent({ type: 'resize', id, cols: terminal.cols, rows: terminal.rows })
    }
    const subscribe = () => { ready = false; queued = []; sendEvent({ type: 'subscribe', id }) }
    const off = onServiceEvent(event => {
      if (event.type === 'connected') subscribe()
      if (event.type === 'disconnected') ready = false
      if (event.type === 'screen-cleared' && event.id === id) subscribe()
      if (event.type === 'snapshot' && event.session?.id === id) {
        sequence = event.sequence ?? 0
        terminal.reset()
        terminal.resize(event.session.cols, event.session.rows)
        terminal.write(event.data || '', () => {
          ready = true
          for (const chunk of queued) if (chunk.sequence > sequence) { terminal.write(chunk.data); sequence = chunk.sequence }
          queued = []; resize(); focusIdle()
        })
      }
      if (event.type === 'output' && event.id === id) {
        if (!ready) { queued.push({ data: event.data || '', sequence: event.sequence || 0 }); return }
        if ((event.sequence || 0) > sequence) { terminal.write(event.data || ''); sequence = event.sequence || 0 }
      }
    })
    const input = terminal.onData(data => {
      // Terminal protocol replies intentionally contain ASCII control characters.
      // eslint-disable-next-line no-control-regex
      const deviceReply = /^\x1b\[[?>0-9;]*[RcnIO]$/.test(data) || /^\x1b\][\s\S]*(?:\x07|\x1b\\)$/.test(data)
      if (ready && !deviceReply) sendEvent({ type: 'input', id, data })
    })
    terminal.attachCustomKeyEventHandler(event => {
      // Windows/Linux: agent chats use Ctrl+C exclusively for copy. Even an empty
      // selection must not send ETX to the CLI or terminate its wrapper process.
      // macOS: Cmd+C copies and Ctrl+C reaches the CLI, as in Terminal.app.
      const copy = isMac ? event.metaKey : event.ctrlKey && (agent !== 'shell' || event.shiftKey)
      if (copy && !event.altKey && (event.code === 'KeyC' || event.key.toLowerCase() === 'c')) {
        event.preventDefault(); event.stopPropagation()
        const selection = terminal.getSelection()
        if (event.type === 'keydown' && !event.repeat && selection) navigator.clipboard.writeText(selection).catch(reportError)
        return false
      }
      if (event.type !== 'keydown') return true
      // Leave paste to the DOM clipboard event; do not send Ctrl+V (Cmd+V on macOS) to the CLI.
      if (modKey(event) && (event.code === 'KeyV' || event.key.toLowerCase() === 'v')) return false
      // App shortcuts belong to Chats, not the terminal.
      if ((event.ctrlKey && event.code === 'Tab') || (modKey(event) && event.shiftKey && ['KeyP', 'KeyT', 'KeyH', 'KeyW'].includes(event.code)) || ((isMac ? event.metaKey : event.altKey) && /^Digit[1-9]$/.test(event.code))) return false
      return true
    })
    // Agent TUIs can enable mouse reporting even in the normal buffer. Keep
    // wheel navigation local whenever there is actual scrollback to browse.
    let wheelRemainder = 0
    terminal.attachCustomWheelEventHandler(event => {
      if (agent === 'shell' || event.ctrlKey || !event.deltaY || terminal.buffer.active.type !== 'normal' || !terminal.buffer.active.baseY) return true
      event.preventDefault()
      wheelRemainder += event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * terminal.rows : event.deltaY / (Number(terminal.options.fontSize || 13) * 1.5)
      const lines = Math.trunc(wheelRemainder)
      if (lines) { terminal.scrollLines(lines); wheelRemainder -= lines }
      return false
    })
    const paste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return
      event.preventDefault(); event.stopImmediatePropagation()
      const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'))
      if (images.length) { pasteImagesRef.current(images); return }
      const text = event.clipboardData.getData('text/plain')
      if (text) terminal.paste(text)
    }
    element.addEventListener('paste', paste, true)
    const observer = new ResizeObserver(resize); observer.observe(host.current)
    subscribe()
    const focus = () => focusIdle()
    window.addEventListener('focus', focus)
    return () => {
      off(); input.dispose(); clipboard.dispose(); dropCopy(); observer.disconnect()
      element.removeEventListener('pointerdown', selectionStart, true); element.removeEventListener('pointerup', selectionEnd, true); element.removeEventListener('keydown', copyGesture, true)
      element.removeEventListener('click', multipleClick, true)
      window.removeEventListener('blur', cancelCopy); document.removeEventListener('visibilitychange', cancelCopy)
      element.removeEventListener('paste', paste, true); window.removeEventListener('focus', focus); clearTimeout(statusTimer.current)
      onAttachmentStatus(id, ''); terminal.dispose(); terminalRef.current = null; fitRef.current = null
    }
  }, [id, agent, onAttachmentStatus])
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = terminalTheme(appearance, resolved)
    terminal.options.minimumContrastRatio = 4.5
    if (appearance === 'focus') return decorateTerminal(terminal, agent, terminalRoleColors(resolved))
  }, [id, agent, appearance, resolved])
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.macOptionIsMeta = optionMeta
  }, [id, agent, optionMeta])
  useEffect(() => {
    if (terminalRef.current) { terminalRef.current.options.fontSize = fontSize; fitRef.current?.fit(); sendEvent({ type: 'resize', id, cols: terminalRef.current.cols, rows: terminalRef.current.rows }) }
  }, [fontSize, id])
  useEffect(() => {
    const focus = (event: Event) => { if ((event as CustomEvent<{ id: string }>).detail.id === id) terminalRef.current?.focus() }
    window.addEventListener('mrmak-dictation-inserted', focus)
    return () => window.removeEventListener('mrmak-dictation-inserted', focus)
  }, [id])
  return <div ref={area} className={`terminal-area ${appearance === 'focus' ? 'terminal-focus' : ''}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'none' }} onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); reportError(`Drop original files or folders from ${fileManager} into Mr. Mak Desktop. Paste clipboard images with ${modLabel}V.`) }}>
    <div ref={host} className="terminal-host" aria-label="Interactive agent terminal" />
    {dragging && <div className="terminal-drop"><Icon name="attach" size={30} /><strong>Drop to insert paths</strong><span>Files, folders and images</span></div>}
  </div>
}
