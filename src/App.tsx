import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceEntity } from './types'
import { useWorkspace, archiveCutoff } from './lib/workspace'
import { parseHash, entityHash, resolveStep, type Route } from './lib/route'
import MakLogo from './components/MakLogo'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import HomeGrid from './components/HomeGrid'
import EntityControls from './components/EntityControls'
import ReportBoundary from './components/ReportBoundary'
import { contentUrl, isDesktop, useDesktop } from './desktop/client'

const Compare3D = lazy(() => import('./components/Compare3D'))
const ReportViewer = lazy(() => import('./components/ReportViewer'))

// Freshly-touched work always burns at the top: sort by `updated` (falls back
// to `created`), regardless of status — a report Mak just edited must not sink
// under long-lived "active" entities. Status only breaks ties.
const lastTouched = (e: WorkspaceEntity) => e.updated ?? e.created
const statusRank = (e: WorkspaceEntity) => (e.status === 'active' ? 0 : 1)
const byFreshness = (a: WorkspaceEntity, b: WorkspaceEntity) =>
  lastTouched(b).localeCompare(lastTouched(a)) || statusRank(a) - statusRank(b)

export default function App() {
  const { workspace, offline, lastSync, reload } = useWorkspace()
  const { liveSources } = useDesktop()
  const [route, setRoute] = useState<Route>(parseHash)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [collapsed, setCollapsed] = useState(
    () => isDesktop || localStorage.getItem('mak.sidebarCollapsed') === '1',
  )
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem('mak.sidebarCollapsed', collapsed ? '1' : '0')
  }, [collapsed])

  const entities = workspace?.entities ?? []
  const entity = entities.find(e => e.id === route.id) ?? null

  const stepIndex = entity
    ? resolveStep(entity.steps.length, route.step, entity.defaultStep)
    : -1
  const step = entity?.steps[stepIndex]
  const liveSource = step?.source ? liveSources.find(source => source.id === step.source) : undefined
  const reportUrl = entity && step
    ? step.source
      ? liveSource ? new URL(step.path, liveSource.url).href : null
      : contentUrl(`/workspace/${entity.folder}/${step.path}`)
    : null

  // Hash → state: entity links navigate natively; this also covers back/forward.
  useEffect(() => {
    const onHash = () => { setRoute(parseHash()); if (isDesktop) setCollapsed(true) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // "/" focuses search; "[" toggles the sidebar (handy for a clean screen recording).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      const typing =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing) return
      if (ev.key === '/') {
        ev.preventDefault()
        searchRef.current?.focus()
      } else if (ev.key === '[') {
        ev.preventDefault()
        setCollapsed(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.title = entity ? `Mr. Mak — ${entity.title}` : 'Mr. Mak — Workspace'
  }, [entity])

  const goHome = useCallback(() => {
    history.pushState(null, '', window.location.pathname + window.location.search)
    setRoute({ id: null, step: -1 })
  }, [])

  const selectStep = useCallback((id: string, index: number) => {
    history.replaceState(null, '', entityHash(id, index))
    setRoute({ id, step: index })
  }, [])

  if (!workspace) {
    return (
      <div className="boot">
        <MakLogo size={76} />
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const cutoff = archiveCutoff()
  // An explicit `archived` status always wins, so a card can be put away by hand
  // while it is still inside the 7-day window. Otherwise it is the date rule,
  // which `pinned` overrides in the other direction.
  const isArchived = (e: WorkspaceEntity) =>
    e.status === 'archived' || (!e.pinned && !e.sample && lastTouched(e) < cutoff)
  const matchesQuery = (e: WorkspaceEntity) =>
    !searching ||
    [e.title, e.description, e.category, e.id].some(s => s && s.toLowerCase().includes(q))

  // Search digs through everything, archive included; otherwise the
  // archive stays hidden behind the toggle.
  const visible = entities.filter(
    e => matchesQuery(e) && (searching || showArchived || !isArchived(e)),
  )
  const archivedCount = entities.filter(isArchived).length

  const pinned = visible.filter(e => e.pinned).sort(byFreshness)
  const rest = visible.filter(e => !e.pinned).sort(byFreshness)
  // Category grouping is for the short working set only. With the archive open or a
  // search running the list is long and the useful order is purely "what did I touch
  // last", so buckets are dropped and everything stays in one date-sorted run.
  const flat = showArchived || searching
  const grouped = new Map<string, WorkspaceEntity[]>()
  for (const e of rest) {
    const cat = flat ? 'by date' : e.category || 'other'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(e)
  }

  return (
    <EntityControls entities={entities} onChanged={reload}>
    <div className={`app-layout${collapsed ? ' sidebar-collapsed' : ''}`} data-entity={route.id}>
      <Sidebar
        pinned={pinned}
        grouped={grouped}
        activeId={route.id}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        archivedCount={archivedCount}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived(v => !v)}
        total={entities.length}
        offline={offline}
        lastSync={lastSync}
        onCollapse={() => setCollapsed(true)}
      />

      <button
        className="sidebar-reopen"
        onClick={() => setCollapsed(false)}
        title="Show menu — press Mr. Mak's nose ( [ )"
        aria-label="Show menu"
      >
        <MakLogo size={38} animated={route.id !== 'my-dream-game'} />
      </button>

      <main className="main">
        <Topbar
          entity={entity}
          stepIndex={stepIndex}
          onStep={selectStep}
          onHome={goHome}
          // A compare3d step's "report" is a JSON manifest — opening it raw in a
          // tab helps nobody, so the external link is hidden for those.
          reportUrl={step?.viewer === 'compare3d' ? null : reportUrl}
        />

        <div className="content">
          <ReportBoundary key={reportUrl || 'home'} onHome={goHome}>
          {entity && reportUrl && step?.viewer === 'compare3d' ? (
            <Suspense fallback={<div className="boot"><MakLogo size={56} animated={false} /></div>}><Compare3D
              key={reportUrl}
              manifestUrl={reportUrl}
              baseUrl={reportUrl.slice(0, reportUrl.lastIndexOf('/'))}
            /></Suspense>
          ) : entity && reportUrl ? (
            <Suspense fallback={<div className="boot"><MakLogo size={56} animated={false} /></div>}><ReportViewer key={reportUrl} url={reportUrl} title={step?.name ?? entity.title} relativePath={`workspace/${entity.folder}/${step?.path}`} liveSource={liveSource} /></Suspense>
          ) : entity && step?.source ? (
            <div className="report-error" role="status">{isDesktop ? 'This live source is not configured. Check live-sources.json in the local state folder.' : 'Open this live Codex in the desktop app.'}</div>
          ) : (
            <HomeGrid
              entities={entities}
              pinned={pinned}
              grouped={grouped}
              offline={offline}
              searching={searching}
              query={query}
            />
          )}
          </ReportBoundary>
        </div>
      </main>
    </div>
    </EntityControls>
  )
}
