import { Icon } from '../desktop/Icons'
import { chatActivityLabel } from '../desktop/chatActivity'
import type { ChatSession } from '../desktop/types'

export default function ActivityStatus({ session, connected }: { session: ChatSession; connected: boolean }) {
  const working = connected && session.status === 'running' && session.activity === 'working'
  const label = connected ? chatActivityLabel(session) : 'Disconnected · reconnecting'
  const waiting = connected && session.activity === 'waiting'
  return <span className={`mobile-activity-status ${working ? 'working' : ''} ${waiting ? 'waiting' : ''}`} role="status" aria-label={label} title={label}>
    {working ? <svg width="34" height="28" viewBox="0 0 34 28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="5" r="3" /><path d="M4 25V14a4 4 0 0 1 7-3l3 5" />
      <g className="mobile-worker-hands"><path d="m9 13 5 5h7M8 17l5 3h8" /></g>
      <path d="M16 23h12l4-13M12 26h20" /><path className="mobile-worker-screen" d="m26 13 2-1" />
    </svg> : waiting ? <Icon name="bell" size={22} /> : !connected ? <Icon name="refresh" size={22} /> : session.status !== 'running' ? <Icon name="stop" size={21} /> : <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>}
    {connected && session.unread && <i className="mobile-activity-unread" aria-hidden="true" />}
  </span>
}
