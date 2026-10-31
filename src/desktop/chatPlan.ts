import { useEffect, useState } from 'react'
import { api } from './client'
import type { ChatSession } from './types'

export interface PlanTask { id: string; subject: string; activeForm: string; status: 'pending' | 'in_progress' | 'completed' }
export interface PlanSchedule { kind: 'cron' | 'wakeup'; id?: string; schedule?: string; recurring?: boolean; at?: string; prompt: string; reason?: string }
export interface ChatPlan {
  request: string; status: '' | 'working' | 'needs review' | 'blocked' | 'done'; next: string
  tasks: PlanTask[]; schedules: PlanSchedule[]; updatedAt: string | null; source: 'file' | 'agent' | 'none'; file: string
}

// The selected chat's plan, read every few seconds while the window is shown.
export function useChatPlan(session: ChatSession | null | undefined) {
  const [read, setRead] = useState<{ id: string; plan: ChatPlan } | null>(null)
  const id = session?.agent === 'shell' ? '' : session?.id || ''
  useEffect(() => {
    if (!id) return
    let stopped = false, busy = false
    const load = async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try { const value = await api<ChatPlan>(`/sessions/${id}/plan`); if (!stopped) setRead({ id, plan: value }) }
      catch { /* The panel keeps the last plan it read. */ }
      finally { busy = false }
    }
    void load()
    const timer = window.setInterval(load, 5000)
    window.addEventListener('focus', load)
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', load) }
  }, [id, session?.completionVersion])
  return read?.id === id ? read.plan : null
}

// Why the chat needs the owner now: it waits for an answer, or its plan reached
// review, a block or the end after the owner's last message.
export function planAttention(plan: ChatPlan | null, session: ChatSession): string {
  if (session.activity === 'waiting') return 'Waiting for you'
  if (!plan?.updatedAt || session.activity === 'working' || Date.parse(plan.updatedAt) <= Date.parse(session.lastInputAt || '')) return ''
  return plan.status === 'needs review' ? 'Needs review' : plan.status === 'blocked' ? 'Blocked' : plan.status === 'done' ? 'Plan done' : ''
}

export const planProgress = (plan: ChatPlan | null) => plan?.tasks.length ? { done: plan.tasks.filter(item => item.status === 'completed').length, total: plan.tasks.length } : null
