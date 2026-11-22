import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../desktop/client'
import { entityHash } from '../lib/route'
import type { WorkspaceEntity } from '../types'
import type { CardTemplate } from '../../desktop/service/card-schema.mjs'
import '../styles/editable-cards.css'
import { t } from '../lib/i18n'

function NewCardDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(''), [template, setTemplate] = useState<CardTemplate>('gallery')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  async function create() {
    if (busy || !title.trim()) return
    setBusy(true); setError('')
    try {
      const { entity } = await api<{ entity: WorkspaceEntity }>('/workspace/cards', { title, template })
      window.dispatchEvent(new Event('mrmak-workspace-changed')); location.hash = entityHash(entity.id)
      onClose()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} className="new-card-dialog" aria-label={t('New Workspace card')} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onKeyDown={event => event.stopPropagation()}><form onSubmit={event => { event.preventDefault(); void create() }}>
    <div className="new-card-heading"><div><span>{t('Create in Workspace')}</span><h2>{t('A place for your next idea.')}</h2></div><button type="button" aria-label={t('Close new card')} disabled={busy} onClick={onClose}>×</button></div>
    <label>{t('Card title')}<input autoFocus required maxLength={200} placeholder={t('Character references, tool research…')} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
    <fieldset disabled={busy} className="new-card-templates"><legend>{t('Choose a starting view')}</legend>{(['gallery', 'research'] as const).map(value => <label key={value} className={template === value ? 'selected' : ''}><input type="radio" name="template" value={value} checked={template === value} onChange={() => setTemplate(value)} /><strong>{value === 'gallery' ? t('Gallery') : t('Research')}</strong><span>{value === 'gallery' ? t('Images, reference notes and saved prompts.') : t('Findings, source links and decisions.')}</span></label>)}</fieldset>
    <p className="new-card-hint">{t('Edit it yourself or ask your agent to update it. You can switch views later.')}</p>
    {error && <p className="card-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button type="submit" className="card-primary" disabled={busy || !title.trim()}>{busy ? t('Creating…') : t('Create card')}</button></footer>
  </form></dialog>, document.body)
}

export default function NewCard() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return <><button ref={button} className="new-card-button" onClick={() => setOpen(true)}>{t('+ New card')}</button>{open && <NewCardDialog onClose={() => { setOpen(false); button.current?.focus() }} />}</>
}
