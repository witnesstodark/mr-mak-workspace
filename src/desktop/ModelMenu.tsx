import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { api } from './client'
import { modelLabel, refreshChatStats } from './chatModel'
import type { ChatSession } from './types'

// The chat footer's "Opus · high" chip. Its menu applies a model or effort to the
// running Claude chat at once, through `/model <id>` and `/effort <level>`: the CLI
// opens no picker for a command with an argument, and Mr. Mak confirms Claude Code's
// prompt-cache warning itself, so nothing appears in the chat as a question.
interface ModelChoice { id: string; name: string; shortName: string; efforts: string[]; defaultEffort: string | null; contextWindow: number | null }
interface Options { agent: string; supported: boolean; models: ModelChoice[]; efforts: string[] }

const normalize = (value: string) => value.toLowerCase().replace(/\[1m\]$/, '').replace(/-\d{8}$/, '')
const sameModel = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && normalize(a) === normalize(b)
const optionsCache = new Map<string, Options>()

// "claude-opus-5-5" reads as "Opus"; a catalog name wins.
function shortModel(model: string | null, name: string | null, models: ModelChoice[]): string {
  if (!model && !name) return 'Model'
  const known = models.find(item => sameModel(item.id, model))
  if (known) return known.shortName
  const family = model && /^claude-([a-z]+)/i.exec(model)?.[1]
  if (family) return family[0].toUpperCase() + family.slice(1)
  if (name) return name.split(/\s+/)[0]
  return model ? modelLabel(model) : 'Model'
}
const effortName = (effort: string) => effort === 'xhigh' ? 'extra high' : effort

export default function ModelMenu({ session, model, modelName, effort, running, onOpenTerminal }: {
  session: ChatSession; model: string | null; modelName: string | null; effort: string | null; running: boolean; onOpenTerminal: () => void
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<Options | null>(() => optionsCache.get(session.agent) || null)
  const [busy, setBusy] = useState<'model' | 'effort' | null>(null)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState<{ model?: string; effort?: string }>({})
  const chip = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const claude = session.agent === 'claude'
  const picker = session.agent === 'opencode' ? '/models' : '/model'
  const models = options?.models || []
  // What the chat reports replaces the optimistic choice once it catches up.
  const pending = (applied.model && !sameModel(applied.model, model)) || (applied.effort && applied.effort !== effort) ? applied : {}
  const shownModel = pending.model ?? model
  const shownEffort = pending.effort ?? effort
  const label = `${shortModel(shownModel, pending.model ? null : modelName, models)}${shownEffort ? ` · ${shownEffort}` : ''}`

  useEffect(() => { if (!applied.model && !applied.effort) return; const timer = window.setTimeout(() => setApplied({}), 60_000); return () => clearTimeout(timer) }, [applied])

  useEffect(() => {
    if (!open || optionsCache.has(session.agent)) return
    let alive = true
    api<Options>(`/sessions/${session.id}/models`).then(value => { optionsCache.set(session.agent, value); if (alive) setOptions(value) }).catch(err => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
    return () => { alive = false }
  }, [open, session.id, session.agent])

  // Escape or a click elsewhere closes the menu; focus returns to the chip.
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !chip.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); chip.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  // Focus starts on the current choice, and returns there after a change is applied.
  useEffect(() => {
    if (!open || busy) return
    const frame = requestAnimationFrame(() => {
      // The panel itself holds focus only until the models have loaded.
      if (document.activeElement !== panel.current && panel.current?.contains(document.activeElement)) return
      ;(panel.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]:not(:disabled)') || panel.current?.querySelector<HTMLElement>('button:not(:disabled)') || panel.current)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, options, busy])
  const close = () => { setOpen(false); chip.current?.focus() }
  // The menu opens above the chip and shifts left where the window is narrow.
  useLayoutEffect(() => {
    const node = panel.current
    if (!open || !node) return
    node.style.left = '0px'
    const box = node.getBoundingClientRect(), over = box.right - (window.innerWidth - 8)
    if (over > 0) node.style.left = `${-Math.min(over, Math.max(0, box.left - 8))}px`
  }, [open, options])

  const current = models.find(item => sameModel(item.id, shownModel))
  const efforts = current?.efforts.length ? current.efforts : options?.efforts || []

  async function apply(change: { model?: string; effort?: string }) {
    if (busy || !running) return
    setBusy(change.model ? 'model' : 'effort'); setError('')
    try {
      const result = await api<{ applied: boolean; note?: string }>(`/sessions/${session.id}/model`, change)
      if (result.applied) setApplied(value => ({ ...value, ...change }))
      else setError(result.note || 'Claude Code is asking about this change in the chat.')
      refreshChatStats(session.id)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(null) }
  }

  // Arrow keys move within a group; Enter or Space chooses.
  const roving = (event: React.KeyboardEvent<HTMLElement>, next: string, previous: string) => {
    if (event.key !== next && event.key !== previous && event.key !== 'Home' && event.key !== 'End') return
    const items = [...(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'))]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === next ? 1 : -1) + items.length) % items.length
    event.preventDefault(); items[target]?.focus()
  }

  return <div className="model-menu">
    <button ref={chip} type="button" className="model-menu-chip" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined}
      title={`${modelName || model || 'Model'}${shownEffort ? ` · ${effortName(shownEffort)} effort` : ''} · change`}
      onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowUp' && !open) { event.preventDefault(); setOpen(true) } }}>
      <span>{label}</span><i aria-hidden="true">▾</i>
    </button>
    {open && <div ref={panel} id={menuId} className="model-menu-panel" role="dialog" aria-label="Model and effort" tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
      {claude ? <>
        <div className="model-menu-title">Model</div>
        <div className="model-menu-list" role="radiogroup" aria-label="Model" onKeyDown={event => roving(event, 'ArrowDown', 'ArrowUp')}>
          {!options && !error && <p className="model-menu-note">Loading models…</p>}
          {models.map((item, index) => {
            const checked = sameModel(item.id, shownModel)
            const focusable = checked || (!current && index === 0)
            return <button key={item.id} type="button" role="radio" aria-checked={checked} tabIndex={focusable ? 0 : -1} disabled={!running || !!busy}
              className={`model-menu-option ${checked ? 'selected' : ''}`} onClick={() => { if (!checked) void apply({ model: item.id }) }}>
              <span>{item.name}</span>{item.contextWindow ? <small>{item.contextWindow >= 1_000_000 ? `${item.contextWindow / 1_000_000}M` : `${Math.round(item.contextWindow / 1000)}k`} context</small> : null}
              {checked && <b aria-hidden="true">✓</b>}
            </button>
          })}
        </div>
        <div className="model-menu-title">Effort</div>
        <div className="model-menu-efforts" role="radiogroup" aria-label="Reasoning effort" onKeyDown={event => roving(event, 'ArrowRight', 'ArrowLeft')}>
          {efforts.map((level, index) => {
            const checked = level === shownEffort
            return <button key={level} type="button" role="radio" aria-checked={checked} aria-label={`${effortName(level)} effort`} tabIndex={checked || (!efforts.includes(shownEffort || '') && index === 0) ? 0 : -1} disabled={!running || !!busy}
              className={checked ? 'selected' : ''} onClick={() => { if (!checked) void apply({ effort: level }) }}>{level}</button>
          })}
        </div>
        <p className="model-menu-note" role="status">{busy ? `Applying the ${busy}…` : error || (!running ? 'Resume the chat to change its model.' : 'Applies to this chat now and to new chats in this folder. Mid-conversation, the next reply rereads the history without the prompt cache.')}</p>
      </> : <>
        <div className="model-menu-title">{({ codex: 'Codex', antigravity: 'Antigravity', opencode: 'OpenCode', kimi: 'Kimi' } as Record<string, string>)[session.agent] || session.agent}</div>
        <p className="model-menu-note">{modelName || model || 'Model not reported yet'}{effort ? ` · ${effortName(effort)} effort` : ''}</p>
        <p className="model-menu-note">This CLI changes its model only in its own picker, which opens in the terminal.</p>
        <button type="button" className="model-menu-action" disabled={!running} onClick={() => { close(); onOpenTerminal(); api(`/sessions/${session.id}/send`, { text: picker, paths: [] }).catch(err => setError(err instanceof Error ? err.message : String(err))) }}>Open its {picker} picker in Terminal</button>
        {error && <p className="model-menu-note" role="status">{error}</p>}
      </>}
    </div>}
  </div>
}
