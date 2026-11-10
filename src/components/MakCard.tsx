import { useState } from 'react'
import type { WorkspaceEntity } from '../types'
import { entityHash } from '../lib/route'
import { cardCover, cardPhase, cardProgress } from '../lib/card-meta'
import { categoryIcon } from '../lib/categories'
import { contentUrl } from '../desktop/client'
import { EntityStatusButton } from './EntityControls'

/**
 * The design-system card: glass surface over the aura, gradient edge
 * (pink→purple; amber when pinned), glow + lift on hover. Building
 * block of the home grid; mirrored as `.mak-card` in
 * scripts/shared/report_style.py for generated reports.
 */
export default function MakCard({ entity }: { entity: WorkspaceEntity }) {
  const steps = entity.steps.length
  // Cover, phase and progress are optional; a card without them is unchanged.
  // A cover that fails to load is dropped, so it leaves no empty band.
  const cover = cardCover(entity)
  const coverUrl = cover
    ? contentUrl(`/workspace/${entity.folder}/${cover.split('/').map(encodeURIComponent).join('/')}`)
    : null
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const showCover = coverUrl !== null && failedCover !== coverUrl
  const phase = cardPhase(entity)
  const progress = cardProgress(entity)
  return (
    <div className={`entity-card-wrap${showCover ? ' has-cover' : ''}`} data-card={entity.id}>
    <a
      href={entityHash(entity.id)}
      className={`mak-card entity-card${entity.pinned ? ' pinned' : ''}`}
      data-entity={entity.id}
    >
      {showCover && (
        <div className="card-cover">
          <img src={coverUrl} alt="" loading="lazy" decoding="async" onError={() => setFailedCover(coverUrl)} />
        </div>
      )}
      <div className="card-top">
        <span className="chip">
          <span aria-hidden="true">{categoryIcon(entity.category)}</span>
          {entity.category || 'other'}
        </span>
        {entity.pinned && <span className="chip chip-pin">pinned</span>}
      </div>

      <div className="card-project-title">
        {entity.icon && <img className="card-project-icon" src={contentUrl(`/workspace/${entity.folder}/${entity.icon}`)} width="48" height="48" alt="" loading="lazy" decoding="async" />}
        <h3 className="card-title">{entity.title}</h3>
      </div>

      {entity.description && <p className="card-desc">{entity.description}</p>}

      {(phase || progress) && (
        <div className="card-status">
          {phase && (
            <span className="chip chip-phase" title={phase}>
              <span>{phase}</span>
            </span>
          )}
          {progress && (
            <div className="card-progress">
              <div className="card-progress-text" aria-hidden="true">
                <b>{progress.done}/{progress.total}</b>
                {progress.label && <span>{progress.label}</span>}
              </div>
              <div
                className="card-progress-bar"
                role="progressbar"
                aria-label="Progress"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
                aria-valuetext={`${progress.done} of ${progress.total}${progress.label ? ` ${progress.label}` : ''}`}
              >
                <span style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card-foot">
        <span>
          {steps} step{steps === 1 ? '' : 's'}
        </span>
        <span>·</span>
        <span>{entity.updated ?? entity.created}</span>
        <span className="card-open" aria-hidden="true">
          open →
        </span>
      </div>
    </a>
    <EntityStatusButton entity={entity} />
    </div>
  )
}
