import type { IDecoration, IMarker, ITheme, Terminal } from '@xterm/xterm'
import type { AgentId, TerminalColors } from './types'

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

// The user's colour overrides (Settings → Change terminal colors), saved as
// #rrggbb and laid over either appearance. The service validates the same keys.
export const ansiColorKeys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const
export type AnsiColorKey = typeof ansiColorKeys[number]
// xterm.js's own palette, used where an appearance leaves a colour unset.
const xtermAnsi: Record<AnsiColorKey, string> = {
  black: '#2e3436', red: '#cc0000', green: '#4e9a06', yellow: '#c4a000', blue: '#3465a4', magenta: '#75507b', cyan: '#06989a', white: '#d3d7cf',
  brightBlack: '#555753', brightRed: '#ef2929', brightGreen: '#8ae234', brightYellow: '#fce94f', brightBlue: '#729fcf', brightMagenta: '#ad7fa8', brightCyan: '#34e2e2', brightWhite: '#eeeeec',
}
const opaque = (value: string | undefined) => (value || '').slice(0, 7)

export const terminalTheme = (appearance: TerminalAppearance, colors: TerminalColors = {}) => withTerminalColors(appearance === 'focus' ? focusTheme : originalTheme, colors, appearance === 'focus')
// Also used by the phone's Terminal view over its own base palette.
export function withTerminalColors(base: ITheme, colors: TerminalColors = {}, focus = false): ITheme {
  const theme: ITheme = { ...base }
  // Iaar Focus draws plain text in the agent's colour.
  if (focus && colors.agent) theme.foreground = colors.agent
  // Attention is the CLI's yellow: warnings and prompts that wait for you.
  if (colors.attention) { theme.yellow = colors.attention; theme.brightYellow = colors.attention }
  for (const key of ansiColorKeys) if (colors[key]) theme[key] = colors[key]
  if (colors.background) { theme.background = colors.background; if (focus) theme.cursorAccent = colors.background }
  if (colors.foreground) theme.foreground = colors.foreground
  if (colors.cursor) theme.cursor = colors.cursor
  // Selection stays translucent so selected text remains readable.
  if (colors.selection) theme.selectionBackground = `${colors.selection}55`
  return theme
}
export const terminalRoleColors = (colors: TerminalColors = {}) => ({ user: colors.user || roleColors.user, agent: colors.agent || roleColors.agent, detail: colors.detail || roleColors.detail })

// The colour each setting currently shows, override or not.
export function effectiveTerminalColor(key: string, appearance: TerminalAppearance, colors: TerminalColors = {}) {
  const theme = terminalTheme(appearance, colors)
  if (key === 'background' || key === 'foreground' || key === 'cursor') return opaque(theme[key])
  if (key === 'selection') return opaque(theme.selectionBackground)
  if (key === 'user' || key === 'agent' || key === 'detail') return terminalRoleColors(colors)[key]
  if (key === 'attention') return colors.attention || opaque(theme.yellow) || xtermAnsi.yellow
  return opaque(theme[key as AnsiColorKey]) || xtermAnsi[key as AnsiColorKey] || ''
}

// WCAG contrast ratio of two #rrggbb colours.
export function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
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

export function decorateTerminal(terminal: Terminal, agent: AgentId, colors: Record<TerminalRole, string> = roleColors) {
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
        // permission prompts and diffs readable. The CLI's yellow (warnings and
        // prompts) keeps the theme's Attention colour.
        const paint = cell && !cell.isInverse() && cell.getBgColorMode() === 0 && !(cell.isFgPalette() && (cell.getFgColor() === 3 || cell.getFgColor() === 11))
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
