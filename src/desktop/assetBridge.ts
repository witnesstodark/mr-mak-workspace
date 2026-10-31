import type { ChatSession } from './types'

// A Workspace card's Acervo asks the app to hand one asset to an agent. The
// asset goes to the selected chat when it works in the card's project, else to
// the project's most recently used open chat. Nothing is sent outside it.
export interface AssetRequest {
  action: 'send' | 'variation'
  asset: { card?: string; projeto?: string; repositorio?: string; id: string; nome: string; categoria?: string; versao?: number; status?: string; original?: string; prompt?: string[]; geracao?: { provedor: string; job: string; modelo?: string; data?: string; custo?: number | string } | null; miniatura?: string }
}

const folder = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const inside = (cwd: string, repo: string) => { const a = folder(cwd), b = folder(repo); return a === b || a.startsWith(`${b}/`) }
const field = (value: unknown, max = 2000) => typeof value === 'string' ? value.slice(0, max) : ''

export function parseAssetRequest(data: unknown): AssetRequest {
  const value = data as { action?: unknown; asset?: Record<string, unknown> } | null
  const asset = value?.asset
  if (!asset || typeof asset !== 'object' || !field(asset.id) || !field(asset.nome)) throw new Error('This card item is not valid.')
  if (value.action !== 'send' && value.action !== 'variation') throw new Error('Unknown card action.')
  return { action: value.action, asset: asset as AssetRequest['asset'] }
}

export function assetChat(request: AssetRequest, sessions: ChatSession[], selectedId: string | null): ChatSession {
  const repo = field(request.asset.repositorio)
  if (!repo) throw new Error('This card names no game repository, so Mr. Mak cannot tell which chat works on it.')
  const open = sessions.filter(item => item.open && item.agent !== 'shell' && item.status === 'running' && inside(item.cwd, repo))
  const chosen = open.find(item => item.id === selectedId) || open.sort((a, b) => (b.lastInputAt || b.createdAt).localeCompare(a.lastInputAt || a.createdAt))[0]
  if (!chosen) throw new Error(`Open a chat in ${repo} first.`)
  return chosen
}

export function assetMessage({ action, asset }: AssetRequest): string {
  const job = asset.geracao
  const lines = [
    `Workspace card asset from ${field(asset.projeto, 200) || field(asset.card, 200)}: "${field(asset.nome, 200)}" (id ${field(asset.id, 120)}, v${String(asset.versao ?? 1).padStart(2, '0')}, ${field(asset.categoria, 60)}, ${field(asset.status, 30)}).`,
    asset.original ? `Original: ${field(asset.original)}` : 'Original: not recorded.',
    asset.prompt?.length ? `Prompt: ${asset.prompt.map(item => field(item)).join('; ')}` : 'Prompt: not recorded.',
    job ? `Generation: ${field(job.provedor, 60)} job ${field(job.job, 200)}${job.modelo ? `, model ${field(job.modelo, 120)}` : ''}${job.data ? `, ${field(job.data, 20)}` : ''}${job.custo != null ? `, cost ${typeof job.custo === 'number' ? `${job.custo} credits` : field(job.custo, 60)}` : ''}.` : 'Generation: no generation record.',
    asset.card ? `Card: workspace/${field(asset.card, 200)} (acervo.json).` : '',
  ].filter(Boolean)
  if (action === 'variation') lines.push('Generate a new variation of this asset with the same provider and model when known. Follow the credit-budget skill (orcamento-creditos) and ask me before spending credits. When the job finishes, add the result to the card\'s acervo.json as the next version with its generation record, then regenerate the card.')
  else lines.push('This is the asset I am pointing you to. Wait for my instructions about it.')
  return lines.join('\n')
}
