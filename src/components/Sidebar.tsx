import type { RefObject } from 'react'
import type { WorkspaceEntity } from '../types'
import { entityHash } from '../lib/route'
import { categoryIcon } from '../lib/categories'
import { contentUrl } from '../desktop/client'
import MakLogo from './MakLogo'
import MakText from './MakText'
import { EntityStatusButton } from './EntityControls'

interface SidebarProps {
  pinned: WorkspaceEntity[]
  grouped: Map<string, WorkspaceEntity[]>
  activeId: string | null
  query: string
  onQuery: (q: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  archivedCount: number
  showArchived: boolean
  onToggleArchived: () => void
  total: number
  offline: boolean
  lastSync: Date | null
  onCollapse: () => void
}

function Item({ entity, active }: { entity: WorkspaceEntity; active: boolean }) {
  return (
    <div className="sidebar-item-row" data-card={entity.id}>
    <a
      href={entityHash(entity.id)}
      className={`sidebar-item${active ? ' active' : ''}${entity.pinned ? ' pinned' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="item-icon" aria-hidden="true">
        {entity.icon ? <img src={contentUrl(`/workspace/${entity.folder}/${entity.icon}`)} width="24" height="24" alt="" decoding="async" /> : categoryIcon(entity.category)}
      </span>
      <span className="item-text">{entity.title}</span>
    </a>
    <EntityStatusButton entity={entity} />
    </div>
  )
}

export default function Sidebar({
  pinned,
  grouped,
  activeId,
  query,
  onQuery,
  searchRef,
  archivedCount,
  showArchived,
  onToggleArchived,
  total,
  offline,
  lastSync,
  onCollapse,
}: SidebarProps) {
  const empty = pinned.length === 0 && grouped.size === 0

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <MakLogo size={54} animated={activeId !== 'my-dream-game'} />
        <div className="brand-text">
          <MakText height={26} animated={activeId !== 'my-dream-game'} />
          <span className="brand-sub">workspace</span>
        </div>
        <button
          className="sidebar-collapse"
          onClick={onCollapse}
          title="Hide menu ( [ )"
          aria-label="Hide menu"
        >
          ‹
        </button>
      </div>

      <div className="sidebar-search">
        <span className="search-icon" aria-hidden="true">
          {'⌕'}
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={ev => onQuery(ev.target.value)}
          onKeyDown={ev => {
            if (ev.key === 'Escape') {
              onQuery('')
              ev.currentTarget.blur()
            }
          }}
          placeholder="Search…  ( / )"
          aria-label="Search entities"
        />
        {query && (
          <button className="search-clear" onClick={() => onQuery('')} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      <nav className="sidebar-list">
        <div style={{ marginBottom: 6 }}>
          <div className="sidebar-section">
            <span className="sidebar-label">🛠 Tools</span>
          </div>
          <div className="sidebar-item-row">
            <a
              href="#/ui-studio"
              className={`sidebar-item${activeId === 'ui-studio' ? ' active' : ''}`}
            >
              <span className="item-icon" aria-hidden="true">🎮</span>
              <span className="item-text">Game UI Studio</span>
            </a>
          </div>
        </div>

        {pinned.length > 0 && (
          <div>
            <div className="sidebar-section">
              <span className="sidebar-label">{'\u{1F4CC}'} pinned</span>
            </div>
            {pinned.map(e => (
              <Item key={e.id} entity={e} active={e.id === activeId} />
            ))}
          </div>
        )}

        {[...grouped.entries()].map(([cat, list]) => (
          <div key={cat}>
            <div className="sidebar-section">
              <span className="sidebar-label">{cat.replace(/-/g, ' ')}</span>
              <span className="sidebar-count">{list.length}</span>
            </div>
            {list.map(e => (
              <Item key={e.id} entity={e} active={e.id === activeId} />
            ))}
          </div>
        ))}

        {empty && <div className="sidebar-empty">Nothing matches, sir.</div>}

        {archivedCount > 0 && !query && (
          <button className="sidebar-archive-toggle" onClick={onToggleArchived}>
            {showArchived
              ? `▼ Hide archive (${archivedCount})`
              : `▶ Show archive (${archivedCount})`}
          </button>
        )}
      </nav>

      <footer className="sidebar-foot">
        <span className={`sync-dot${offline ? ' offline' : ''}`} />
        <span>
          {total} entities ·{' '}
          {offline
            ? 'offline'
            : lastSync
              ? `synced ${lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'syncing…'}
        </span>
      </footer>
    </aside>
  )
}
