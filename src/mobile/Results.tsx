import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '../desktop/Icons'
import { mobileApi } from './client'

interface Report { id: string; title: string; category: string; updated: string; steps: { name: string; index: number }[] }
interface Preview { title: string; step: string; kind: 'markdown' | 'html'; url: string; text?: string }

export interface ResultsNavigation { closeReport: () => void }

export default function Results({ header, navigationRef }: { header: HTMLElement | null; navigationRef: Ref<ResultsNavigation> }) {
  const [reports, setReports] = useState<Report[]>([]), [selected, setSelected] = useState<Report | null>(null), [step, setStep] = useState(0), [preview, setPreview] = useState<Preview | null>(null)
  const [query, setQuery] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const menu = useRef<HTMLDetailsElement>(null)
  useImperativeHandle(navigationRef, () => ({ closeReport() { if (menu.current) menu.current.open = false; setSelected(null); setPreview(null); setLoading(false); setError('') } }), [])
  useEffect(() => {
    function dismiss(event: PointerEvent) { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus() } }
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [])
  useEffect(() => { let current = true; mobileApi<Report[]>('/reports').then(value => { if (current) setReports(value) }).catch(() => { if (current) setError('Connect to your computer to load reports.') }); return () => { current = false } }, [])
  useEffect(() => {
    if (!selected) return
    let current = true
    mobileApi<Preview>('/reports/open', { entityId: selected.id, step }).then(value => { if (current) { setPreview(value); setLoading(false); setError('') } }).catch(err => { if (current) { setError(err instanceof Error ? err.message : String(err)); setLoading(false) } })
    return () => { current = false }
  }, [selected, step])
  function open(report: Report) { setPreview(null); setLoading(true); setSelected(report); setStep(0); setError('') }
  const relativeUrl = (url: string) => { const safe = defaultUrlTransform(url); return safe && preview ? new URL(safe, new URL(preview.url, location.origin)).href : safe }
  return <section className="mobile-results">{header && createPortal(<><h1 title={selected?.title}>{selected?.title || 'Workspace'}</h1>{selected && <details ref={menu} className="mobile-page-picker"><summary className="mobile-icon" aria-label="Select report page" title="Select report page"><Icon name="menu" size={19} /></summary><div className="mobile-page-menu" aria-label="Report pages">{selected.steps.map(item => <button key={item.index} aria-pressed={step === item.index} className={step === item.index ? 'active' : ''} onClick={() => { if (menu.current) menu.current.open = false; if (item.index !== step) { setPreview(null); setLoading(true); setStep(item.index); setError('') } }}><span>{item.name}</span>{step === item.index && <span aria-hidden="true">✓</span>}</button>)}<button aria-label="Close report" onClick={() => { if (menu.current) menu.current.open = false; setSelected(null); setPreview(null); setError('') }}><Icon name="back" size={16} /><span>All workspaces</span></button></div></details>}</>, header)}{selected ? <>{loading && <p className="mobile-report-note">Opening report…</p>}{preview?.kind === 'html' && <iframe title={`${preview.title} · ${preview.step}`} src={preview.url} sandbox="allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />}{preview?.kind === 'markdown' && <article className="mobile-message mobile-report-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={relativeUrl} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ src, alt }) => <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={alt || ''} loading="lazy" /></a> }}>{preview.text || ''}</ReactMarkdown></article>}</> : <div className="mobile-results-list"><label className="mobile-search"><Icon name="search" size={17} /><input aria-label="Find a report" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a report…" /></label>{reports.filter(item => `${item.title} ${item.category}`.toLowerCase().includes(query.toLowerCase())).map(item => <button className="mobile-result-card" key={item.id} onClick={() => open(item)}><span><strong>{item.title}</strong><small>{item.category} · {item.steps.length} {item.steps.length === 1 ? 'tab' : 'tabs'}</small></span><Icon name="arrow" size={16} /></button>)}</div>}{error && <p className="mobile-error" role="alert">{error}</p>}</section>
}
