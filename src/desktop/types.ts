import type { ThemePreference } from '../../desktop/service/appearance.mjs'

export type AgentId = 'codex' | 'claude' | 'antigravity' | 'opencode' | 'kimi' | 'shell'
export interface AgentInfo { id: AgentId; label: string; color: string; available: boolean; subscription: boolean }
export interface ChatSession {
  id: string; name: string; agent: AgentId; cwd: string; bypass: boolean
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** The model chosen in the chat footer; the CLI's default when absent. */
  model?: string
  status: 'starting' | 'running' | 'stopped' | 'exited'; createdAt: string
  lastOutputAt: string | null; lastInputAt: string | null; nativeId: string | null
  attention: boolean; cols: number; rows: number; exitCode?: number | null
  activity: 'idle' | 'working' | 'waiting'; unread: boolean; completionVersion: number
  tabOrder: number; tabColor: string | null; group: string | null
  open: boolean; pinned: boolean; updatedAt: string; preview?: string; hasConversation?: boolean; restoreError?: string | null
}
export interface RecentProject { path: string; name: string; sources: ('workspace' | 'mrmak' | 'claude' | 'codex')[]; pinned: boolean; lastUsedAt: string | null }
export interface Handoff { status: 'summarizing' | 'paused' | 'opening' | 'done' | 'failed'; pause?: boolean; error?: string | null; sessionId?: string | null; file?: string | null; at: string }
export interface Notice { id: string; sessionId: string; name: string; kind: string; text: string; at: string }
export interface Operation { id: string; text: string; status: string; result?: string; at: string; images?: string[] }
export interface Settings { defaultAgent: AgentId; transcribeProvider?: 'local' | 'openai' | 'openrouter' | 'off'; defaultBypass: boolean; terminalFontSize?: number; terminalAppearance?: 'focus' | 'original'; workspaceTheme?: ThemePreference; chatTheme?: ThemePreference; workspaceRoute?: string | null; selectedId?: string | null; coordinatorEffort?: 'medium' | 'high'; effortAdvice?: 'off' | 'ask' | 'auto'; voiceName?: string; voiceStyle?: string; handoffAfter?: number; idleCacheMinutes?: number; idleCacheMinTokens?: number; usageLimitMode?: 'all' | 'general'; usageDirection?: 'used' | 'remaining'; terminalOptionMeta?: boolean; collapsedGroups?: string[]; groupColors?: Record<string, string>; systemEvents?: SystemEventsMode }
export type SystemEventsMode = 'full' | 'compact' | 'hidden'
export interface ModelUsageTokens {
  current: number
  cumulative: number
  input: number
  cached: number
  output: number
  reasoning?: number
  /** Null when nothing reported the context size. */
  contextWindow: number | null
  contextPercent: number | null
}
export interface ModelRateLimitWindow {
  usedPercent: number
  windowMinutes: number
  resetsAt: number
}
export interface ModelRateLimitEntry {
  limitId: string
  limitName?: string | null
  isExclusive?: boolean
  primary?: ModelRateLimitWindow | null
  secondary?: ModelRateLimitWindow | null
  planType?: string | null
  credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string } | null
}
export interface ModelUsageStats {
  agent: AgentId
  tokens: ModelUsageTokens
  costUSD?: number | null
  rateLimits?: ModelRateLimitEntry | null
  rateLimitsList?: ModelRateLimitEntry[]
  fetchedAt?: number | null
  /** Where the plan limits came from: Claude Code's status line or its cached /usage data. */
  source?: 'statusline' | 'cache' | null
  /** The chat's last model request (Claude), from which its prompt cache expires. */
  at?: string | null
}
export interface VoiceOwner { clientId: string; surface: 'chats' | 'workspace' }
export interface FileEntry { name: string; path: string; directory: boolean; size: number; modifiedAt: string | null }
export interface Folder { path: string; parent: string; entries: FileEntry[]; truncated: boolean; mode: string }
export interface Preview { path: string; name: string; size: number; kind: 'document' | 'image' | 'video' | 'audio' | 'text' | 'unsupported'; url?: string; text?: string; revision?: string; reason?: string }
export interface DesktopState {
  ready: boolean; connected: boolean; error: string | null; repo: string; contentBase: string
  agents: AgentInfo[]; sessions: ChatSession[]; selectedId: string | null; notices: Notice[]
  settings: Settings; coordinator: string; voice: { configured: boolean; owner: VoiceOwner | null }
  operations: Operation[]; preview: Preview | null
  voiceHistory: { id: string; at: string; captions: { role: 'user' | 'assistant'; text: string; start: number; end: number }[] }[]
}
export interface ServiceEvent {
  type: string; id?: string; data?: string; sequence?: number; session?: ChatSession; sessions?: ChatSession[]
  selectedId?: string; sessionId?: string; state?: string; error?: string; notice?: Notice
  operation?: Operation; settings?: Settings; owner?: VoiceOwner | null; window?: string; route?: string; preview?: Preview; handoff?: Handoff
}
