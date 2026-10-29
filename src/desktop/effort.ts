import type { AgentId, Effort } from './types'

// Agents whose CLI takes a reasoning effort at launch. The service default is medium.
export const effortAgents: AgentId[] = ['codex', 'claude', 'antigravity']
export const defaultEffort: Effort = 'medium'
export const efforts: [Effort, string][] = [['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']]
