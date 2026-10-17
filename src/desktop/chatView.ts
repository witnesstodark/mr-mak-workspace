import type { ChatSession } from './types'

export type ChatView = 'conversation' | 'terminal'

const key = (id: string) => `mrmak.chatView.${id}`
const read = (name: string) => { try { return localStorage.getItem(name) } catch { return null } }

// Only these CLIs write a transcript Mr. Mak can read as a conversation.
export const hasConversationView = (session: ChatSession) => session.agent === 'claude' || session.agent === 'codex'

export function chatView(session: ChatSession): ChatView {
  if (!hasConversationView(session)) return 'terminal'
  const saved = read(key(session.id))
  if (saved === 'conversation' || saved === 'terminal') return saved
  // A new CLI can open with folder-trust or sign-in questions that only the
  // terminal shows, so the preferred view applies once a conversation exists.
  return session.hasConversation && read(key('default')) === 'conversation' ? 'conversation' : 'terminal'
}

// A choice from the view switch also becomes the preferred view for other chats.
export function saveChatView(id: string, view: ChatView, preferred = true) {
  try { localStorage.setItem(key(id), view); if (preferred) localStorage.setItem(key('default'), view) } catch { /* The view still changes for this window. */ }
}
