import type { IDecoration, IMarker, ITheme, Terminal } from '@xterm/xterm'
import type { AgentId } from './types'
import { themePalette, themeVariables, type PaletteId } from '../../desktop/service/appearance.mjs'

export type TerminalAppearance = 'focus' | 'original'
export type TerminalRole = 'user' | 'agent' | 'detail'
export const roleColors = { user: '#a7c5df', agent: '#ecece9', detail: '#90949f' }
export const originalTheme: ITheme = {
  background: '#0c0d10', foreground: '#d7d8e1', cursor: '#f0a0b0', selectionBackground: '#f0a0b036',
  black: '#252731', red: '#ed8a95', green: '#88d8bf', yellow: '#e6c88d', blue: '#89b7ed',
  magenta: '#b3a3f7', cyan: '#84c9d1', white: '#d7d8e1', brightBlack: '#727582', brightWhite: '#ffffff',
}
export const focusTheme: ITheme = {
  background: '#0c0d10', foreground: roleColors.agent, cursor: '#bed0df', cursorAccent: '#0c0d10', selectionBackground: '#a7c5df35',
  black: '#252731', brightBlack: '#90949f', white: '#d9dce1', brightWhite: '#f5f5f0',
  red: '#ce9b9f', brightRed: '#deb0b4', green: '#a6b9ae', brightGreen: '#bdcfc4',
  yellow: '#beb5a0', brightYellow: '#d4c9af', blue: '#a3b8cd', brightBlue: '#b5cadf',
  magenta: '#b9a9c2', brightMagenta: '#c8b9d0', cyan: '#a4babf', brightCyan: '#bacdd0',
  extendedAnsi: Array.from({ length: 240 }, (_, index) => {
    if (index >= 216) { const gray = (8 + (index - 216) * 10).toString(16).padStart(2, '0'); return `#${gray}${gray}${gray}` }
    return '#b8bec6'
  }),
}

export function terminalRoleColors(theme: PaletteId) {
  if (theme === 'dark') return roleColors
  const palette = themePalette(theme)
  return { user: palette.secondary, agent: palette.text, detail: palette.muted }
}

export function terminalTheme(appearance: TerminalAppearance, theme: PaletteId): ITheme {
  const base = appearance === 'focus' ? focusTheme : originalTheme
  if (theme === 'dark') return base
  const palette = themePalette(theme), variables = themeVariables(theme)
  return {
    ...base,
    background: palette.bg, foreground: palette.text, cursor: palette.accent, cursorAccent: palette.bg,
    selectionBackground: palette.accent + '44',
    black: palette.scheme === 'light' ? palette.text : palette.raised,
    brightBlack: palette.muted, white: palette.text, brightWhite: palette.scheme === 'light' ? palette.text : '#fafaf7',
    red: variables['--red'], brightRed: variables['--red'], green: variables['--green'], brightGreen: variables['--green'],
    yellow: variables['--amber'], brightYellow: variables['--amber'], blue: variables['--blue'], brightBlue: variables['--blue'],
    magenta: palette.secondary, brightMagenta: palette.secondary, cyan: palette.accent, brightCyan: palette.accent,
  }
}

// Presentation cues in the native CLI, not a conversation parser. Never change
// terminal bytes, copied text, cursor movement or the agent's context.
export function terminalRoles(lines: { text: string; wrapped?: boolean }[], agent: AgentId): TerminalRole[] {
  let role: TerminalRole = 'agent'
  return lines.map(({ text, wrapped }) => {
    if (!text.trim() || wrapped) return role
    if (agent === 'codex') {
      if (/^›(?:\s|$)/u.test(text)) role = 'user'
      else if (/^•\s/u.test(text)) role = /^•\s+(?:Ran|Running|Read|Viewed|Searched|Explored|Edited|Added|Deleted|Updated|Called|Calling|Opened|Listed|Used)\b/u.test(text) ? 'detail' : 'agent'
      else if (/^\s*[└│├]/u.test(text)) return 'detail'
      else if (/^\s*(?:[─━]{5,}|gpt-[\w.-]+\s|\? for shortcuts|Tip:|Context left:)/u.test(text)) return 'detail'
    } else if (agent === 'claude') {
      if (/^[❯>](?:\s|$)/u.test(text)) role = 'user'
      else if (/^[⏺●]\s/u.test(text)) role = /^[⏺●]\s+(?:Bash|Read|Write|Edit|Update|Search|Grep|Glob|Task|Agent|Skill|WebFetch|WebSearch|Fetch|NotebookEdit|TodoWrite)\s*\(/u.test(text) ? 'detail' : 'agent'
      else if (/^\s*[⎿└│├]/u.test(text)) return 'detail'
      else if (/^\s*(?:[─━]{5,}|[✻✽✶✳✢·]\s|\? for shortcuts|bypass permissions|accept edits)/u.test(text)) return 'detail'
    }
    return role
  })
}

type RowDecoration = { marker: IMarker; decorations: IDecoration[]; signature: string }

export function decorateTerminal(terminal: Terminal, agent: AgentId, colors = roleColors) {
  if (agent !== 'codex' && agent !== 'claude') return () => {}
  let rows: RowDecoration[] = [], timer = 0, disposed = false
  const remove = (row: RowDecoration) => { row.decorations.forEach(item => item.dispose()); row.marker.dispose() }
  const clear = () => { rows.forEach(remove); rows = [] }
  const draw = () => {
    timer = 0
    if (disposed) return
    const buffer = terminal.buffer.active
    if (buffer.type !== 'normal') { clear(); return }
    const from = Math.max(0, buffer.viewportY - 350), end = Math.min(buffer.length, buffer.viewportY + terminal.rows)
    const lines = Array.from({ length: end - from }, (_, offset) => {
      const line = buffer.getLine(from + offset)
      return { text: line?.translateToString(true) || '', wrapped: line?.isWrapped }
    })
    const roles = terminalRoles(lines, agent)
    const previous = new Map(rows.filter(row => !row.marker.isDisposed).map(row => [row.marker.line, row]))
    const next: RowDecoration[] = []
    for (let y = buffer.viewportY; y < end; y++) {
      const line = buffer.getLine(y)
      if (!line) continue
      const color = colors[roles[y - from]]
      const spans: { start: number; width: number }[] = []
      let start = -1
      for (let x = 0; x <= terminal.cols; x++) {
        const cell = x < terminal.cols ? line.getCell(x) : undefined
        // Keep inverse selections and explicit backgrounds in native menus,
        // permission prompts and diffs readable.
        const paint = cell && !cell.isInverse() && cell.getBgColorMode() === 0
        if (paint && start < 0) start = x
        if (!paint && start >= 0) { spans.push({ start, width: x - start }); start = -1 }
      }
      const signature = color + ':' + spans.map(span => `${span.start},${span.width}`).join(';')
      const old = previous.get(y)
      previous.delete(y)
      if (old?.signature === signature) { next.push(old); continue }
      if (old) remove(old)
      const marker = terminal.registerMarker(y - (buffer.baseY + buffer.cursorY))
      if (!marker) continue
      const decorations = spans.flatMap(span => {
        const decoration = terminal.registerDecoration({ marker, x: span.start, width: span.width, foregroundColor: color, layer: 'bottom' })
        return decoration ? [decoration] : []
      })
      next.push({ marker, decorations, signature })
    }
    previous.forEach(remove)
    rows = next
  }
  const schedule = () => { if (!disposed && !timer) timer = window.setTimeout(draw, 60) }
  const events = [terminal.onWriteParsed(schedule), terminal.onScroll(schedule), terminal.onResize(() => { clear(); schedule() })]
  schedule()
  return () => { disposed = true; clearTimeout(timer); events.forEach(item => item.dispose()); clear() }
}
