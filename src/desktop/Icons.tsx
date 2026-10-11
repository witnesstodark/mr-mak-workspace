import type { CSSProperties } from 'react'
import type { AgentId } from './types'
import MakLogo from '../components/MakLogo'

export function AgentLogo({ agent, size = 18 }: { agent: AgentId; size?: number }) {
  if (agent === 'opencode') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="agent-logo"><path fillRule="evenodd" d="M4 2h16v20H4V2Zm4 4v14h8V6H8Z" /><path d="M8 6h8v8H8z" opacity=".3" /></svg>
  if (agent === 'claude') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="agent-logo">{Array.from({ length: 12 }, (_, index) => <path key={index} d={`M12 ${index % 2 ? 3 : 1.8}V9`} transform={`rotate(${index * 30} 12 12)`} />)}</svg>
  if (agent === 'codex') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" aria-hidden="true" className="agent-logo">{Array.from({ length: 6 }, (_, index) => <path key={index} d="M12 3.5c-3.7-2-7.7 1-6.5 5L12 12l5.5-3.2V5.9L12 3.5Z" transform={`rotate(${index * 60} 12 12)`} />)}</svg>
  if (agent === 'kimi') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" aria-hidden="true" className="agent-logo"><rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" fillOpacity=".12" strokeWidth="1" /><path d="M8 6v12M16 6l-7 6 7 6" /></svg>
  return <Icon name="terminal" size={size} />
}

export function Nose({ size = 30, tone = 'pink' }: { size?: number; tone?: 'pink' | 'black' }) {
  return <MakLogo size={size} tone={tone} />
}
export function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  const paths: Record<string, string> = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM10 5h4M11 19h2',
    help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9.1 8a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01',
    mcp: 'M8 3v5M16 3v5M5 8h14v3a7 7 0 0 1-14 0ZM12 18v4',
    skills: 'M12 3 2 8l10 5 10-5ZM5 10v7l7 4 7-4v-7M22 8v7', settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
    plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M18 6 6 18', folder: 'M3 7V5h6l2 2h10v13H3Z', files: 'M7 3h10l4 4v14H7ZM3 7v14',
    chats: 'M4 4h16v12H9l-5 4Z M8 8h8M8 12h5', workspace: 'M3 4h18v15H3ZM3 8h18M8 8v11', search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    arrow: 'm9 5 7 7-7 7', back: 'm15 5-7 7 7 7', up: 'm5 15 7-7 7 7', external: 'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
    mic: 'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8', stop: 'M6 6h12v12H6Z',
    keyboard: 'M2 5h20v14H2ZM6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 13h.1M10 13h.1M14 13h.1M18 13h.1M7 16h10',
    send: 'm4 4 17 8-17 8 4-8ZM8 12h13', pin: 'm8 3 8 0-1 7 4 4H5l4-4ZM12 14v7', more: 'M5 12h.1M12 12h.1M19 12h.1',
    terminal: 'm5 7 5 5-5 5M13 17h6', bell: 'M5 16h14l-2-3V8a5 5 0 0 0-10 0v5ZM10 20h4', refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18A8 8 0 0 1 5 16',
    down: 'm5 9 7 7 7-7', enter: 'M19 4v9H5m5-5-5 5 5 5', tab: 'M4 12h13m-5-5 5 5-5 5M20 5v14', escape: 'M14 4h6v16h-6M16 12H4m5-5-5 5 5 5', copy: 'M9 9h12v12H9ZM15 9V3H3v12h6', trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    history: 'M3 5v5h5M4 9a9 9 0 1 1 0 6M12 7v5l3 2', attach: 'm8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2M5 15l9-9', clean: 'm9 4 11 11M6 7l11 11-4 4L2 11ZM2 22h20',
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true"><path d={paths[name] || paths.files} /></svg>
}
