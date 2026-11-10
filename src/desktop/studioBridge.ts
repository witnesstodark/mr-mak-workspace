// The Game UI Studio runs on an isolated origin of its own and cannot call the
// desktop API. UIStudioFrame relays a few of its Copilot requests through this
// module: list project folders, read and save the studio's own state, start (or
// reuse) a studio chat, send a prompt, read that chat's transcript and its open
// terminal menu, answer that menu and open the chat in Chats.
//
// The frame is not trusted to act for the owner. Anything that reaches a chat
// (starting one, sending a prompt, answering its menu) waits for the owner to
// confirm it in the Workspace window, outside the frame, with the exact text and
// chat shown. Reads go through without a confirmation. Only chats started here
// are reachable, permissions are never bypassed, and replies are trimmed.

export type StudioApi = (path: string, data?: unknown, method?: string) => Promise<unknown>
export interface StudioAgent { id: string; label?: string; available?: boolean }

// What the owner is asked to confirm. `text` is exactly what the chat receives.
export type StudioConfirmation =
  | { kind: 'start'; agent: string; folder: string; effort: string; chat: string; text: string | null }
  | { kind: 'send'; agent: string; folder: string; chat: string; text: string }
  | { kind: 'answer'; agent: string; folder: string; chat: string; question: string; answer: string }

export interface StudioBridgeDeps {
  api: StudioApi
  repo: () => string
  agents: () => StudioAgent[]
  // Resolves true only when the owner chose Send in the Workspace window.
  confirm: (request: StudioConfirmation) => Promise<boolean>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const AGENTS = ['claude', 'codex', 'opencode', 'antigravity']
const EFFORTS = ['medium', 'high', 'xhigh', 'max']
export const CANCELLED = 'Cancelled in Mr. Mak; nothing was sent.'

type Payload = Record<string, unknown>
interface Screen { status?: string; activity?: string; lastOutputAt?: string | null; screen?: string }
interface Prompt { id?: unknown; kind?: unknown; question?: unknown; detail?: unknown; options?: unknown; selected?: unknown; checked?: unknown; input?: unknown; submit?: unknown }
interface Messages { supported?: boolean; messages?: { id?: string; role?: string; text?: string; at?: string }[]; prompt?: Prompt | null }
interface Owned { agent: string; cwd: string; effort: string; name: string }

function text(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${what} is not valid.`)
  return value
}

// Studio paths such as 'projects/Game' resolve inside the repository.
export function resolveFolder(value: string, repo: string): string {
  const folder = value.trim()
  if (!folder) return repo
  if (/^(?:[a-zA-Z]:[\\/]|[\\/]|~(?:[\\/]|$))/.test(folder)) return folder
  const parts = folder.split(/[\\/]+/).filter(part => part && part !== '.')
  if (parts.includes('..')) throw new Error('Choose a folder inside the repository or an absolute path.')
  const separator = repo.includes('\\') ? '\\' : '/'
  return [repo.replace(/[\\/]+$/, ''), ...parts].join(separator)
}

const clip = (value: unknown, max: number) => String(value ?? '').slice(0, max)
const list = (value: unknown, limit: number) => Array.isArray(value) ? value.slice(0, limit) : []
const index = (value: unknown) => Number.isInteger(value) ? value as number : -1

// The menu the agent drew (desktop/service/terminal-prompt.mjs), trimmed for the frame.
function promptView(prompt: Prompt | null | undefined) {
  if (!prompt || typeof prompt.id !== 'string') return null
  const kind = prompt.kind === 'multiple' || prompt.kind === 'scale' ? prompt.kind : 'single'
  return {
    id: prompt.id.slice(0, 80), kind, question: clip(prompt.question, 500),
    detail: list(prompt.detail, 20).map(line => clip(line, 500)),
    options: list(prompt.options, 30).map(option => clip(option, 300)),
    selected: index(prompt.selected), input: index(prompt.input),
    ...(kind === 'multiple' ? { checked: list(prompt.checked, 30).map(Boolean), submit: clip(prompt.submit, 40) } : {}),
  }
}

// The service checks the choice against the menu on screen; this only keeps its shape.
function promptChoice(value: unknown): number | 'cancel' | { checked: number[] } | { text: string } {
  if (value === 'cancel' || Number.isInteger(value)) return value as number | 'cancel'
  const choice = (value && typeof value === 'object' ? value : {}) as { checked?: unknown; text?: unknown }
  if (Array.isArray(choice.checked) && choice.checked.length <= 30 && choice.checked.every(item => Number.isInteger(item))) return { checked: choice.checked as number[] }
  if (typeof choice.text === 'string' && choice.text.trim() && choice.text.length <= 2000) return { text: choice.text }
  throw new Error('Choose one of the listed options.')
}

// The answer as the owner reads it in the confirmation.
function describeChoice(choice: ReturnType<typeof promptChoice>, options: string[]): string {
  const option = (item: number) => {
    if (!Number.isInteger(item) || item < 0 || item >= options.length) throw new Error('Choose one of the listed options.')
    return options[item]
  }
  if (choice === 'cancel') return 'Cancel the menu (Esc)'
  if (typeof choice === 'number') return option(choice)
  if ('checked' in choice) return choice.checked.length ? choice.checked.map(option).join(', ') : 'Nothing checked'
  return choice.text
}

export function createStudioBridge(deps: StudioBridgeDeps) {
  const owned = new Map<string, Owned>()
  const sleep = deps.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const now = deps.now || Date.now
  const path = (id: string, action: string) => `/sessions/${encodeURIComponent(id)}/${action}`
  const screen = (id: string) => deps.api(path(id, 'screen')) as Promise<Screen>
  const label = (agent: string) => deps.agents().find(item => item.id === agent)?.label || agent

  function mine(payload: Payload): [string, Owned] {
    const id = text(payload.id, 'Chat id', 80)
    const chat = owned.get(id)
    if (!chat) throw new Error('The studio can only reach chats it started.')
    return [id, chat]
  }

  async function confirmed(request: StudioConfirmation) {
    if (!(await deps.confirm(request).catch(() => false))) throw new Error(CANCELLED)
  }

  // A new CLI accepts a pasted prompt once it runs and its terminal is quiet.
  async function waitReady(id: string) {
    const started = now()
    while (now() - started < 25000) {
      const state = await screen(id).catch(() => null)
      if (state?.status === 'exited' || state?.status === 'stopped') throw new Error('The agent chat stopped while starting.')
      const quiet = state?.lastOutputAt ? now() - Date.parse(state.lastOutputAt) : Infinity
      if (state?.status === 'running' && now() - started > 2500 && quiet > 1500) return
      await sleep(500)
    }
  }

  // A studio chat runs at the effort picked in the Copilot, so effort advice never holds it.
  const deliver = (id: string, message: string) => deps.api(path(id, 'send'), { text: message, effort: { action: 'keep' } })
  // The chat's messages before a first message, so the studio can tell its reply apart.
  const seen = async (id: string) => (((await deps.api(path(id, 'messages')).catch(() => null)) as Messages | null)?.messages || []).slice(-40).map(item => item.id)

  async function handle(action: unknown, raw: unknown): Promise<unknown> {
    const payload = (raw && typeof raw === 'object' ? raw : {}) as Payload
    switch (action) {
      case 'hello':
        return { agents: deps.agents().filter(item => AGENTS.includes(item.id)).map(item => ({ id: item.id, label: item.label, available: item.available !== false })) }
      case 'list': {
        const folder = resolveFolder(text(payload.path ?? '', 'Folder', 1000), deps.repo())
        const value = await deps.api(`/files?path=${encodeURIComponent(folder)}`) as { entries?: { name: string; path: string; directory: boolean }[] }
        return { entries: (value.entries || []).filter(entry => entry.directory).slice(0, 300).map(entry => ({ name: entry.name, path: entry.path })) }
      }
      // The studio's project list, draft and preferences (desktop/service/ui-studio-state.mjs):
      // its frame's own storage is lost on every launch. The service validates them.
      case 'state':
        return deps.api('/ui-studio/state')
      case 'save-state': {
        const { projects, draft, prefs } = payload
        return deps.api('/ui-studio/state', { projects, draft, prefs })
      }
      // Starts (or reuses) a studio chat; with `text`, also sends that first
      // message, under one confirmation.
      case 'start': {
        const agent = text(payload.agent, 'Agent', 40)
        if (!AGENTS.includes(agent)) throw new Error('Choose Claude, Codex, OpenCode or Antigravity.')
        const info = deps.agents().find(item => item.id === agent)
        if (info && info.available === false) throw new Error(`${info.label || agent} is not installed on this computer.`)
        const effort = payload.effort === undefined ? 'high' : text(payload.effort, 'Effort', 10)
        if (!EFFORTS.includes(effort)) throw new Error('Effort must be medium, high, xhigh or max.')
        const cwd = resolveFolder(text(payload.cwd ?? '', 'Folder', 1000), deps.repo())
        const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 60) : 'UI Studio'
        const first = payload.text === undefined || payload.text === null ? null : text(payload.text, 'Message', 64000)
        // Reuse a studio chat that still runs with the same agent, folder and effort.
        for (const [id, item] of owned) {
          if (item.agent !== agent || item.cwd !== cwd || item.effort !== effort) continue
          const state = await screen(id).catch(() => null)
          if (state?.status !== 'running') { owned.delete(id); continue }
          if (first === null) return { id, agent, reused: true, sent: false }
          await confirmed({ kind: 'send', agent: label(agent), folder: cwd, chat: item.name, text: first })
          const before = await seen(id)
          await deliver(id, first)
          return { id, agent, reused: true, sent: true, before }
        }
        await confirmed({ kind: 'start', agent: label(agent), folder: cwd, effort, chat: name, text: first })
        // The studio keeps its chat in its own drawer: the tab opens in Chats
        // without taking the selection or raising that window.
        const session = await deps.api('/sessions', { agent, cwd, effort, name, bypass: false, background: true }) as { id: string }
        owned.set(session.id, { agent, cwd, effort, name })
        await waitReady(session.id)
        if (first === null) return { id: session.id, agent, reused: false, sent: false }
        const before = await seen(session.id)
        await deliver(session.id, first)
        return { id: session.id, agent, reused: false, sent: true, before }
      }
      case 'send': {
        const [id, chat] = mine(payload)
        const message = text(payload.text, 'Message', 64000)
        await confirmed({ kind: 'send', agent: label(chat.agent), folder: chat.cwd, chat: chat.name, text: message })
        await deliver(id, message)
        return { sent: true }
      }
      case 'messages': {
        const [id] = mine(payload)
        const [value, state] = await Promise.all([deps.api(path(id, 'messages')) as Promise<Messages>, screen(id)])
        return {
          supported: !!value.supported,
          messages: (value.messages || []).slice(-40).map(item => ({ id: item.id, role: item.role, text: String(item.text || '').slice(0, 60000), at: item.at })),
          prompt: promptView(value.prompt),
          activity: state.activity ?? null,
          status: state.status ?? null,
          ...(value.supported ? {} : { screen: String(state.screen || '').slice(-8000) }),
        }
      }
      case 'answer': {
        const [id, chat] = mine(payload)
        const ticket = text(payload.prompt, 'Prompt', 80)
        const choice = promptChoice(payload.choice)
        // The confirmation names the menu and option on screen now, not the frame's copy.
        const menu = promptView(((await deps.api(path(id, 'messages'))) as Messages).prompt)
        if (!menu || menu.id !== ticket) throw new Error('That menu is no longer open in the chat.')
        await confirmed({ kind: 'answer', agent: label(chat.agent), folder: chat.cwd, chat: chat.name, question: menu.question, answer: describeChoice(choice, menu.options) })
        return deps.api(path(id, 'prompt'), { id: ticket, choice })
      }
      case 'open': {
        const [id] = mine(payload)
        await deps.api(path(id, 'focus'), {})
        return { opened: true }
      }
      default:
        throw new Error('Unknown studio request.')
    }
  }

  return { handle, owned }
}
