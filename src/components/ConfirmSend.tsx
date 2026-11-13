import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ConfirmFact, ConfirmQueue, PendingConfirmation } from '../lib/confirm-queue'
import './confirm-send.css'

// Draws the owner's confirmation (src/lib/confirm-queue.ts) in the Workspace
// window, over the frame that asked for it.

const Facts = ({ facts }: { facts: ConfirmFact[] }) => (
  <dl className="confirm-send-facts">
    {facts.map(fact => [
      <dt key={`${fact.label}-term`}>{fact.label}</dt>,
      <dd key={`${fact.label}-value`} className={fact.strong ? 'confirm-send-strong' : undefined}>{fact.value}</dd>,
    ])}
  </dl>
)

// The action is armed after a short pause, so a click meant for the frame cannot land on it.
function Dialog({ item, onSettle }: { item: PendingConfirmation; onSettle: (value: boolean) => void }) {
  const { view } = item
  const [armed, setArmed] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const title = useId()
  useEffect(() => {
    box.current?.focus()
    const timer = setTimeout(() => setArmed(true), 600)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className="confirm-send-layer">
      <div
        ref={box}
        className="confirm-send"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
        tabIndex={-1}
        onKeyDown={event => { if (event.key === 'Escape') onSettle(false) }}
      >
        <h2 id={title}>{view.title}</h2>
        <p className="confirm-send-lead">{view.lead}</p>
        <Facts facts={view.facts} />
        {view.details?.length ? <Facts facts={view.details} /> : null}
        {typeof view.text === 'string' && (
          <>
            <div className="confirm-send-size">Message: {view.text.length.toLocaleString()} characters</div>
            <pre className="confirm-send-text" aria-label="Message to send" tabIndex={0}>{view.text}</pre>
          </>
        )}
        <div className="confirm-send-actions">
          <button type="button" onClick={() => onSettle(false)}>Cancel</button>
          <button type="button" className="primary" disabled={!armed} onClick={() => onSettle(true)}>{view.action}</button>
        </div>
      </div>
    </div>
  )
}

// Shows the queue's first request over the frame's host, one at a time.
export default function ConfirmLayer({ queue }: { queue: ConfirmQueue }) {
  const pending = useSyncExternalStore(queue.subscribe, queue.snapshot)
  const first = pending[0]
  return first ? <Dialog key={first.id} item={first} onSettle={value => queue.settle(first.id, value)} /> : null
}
