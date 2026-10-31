import { useEffect, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '../desktop/Icons'
import CacheChip from '../desktop/CacheChip'
import { formatReset, planLimits, shown, tone } from '../desktop/planLimits'
import DiffView from '../components/DiffView'
import ReportFrame from '../components/ReportFrame'
import type { ChatSession } from '../desktop/types'
import { mobileApi } from './client'
import type { ChatDetails, LinkedFile } from './useChatExtras'
import './chat-extras.css'


const statusMark = { completed: '✓', in_progress: '›', pending: '○' } as const
const statusLabel = { working: 'Working', 'needs review': 'Needs review', blocked: 'Blocked', done: 'Done' } as const
const changeMark: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' }

function Sheet({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="mobile-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <section className="mobile-modal mobile-sheet" role="dialog" aria-label={title}><header><h2>{title}</h2><button type="button" className="mobile-icon" aria-label={`Close ${title.toLowerCase()}`} onClick={close}><Icon name="close" /></button></header>{children}</section>
  </div>
}

// One line under the chat's tools: plan progress, plan limits, prompt cache and the
// changes in the chat's folder. Each opens its details in a sheet.
export function ChatStrip({ session, details }: { session: ChatSession; details: ChatDetails | null }) {
  const [open, setOpen] = useState<'plan' | 'usage' | 'changes' | null>(null)
  const [diff, setDiff] = useState<{ name: string; text: string } | null>(null), [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  if (!details) return null
  const { plan, usage, cache, changes, changeCount } = details
  const done = plan?.tasks.filter(item => item.status === 'completed').length || 0, total = plan?.tasks.length || 0
  const hasPlan = !!plan && (total > 0 || !!plan.request)
  const limits = ['claude', 'codex'].includes(session.agent) ? planLimits(usage, now) : null
  const sessionUsed = limits?.session?.usedPercent ?? null, weeklyUsed = limits?.weekly?.usedPercent ?? null
  const added = changes.reduce((sum, item) => sum + (item.added || 0), 0), removed = changes.reduce((sum, item) => sum + (item.removed || 0), 0)
  if (!hasPlan && !limits && !cache && !changeCount) return null
  async function showDiff(change: ChatDetails['changes'][number]) {
    try { setError(''); setDiff({ name: change.name, ...(await mobileApi<{ text: string }>(`/sessions/${session.id}/diff`, { path: change.path })) }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <>
    <div className="mobile-chat-strip" role="group" aria-label="Chat details">
      {hasPlan && <button type="button" className={`plan ${plan.status.replace(' ', '-')}`} onClick={() => setOpen('plan')} aria-label="Plan">
        {total > 0 && <b>{done}/{total}</b>}<span>{plan.next ? `Next: ${plan.next}` : plan.status ? statusLabel[plan.status as keyof typeof statusLabel] : plan.request}</span>
      </button>}
      {limits && <button type="button" className={`usage tone-${tone(Math.max(sessionUsed ?? 0, weeklyUsed ?? 0))}`} onClick={() => setOpen('usage')} aria-label={`Plan usage: ${limits.sessionLabel} ${shown(sessionUsed)}, week ${shown(weeklyUsed)}`}>
        {limits.sessionLabel} {shown(sessionUsed)} · Wk {shown(weeklyUsed)}
      </button>}
      {cache && <CacheChip cache={cache} />}
      {changeCount > 0 && <button type="button" className="changes" onClick={() => setOpen('changes')} aria-label={`${changeCount} changed files`}>
        {changeCount} {changeCount === 1 ? 'file' : 'files'}{(added > 0 || removed > 0) && <> <span className="add">+{added}</span> <span className="remove">−{removed}</span></>}
      </button>}
    </div>
    {open === 'plan' && plan && <Sheet title="Plan" close={() => setOpen(null)}>
      {plan.request && <p className="mobile-plan-request">{plan.request}</p>}
      {plan.status && <span className={`mobile-plan-status ${plan.status.replace(' ', '-')}`}>{statusLabel[plan.status as keyof typeof statusLabel]}</span>}
      {total > 0 && <ol className="mobile-plan-steps">{plan.tasks.map(item => <li key={item.id} className={item.status}><span aria-hidden="true">{statusMark[item.status]}</span><span>{item.status === 'in_progress' && item.activeForm ? item.activeForm : item.subject}</span></li>)}</ol>}
      {plan.next && <p className="mobile-plan-next"><strong>Next</strong> {plan.next}</p>}
    </Sheet>}
    {open === 'usage' && limits && <Sheet title="Plan usage" close={() => setOpen(null)}>
      {[[`${limits.sessionLabel === '5h' ? '5-hour' : limits.sessionLabel} limit`, limits.session], ['Weekly limit', limits.weekly]].map(([title, window]) => {
        const used = typeof window === 'object' && window ? window.usedPercent : null
        return <div key={String(title)} className="mobile-usage-row"><div><span>{String(title)}</span><strong>{used === null ? '—' : `${Math.round(used)}% used`}</strong></div>
          <span className="mobile-usage-bar"><span className={`tone-${tone(used)}`} style={{ width: `${Math.min(100, Math.max(0, used ?? 0))}%` }} /></span>
          <small>{typeof window === 'object' && window ? formatReset(window.resetsAt, now) : 'Not reported yet'}</small></div>
      })}
      {limits.list.filter(item => item.isExclusive && item.primary).map(item => <div key={item.limitName || item.limitId} className="mobile-usage-row"><div><span>{item.limitName || item.limitId}</span><strong>{shown(item.primary?.usedPercent ?? null)}</strong></div></div>)}
      {typeof usage?.tokens?.contextPercent === 'number' && <p>Context {Math.round(usage.tokens.contextPercent)}% full.</p>}
    </Sheet>}
    {open === 'changes' && <Sheet title={diff ? diff.name : 'Changed files'} close={() => { setOpen(null); setDiff(null) }}>
      {diff ? <><button type="button" className="mobile-sheet-back" onClick={() => setDiff(null)}><Icon name="back" size={15} />All changes</button>{diff.text ? <DiffView text={diff.text} /> : <p>No line changes to show.</p>}</>
        : <ul className="mobile-changes">{changes.map(item => <li key={item.path}><button type="button" disabled={item.folder} title={item.folder ? 'A new folder: open it on your computer' : undefined} onClick={() => void showDiff(item)}><b className={item.status}>{changeMark[item.status] || 'M'}</b><span>{item.folder ? `${item.name}/` : item.name}</span>{item.added != null && <small><span className="add">+{item.added}</span> <span className="remove">−{item.removed}</span></small>}</button></li>)}
          {changeCount > changes.length && <li className="mobile-changes-more">{changeCount - changes.length} more on your computer</li>}</ul>}
      {error && <p className="mobile-error" role="alert">{error}</p>}
    </Sheet>}
  </>
}

// A rule marked with "remember:" or "lembre:" in this chat, waiting to be saved.
export function RuleBand({ session, rules, reload }: { session: ChatSession; rules: ChatDetails['rules']; reload: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const item = rules[0]
  if (!item) return null
  async function resolve(action: 'project' | 'global' | 'skip') {
    setBusy(true); setError('')
    try { await mobileApi(`/sessions/${session.id}/rules`, { id: item.id, action }); reload() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <div className="mobile-rule-band" role="region" aria-label="Rule to save">
    <p><b>Rule</b>{item.rule}</p>
    <div><button type="button" disabled={busy} onClick={() => void resolve('project')}>Save to project</button><button type="button" disabled={busy} onClick={() => void resolve('skip')}>Skip</button>
      <details><summary aria-label="More rule actions">⋯</summary><button type="button" disabled={busy} onClick={() => void resolve('global')}>Save as global</button></details></div>
    {error && <p className="mobile-error" role="alert">{error}</p>}
  </div>
}

// A local file opened from a chat link, over the conversation.
export function FileViewer({ file, error, close }: { file: LinkedFile | null; error: string; close: () => void }) {
  return <>
    {error && <p className="mobile-error" role="alert">{error}</p>}
    {file && <div className="mobile-file-viewer" role="dialog" aria-label={file.name}>
      <header><strong title={file.name}>{file.name}</strong><button type="button" className="mobile-icon" aria-label="Close file" onClick={close}><Icon name="close" /></button></header>
      {file.kind === 'html' && <ReportFrame title={file.name} url={file.url} sandbox="allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />}
      {file.kind === 'markdown' && <article className="mobile-message mobile-report-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => { const safe = defaultUrlTransform(url); return safe ? new URL(safe, new URL(file.url, location.origin)).href : safe }}>{file.text || ''}</ReactMarkdown></article>}
      {file.kind === 'image' && <div className="mobile-file-media"><img src={file.url} alt={file.name} /></div>}
      {file.kind === 'video' && <div className="mobile-file-media"><video src={file.url} controls playsInline /></div>}
    </div>}
  </>
}
