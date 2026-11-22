import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceEntity } from '../types'
import { updateWorkspaceEntity, type EntityPatch } from '../lib/workspace'
import { CATEGORY_ICONS } from '../lib/categories'
import { isDesktop } from '../desktop/client'
import './entity-controls.css'
import { t } from '../lib/i18n'

const labels = { active: 'Active', done: 'Done', archived: 'Archived' } as const
const Controls = createContext<{ open: (entity: WorkspaceEntity, button: HTMLButtonElement) => void; editing: string | null } | null>(null)
type Target = { id: string; button: HTMLButtonElement; anchor: DOMRect }

export function EntityStatusButton({ entity }: { entity: WorkspaceEntity }) {
  const controls = useContext(Controls)
  return (
    <button
      type="button"
      className="entity-status-button"
      aria-label={t('Edit {title}: {status}', { title: entity.title, status: t(labels[entity.status]) })}
      aria-haspopup="dialog"
      aria-expanded={controls?.editing === entity.id}
      title={`${t(labels[entity.status])} · ${isDesktop ? t('Change status or category') : t('Open the desktop app to edit this card')}`}
      disabled={!isDesktop}
      onClick={event => controls?.open(entity, event.currentTarget)}
    >
      <span className={`status-dot ${entity.status}`} aria-hidden="true" />
    </button>
  )
}

function EntityMenu({ entity, entities, target, onClose, onChanged }: {
  entity: WorkspaceEntity
  entities: WorkspaceEntity[]
  target: Target
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const category = entity.category || 'other'
  const categories = [...new Set([...Object.keys(CATEGORY_ICONS), 'project', 'tools', 'other', ...entities.map(item => item.category).filter(Boolean)])].sort()

  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    const position = () => {
      const rect = target.button.isConnected ? target.button.getBoundingClientRect() : target.anchor
      const width = element.offsetWidth, height = element.offsetHeight
      element.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`
      element.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(element)
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position); element.close() }
  }, [target])

  useEffect(() => {
    const navigate = () => onClose()
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [onClose])

  async function save(patch: EntityPatch) {
    if (saving) return
    setSaving(true); setError('')
    try {
      await updateWorkspaceEntity(entity.id, patch)
      await onChanged()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('The card could not be updated. Try again.'))
    } finally { setSaving(false) }
  }

  return createPortal(
    <dialog
      ref={dialog}
      className="entity-menu"
      aria-label={t('Card settings: {title}', { title: entity.title })}
      aria-busy={saving}
      onCancel={event => { event.preventDefault(); if (!saving) onClose() }}
      onClick={event => {
        if (event.target !== event.currentTarget || saving) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      }}
      onKeyDown={event => event.stopPropagation()}
    >
      <div className="entity-menu-heading">
        <div><span>{t('Card settings')}</span><h2>{entity.title}</h2></div>
        <button type="button" className="entity-menu-close" aria-label={t('Close card settings')} disabled={saving} onClick={onClose}>×</button>
      </div>
      <fieldset disabled={saving}>
        <legend>{t('Status')}</legend>
        <div className="entity-status-options">
          {(Object.keys(labels) as Array<WorkspaceEntity['status']>).map(status => (
            <button type="button" key={status} aria-pressed={entity.status === status} onClick={() => void save({ status })}>
              <span className={`status-dot ${status}`} aria-hidden="true" />
              <span>{t(labels[status])}</span>
              <span className="entity-status-check" aria-hidden="true">{entity.status === status ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <label className="entity-category-control">
        {t('Category')}
        <select aria-label={t('Card category')} value={category} disabled={saving} onChange={event => void save({ category: event.target.value })}>
          {categories.map(value => <option key={value} value={value}>{value.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</option>)}
        </select>
      </label>
      <button type="button" className="entity-pin-toggle" disabled={saving} onClick={() => void save({ pinned: !entity.pinned })}>
        {entity.pinned ? t('Unpin card') : t('Pin card')}
      </button>
      <p className="entity-menu-hint">{t('Archived cards keep their files and tabs. Find them in search or Show archive.')}</p>
      {saving && <p className="entity-menu-feedback" role="status">{t('Saving…')}</p>}
      {error && <p className="entity-menu-error" role="alert">{error}</p>}
    </dialog>, document.body,
  )
}

export default function EntityControls({ entities, onChanged, children }: {
  entities: WorkspaceEntity[]
  onChanged: () => Promise<void>
  children: ReactNode
}) {
  const [target, setTarget] = useState<Target | null>(null)
  const entity = entities.find(item => item.id === target?.id)
  function close() {
    setTarget(null)
    if (target?.button.isConnected) target.button.focus({ preventScroll: true })
  }
  return (
    <Controls.Provider value={{ editing: target?.id ?? null, open: (item, button) => setTarget({ id: item.id, button, anchor: button.getBoundingClientRect() }) }}>
      {children}
      {entity && target && <EntityMenu key={entity.id} entity={entity} entities={entities} target={target} onClose={close} onChanged={onChanged} />}
    </Controls.Provider>
  )
}
