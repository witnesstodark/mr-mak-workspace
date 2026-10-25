import type { ChatSession } from './types'

export function chatActivityLabel(session: ChatSession) {
  const working = session.status === 'running' && session.activity === 'working'
  if (session.unread) return working ? 'Working · unread result' : 'Finished · unread result'
  if (working) return 'Working'
  if (session.status !== 'running') return session.status === 'starting' ? 'Starting' : 'Stopped'
  if (session.activity === 'waiting') return 'Needs attention · check terminal'
  return ['codex', 'claude', 'opencode', 'pi'].includes(session.agent) ? 'Ready' : 'Terminal open'
}
