import type { WorkspaceEntity } from '../types'
import { isDesktop } from '../desktop/client'
import BrowserSettings from './BrowserSettings'
import { EntityStatusButton } from './EntityControls'
import NewCard from './NewCard'

interface TopbarProps {
  entity: WorkspaceEntity | null
  stepIndex: number
  onStep: (id: string, index: number) => void
  onHome: () => void
  reportUrl: string | null
  isUIStudio?: boolean
  onToggleUIStudio?: () => void
}

export default function Topbar({
  entity,
  stepIndex,
  onStep,
  onHome,
  reportUrl,
  isUIStudio = false,
  onToggleUIStudio,
}: TopbarProps) {
  return (
    <div className="topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <button className="crumb-link" onClick={onHome}>
          Workspace
        </button>
        {isUIStudio && (
          <>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">🎮 Game UI Studio</span>
          </>
        )}
        {!isUIStudio && entity && (
          <>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{entity.title}</span>
            <EntityStatusButton entity={entity} />
          </>
        )}
        <div className="topbar-right-group">
          <button
            className={`topbar-tool-btn${isUIStudio ? ' active' : ''}`}
            onClick={onToggleUIStudio}
            title="Game UI Studio · Design & AI Copilot Tool"
          >
            🎮 UI Studio
          </button>
          {!isDesktop && <BrowserSettings />}
          {isDesktop && <NewCard />}
        </div>
      </nav>

      {entity && (
        <div className="topbar-right">
          {entity.steps.length > 0 && (
            <div className="step-tabs" role="tablist">
              {entity.steps.map((s, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === stepIndex}
                  className={`step-tab${i === stepIndex ? ' active' : ''}`}
                  onClick={() => onStep(entity.id, i)}
                  title={s.name}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {reportUrl && (
            <a
              className="open-ext"
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              title="Open report in a new tab"
            >
              ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}
