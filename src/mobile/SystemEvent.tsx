import { useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '../desktop/Icons'
import './systemEvent.css'

export interface SystemFinding { summary: string; file?: string; line?: number; detail?: string }
export interface SystemEventData { kind: 'agent' | 'command' | 'output' | 'notice'; title: string; status?: string; detail?: string; findings?: SystemFinding[] }

const icons = { agent: 'skills', command: 'terminal', output: 'history', notice: 'bell' } as const
const labels = { agent: 'Agent', command: 'Command', output: 'Output', notice: 'Notice' } as const

// Text the CLI added to the conversation (background agents, slash commands and their
// output, relays), shown as one compact line that opens to the readable result.
export default function SystemEvent({ event, time, expanded = false, components, fileLink }: {
  event: SystemEventData; time?: string; expanded?: boolean; components?: Components; fileLink?: (file: string, label: string) => ReactNode
}) {
  const [open, setOpen] = useState(expanded)
  const findings = event.findings || []
  const expandable = !!event.detail || findings.length > 0
  const status = event.status?.toLowerCase()
  const head = <><Icon name={icons[event.kind]} size={13} /><b>{labels[event.kind]}</b><span className="system-event-title">{event.title}</span>
    {status && <small className={`system-event-status ${status}`}>{status}</small>}
    {findings.length > 0 && <small>{findings.length} {findings.length === 1 ? 'finding' : 'findings'}</small>}
    {time && <time>{time}</time>}{expandable && <Icon name="down" size={12} />}</>
  return <div className={`system-event ${event.kind} ${open ? 'open' : ''}`}>
    {expandable ? <button type="button" className="system-event-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>{head}</button> : <div className="system-event-head">{head}</div>}
    {open && expandable && <div className="system-event-body">
      {event.detail && event.kind !== 'output' && <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, ...components }}>{event.detail}</ReactMarkdown>}
      {event.kind === 'output' && <pre>{event.detail}</pre>}
      {findings.length > 0 && <ol className="system-event-findings">{findings.map((item, index) => <li key={index}>
        {item.file && <span className="system-event-file">{fileLink ? fileLink(item.file, `${item.file}${item.line ? `:${item.line}` : ''}`) : `${item.file}${item.line ? `:${item.line}` : ''}`}</span>}
        <p>{item.summary}</p>
        {item.detail && <details><summary>Scenario</summary><p>{item.detail}</p></details>}
      </li>)}</ol>}
    </div>}
  </div>
}
