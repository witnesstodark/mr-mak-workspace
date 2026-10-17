export interface ChatCommand { trigger: '/' | '$'; name: string; description: string; source: 'built-in' | 'project' | 'user' | 'plugin'; terminal?: boolean }
export interface CommandToken { trigger: '/' | '$'; start: number; end: number; query: string }

// The command word being typed at the caret: `/` only opens a message, `$` (Codex skills) may follow any space.
export function commandToken(text: string, caret: number, codex: boolean): CommandToken | null {
  const before = text.slice(0, caret), match = /(^|\s)([/$])([\w:.-]*)$/.exec(before)
  if (!match || /^[^\s]/.test(text.slice(caret))) return null
  const trigger = match[2] as '/' | '$', start = caret - match[3].length - 1
  if (trigger === '/' ? start !== 0 : !codex) return null
  return { trigger, start, end: caret, query: match[3].toLowerCase() }
}

export function matchingCommands(commands: ChatCommand[], token: CommandToken, limit = 8): ChatCommand[] {
  const own = commands.filter(item => item.trigger === token.trigger)
  const starts = own.filter(item => item.name.toLowerCase().startsWith(token.query))
  const contains = own.filter(item => !starts.includes(item) && item.name.toLowerCase().includes(token.query))
  return [...starts, ...contains].slice(0, limit)
}

export function completeCommand(text: string, token: CommandToken, command: ChatCommand) {
  const inserted = `${command.trigger}${command.name} `, rest = text.slice(token.end).replace(/^ /, '')
  return { text: text.slice(0, token.start) + inserted + rest, caret: token.start + inserted.length }
}

// A sent message that runs a picker-style command, which only the terminal can show.
export function terminalCommand(commands: ChatCommand[], text: string) {
  const name = /^\/([\w:.-]+)/.exec(text.trim())?.[1]?.toLowerCase()
  return !!name && commands.some(item => item.trigger === '/' && item.terminal && item.name.toLowerCase() === name)
}
