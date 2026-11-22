import type { ChatSession } from './types'
import { t } from '../lib/i18n'

export function chatActivityLabel(session: ChatSession) {
  const working = session.status === 'running' && session.activity === 'working'
  if (session.unread) return working ? t('Working · unread result') : t('Finished · unread result')
  if (working) return t('Working')
  if (session.status !== 'running') return session.status === 'starting' ? t('Starting') : t('Stopped')
  if (session.activity === 'waiting') return t('Needs attention · check terminal')
  return ['codex', 'claude', 'opencode', 'antigravity'].includes(session.agent) ? t('Ready') : t('Terminal open')
}
