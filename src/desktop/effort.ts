import type { AgentId, Effort } from './types'

// Agents whose CLI takes a reasoning effort at launch. Preserve the existing default.
export const effortAgents: AgentId[] = ['codex', 'claude', 'antigravity']
export const defaultEffort: Effort = 'xhigh'
export const efforts: [Effort, string][] = [['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']]
