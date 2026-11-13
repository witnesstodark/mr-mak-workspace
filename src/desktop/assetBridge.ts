import type { ChatSession } from './types'
import type { ConfirmView } from '../lib/confirm-queue'

// A Workspace card's asset library (workspace/_shared/asset-library) asks the
// app to hand one of its items to a chat: "Send to chat" points the chat to it,
// "Ask for a variation" asks for a new version.
//
// The page is not trusted to say what is sent or where. It names an item id and
// an action only. The app reads that item from the card's own assets.json, picks
// the chat from the project that workspace.json records for the card, shows the
// exact message and chat, and sends only when the owner chooses Send.

export interface AssetCard { id: string; title: string; folder: string; project?: string }
export interface AssetRequest { action: 'send' | 'variation'; item: string }
export interface AssetBridgeDeps {
  api: (path: string, data?: unknown) => Promise<unknown>
  // A repository file's text, by its path relative to the repository.
  read: (relative: string) => Promise<string>
  repo: () => string
  sessions: () => ChatSession[]
  selectedId: () => string | null
  agentLabel: (agent: string) => string
  // Resolves true only when the owner chose Send in the Workspace window.
  confirm: (view: ConfirmView) => Promise<boolean>
}

export const SOURCE = 'assets.json'
export const MAX_SOURCE_CHARS = 2 * 1024 * 1024
export const CANCELLED = 'Cancelled in Mr. Mak; nothing was sent.'
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const STATUS = ['current', 'review', 'discarded']

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() !== '' && value.length <= max

// The same rule as the build script: relative to the card folder, "/" only, no
// "..", hidden segments, scheme, query or fragment.
export function safeRelative(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 300) return false
  if (/[\\:*?"<>|#%]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32) || value.startsWith('/')) return false
  return value.split('/').every(part => part && part !== '..' && !part.startsWith('.'))
}

export function parseAssetRequest(data: unknown): AssetRequest {
  const value = isObject(data) ? data : {}
  if (value.action !== 'send' && value.action !== 'variation') throw new Error('Unknown asset action.')
  if (typeof value.item !== 'string' || value.item.length > 80 || !SLUG.test(value.item)) throw new Error('This asset id is not valid.')
  return { action: value.action, item: value.item }
}

const separator = (repo: string) => repo.includes('\\') ? '\\' : '/'
const join = (repo: string, ...parts: string[]) => [repo.replace(/[\\/]+$/, ''), ...parts.flatMap(part => part.split('/'))].join(separator(repo))

// The project folder recorded for the card in workspace.json: relative to the
// repository, or absolute.
export function projectFolder(card: AssetCard, repo: string): string {
  const project = typeof card.project === 'string' ? card.project.trim() : ''
  if (!project) throw new Error(`The card "${card.title}" names no project in workspace.json, so Mr. Mak cannot tell which chat works on it.`)
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(project)) return project.replace(/[\\/]+$/, '')
  const parts = project.split(/[\\/]+/).filter(part => part && part !== '.')
  if (parts.includes('..')) throw new Error('The card\'s project must be inside the repository or an absolute path.')
  return join(repo, ...parts)
}

const normalized = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const within = (cwd: string, folder: string) => { const a = normalized(cwd), b = normalized(folder); return a === b || a.startsWith(`${b}/`) }

// The selected chat when it works in the project, else the project's most
// recently used open chat.
export function chooseChat(sessions: ChatSession[], selectedId: string | null, folder: string): ChatSession {
  const open = sessions.filter(item => item.open && item.agent !== 'shell' && item.status === 'running' && within(item.cwd, folder))
  const chosen = open.find(item => item.id === selectedId) || [...open].sort((a, b) => (b.lastInputAt || b.createdAt).localeCompare(a.lastInputAt || a.createdAt))[0]
  if (!chosen) throw new Error(`Open a chat in ${folder} first.`)
  return chosen
}

export interface AssetItem {
  id: string; name: string; category: string; family: string; status: string; version: number
  thumbnail?: string; original?: string; prompt?: string; promptFile?: string
  generation?: { provider: string; job: string; model?: string; date?: string; cost?: number | string }
}

// The item, from the card's own assets.json. Fields the message uses are checked again here.
export function findItem(source: string, id: string): AssetItem {
  if (source.length > MAX_SOURCE_CHARS) throw new Error(`${SOURCE} is too large.`)
  let data: unknown
  try { data = JSON.parse(source.replace(/^\uFEFF/, '')) } catch { throw new Error(`${SOURCE} is not valid JSON.`) }
  const items = isObject(data) && Array.isArray(data.items) ? data.items : null
  if (!items) throw new Error(`${SOURCE} has no "items".`)
  const item = items.find(entry => isObject(entry) && entry.id === id)
  if (!isObject(item)) throw new Error(`This card's ${SOURCE} has no item "${id}".`)
  const generation = item.generation
  const valid = text(item.name, 200) && text(item.category, 80) && text(item.family, 80) && STATUS.includes(item.status as string)
    && Number.isInteger(item.version) && (item.version as number) >= 1 && (item.version as number) <= 999
    && (item.thumbnail === undefined || safeRelative(item.thumbnail)) && (item.promptFile === undefined || safeRelative(item.promptFile))
    && (item.original === undefined || text(item.original, 1000)) && (item.prompt === undefined || text(item.prompt, 4000))
    && (generation === undefined || (isObject(generation) && text(generation.provider, 60) && text(generation.job, 200)
      && (generation.model === undefined || text(generation.model, 120)) && (generation.date === undefined || text(generation.date, 10))
      && (generation.cost === undefined || (typeof generation.cost === 'number' && Number.isFinite(generation.cost) && generation.cost >= 0) || text(generation.cost, 60))))
  if (!valid) throw new Error(`The item "${id}" in ${SOURCE} is not valid. Run the asset library build to see why.`)
  return item as unknown as AssetItem
}

// Exactly what the chat receives. Paths are absolute, because the chat works in the project, not in this repository.
export function assetMessage({ action, item, card, repo }: { action: AssetRequest['action']; item: AssetItem; card: AssetCard; repo: string }): string {
  const job = item.generation
  const cost = job?.cost === undefined ? '' : typeof job.cost === 'number' ? `, cost ${job.cost} credits` : `, cost ${job.cost}`
  const lines = [
    `Workspace asset from ${card.title}: "${item.name}" (id ${item.id}, v${String(item.version).padStart(2, '0')}, ${item.category}/${item.family}, ${item.status}).`,
    item.original ? `Original: ${item.original}` : 'Original: not recorded.',
    item.thumbnail ? `Preview: ${join(repo, 'workspace', card.folder, item.thumbnail)}` : '',
    item.prompt ? `Prompt: ${item.prompt}` : '',
    item.promptFile ? `Prompt file: ${join(repo, 'workspace', card.folder, item.promptFile)}` : '',
    item.prompt || item.promptFile ? '' : 'Prompt: not recorded.',
    job ? `Generation: ${job.provider} job ${job.job}${job.model ? `, model ${job.model}` : ''}${job.date ? `, ${job.date}` : ''}${cost}.` : 'Generation: no record.',
    `Asset library: ${join(repo, 'workspace', card.folder, SOURCE)}`,
  ].filter(Boolean)
  if (action === 'variation') lines.push(
    'Generate a new variation of this asset, with the same provider and model when the generation record names them. Tell me the estimated cost and ask me before spending credits.',
    `When the job finishes, add the result to the asset library as this item's next version: raise "version", move the current version to "history" and record "generation". Then rebuild the page with: node "${join(repo, 'workspace', '_shared', 'asset-library', 'build.mjs')}" "${join(repo, 'workspace', card.folder)}"`,
  )
  else lines.push('This is the asset I am pointing you to. Wait for my instructions about it.')
  return lines.join('\n')
}

// A card folder from workspace.json, one or more plain segments.
function folderOf(card: AssetCard) {
  if (!safeRelative(card.folder)) throw new Error('This card\'s folder is not valid.')
  return card.folder
}

/**
 * Handles one request from the card's page. `waiting` runs just before the
 * owner is asked, so the page can say so. Resolves with the text the page shows.
 */
export async function handleAssetRequest(deps: AssetBridgeDeps, card: AssetCard, data: unknown, waiting: () => void = () => {}): Promise<{ text: string }> {
  const request = parseAssetRequest(data)
  const folder = folderOf(card), repo = deps.repo()
  const project = projectFolder(card, repo)
  const item = findItem(await deps.read(`workspace/${folder}/${SOURCE}`), request.item)
  const chat = chooseChat(deps.sessions(), deps.selectedId(), project)
  const message = assetMessage({ action: request.action, item, card, repo })
  waiting()
  const approved = await deps.confirm({
    title: request.action === 'variation' ? 'Ask a chat for a variation' : 'Send an asset to a chat',
    lead: `The asset library of "${card.title}" asks to send the message below to this chat. Nothing reaches the chat unless you choose Send.`,
    facts: [
      { label: 'Chat', value: chat.name },
      { label: 'Agent', value: deps.agentLabel(chat.agent) },
      { label: 'Folder', value: chat.cwd },
      { label: 'Project', value: project },
    ],
    text: message,
    action: 'Send',
  }).catch(() => false)
  if (!approved) throw new Error(CANCELLED)
  // The chat may have closed while the owner read the message.
  const current = deps.sessions().find(item => item.id === chat.id)
  if (!current || !current.open || current.status !== 'running') throw new Error(`The chat ${chat.name} is no longer running; nothing was sent.`)
  await deps.api(`/sessions/${encodeURIComponent(chat.id)}/send`, { text: message })
  await deps.api(`/sessions/${encodeURIComponent(chat.id)}/focus`, {}).catch(() => {})
  return { text: `Sent to the chat ${chat.name}.` }
}
