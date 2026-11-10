// The owner's confirmation before a framed page (the Game UI Studio, a card's
// asset library) reaches a chat. The queue holds the requests; ConfirmLayer
// (src/components/ConfirmSend.tsx) draws them in the Workspace window, outside
// the frame, which can neither draw over it nor press its buttons.

export interface ConfirmFact { label: string; value: string; strong?: boolean }
export interface ConfirmView {
  title: string
  // What is asked, in one sentence, and that nothing happens without the action.
  lead: string
  facts: ConfirmFact[]
  details?: ConfirmFact[]
  // Exactly what the chat receives, when the request carries a message.
  text?: string | null
  action: string
}

export interface PendingConfirmation { id: number; view: ConfirmView; resolve: (value: boolean) => void }

// One queue per kind of frame. Requests are refused while no frame of that kind
// is shown or when they pile up, wait at most `timeoutMs`, and are cancelled
// when the last frame closes.
export function createConfirmQueue({ max = 3, timeoutMs = 9 * 60 * 1000 }: { max?: number; timeoutMs?: number } = {}) {
  let pending: PendingConfirmation[] = []
  let hosts = 0
  let next = 0
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach(listener => listener())
  function settle(id: number, value: boolean) {
    const item = pending.find(entry => entry.id === id)
    if (!item) return
    pending = pending.filter(entry => entry !== item)
    item.resolve(value)
    changed()
  }
  function confirm(view: ConfirmView): Promise<boolean> {
    if (!hosts || pending.length >= max) return Promise.resolve(false)
    return new Promise(resolve => {
      const id = ++next
      pending = [...pending, { id, view, resolve }]
      setTimeout(() => settle(id, false), timeoutMs)
      changed()
    })
  }
  // Called by the component that shows the frame; the returned function detaches it.
  function attach() {
    hosts++
    return () => {
      hosts--
      if (!hosts) for (const item of [...pending]) settle(item.id, false)
    }
  }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  return { confirm, settle, attach, subscribe, snapshot: () => pending }
}
export type ConfirmQueue = ReturnType<typeof createConfirmQueue>
