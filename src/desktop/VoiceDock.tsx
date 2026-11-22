import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api, clientId, onServiceEvent, reportError, surface, useDesktop } from './client'
import { liveVoice } from './live'
import { Icon, Nose } from './Icons'
import MakComposer from './MakComposer'
import MakImages from './MakImages'
import type { Operation } from './types'
import { t } from '../lib/i18n'

export default function VoiceDock() {
  const state = useDesktop()
  const live = useSyncExternalStore(liveVoice.subscribe, liveVoice.snapshot)
  const [panel, setPanel] = useState(false)
  const [tab, setTab] = useState<'conversation' | 'activity'>('conversation')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const active = ['live', 'connecting', 'closing'].includes(live.status)
  const otherVoice = state.voice.owner && state.voice.owner.clientId !== clientId
  useEffect(() => onServiceEvent(event => {
    if (event.type === 'disconnected') liveVoice.disconnect()
    if (event.type === 'notice' && event.notice) liveVoice.announce(`Verified terminal event: ${event.notice.text}. This does not by itself confirm that the project task succeeded.`)
    if (['session', 'navigate', 'connected'].includes(event.type)) liveVoice.context()
  }), [])
  useEffect(() => { if (panel) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [live.captions, state.operations, panel])
  const toggle = () => { if (active) liveVoice.stop(); else { setPanel(true); liveVoice.start() } }
  async function send(text: string, images: string[]) {
    setSending(true)
    try {
      const result = await api<Operation>('/coordinator', { id: crypto.randomUUID(), text, images, selectedId: state.selectedId })
      if (result.status !== 'completed') throw new Error(result.result || t('Mr. Mak could not complete this request.'))
    } finally { setSending(false) }
  }
  return <div className={`voice-dock ${surface} ${active ? 'is-live' : ''} ${panel ? 'panel-open' : ''}`}>
    <section className="voice-panel" hidden={!panel} style={{ display: panel ? undefined : 'none' }} aria-label={t('Mr. Mak conversation')}><header><span><Nose size={24} /><strong>{t('Mr. Mak')}</strong><small>{live.status === 'live' ? t('Listening') : live.status === 'connecting' ? t('Connecting…') : live.status === 'closing' ? t('Finishing…') : state.coordinator === 'working' ? t('Working…') : t('At your service')}</small></span><button className="desk-icon" title={t('Hide conversation · voice stays as selected')} onClick={() => setPanel(false)}><Icon name="close" size={16} /></button></header><div className="voice-tabs"><button className={tab === 'conversation' ? 'selected' : ''} onClick={() => setTab('conversation')}>{t('Conversation')}</button><button className={tab === 'activity' ? 'selected' : ''} onClick={() => setTab('activity')}>{t('Activity')}{state.notices.length > 0 && <span>{state.notices.length}</span>}</button></div><div className="voice-settings"><label>{t('Codex')}<select aria-label={t('Coordinator reasoning')} value={state.settings.coordinatorEffort || 'medium'} onChange={event => api('/settings', { coordinatorEffort: event.target.value }).catch(reportError)}><option value="medium">{t('Medium')}</option><option value="high">{t('High')}</option></select></label><span>{t('Codex subscription')}</span></div><div className="voice-messages" aria-live="polite">
      {tab === 'conversation' ? <>{live.captions.length === 0 && state.operations.length === 0 && <div className="voice-welcome"><p>{t('One conversation.')}<br />{t('All your agents.')}</p><span>{t('“Open the Dream Game chat.”')}<br />{t('“Ask Claude to check the animation.”')}</span></div>}{state.operations.slice(-15).map(operation => <div key={operation.id} className="mak-exchange"><p className="caption user"><span>{t('You')}</span>{operation.text}</p>{!!operation.images?.length && <MakImages paths={operation.images} />}<p className={`caption assistant ${operation.status !== 'completed' ? 'failed' : ''}`}><span>{t('Mr. Mak')}</span>{operation.result || t('Working…')}</p></div>)}{!live.captions.length && state.voiceHistory.length > 0 && <details className="previous-voice"><summary>{t('Previous voice conversation')}</summary>{state.voiceHistory[state.voiceHistory.length - 1].captions.map((caption, index) => <p key={index} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? t('You') : t('Mr. Mak')}</span>{caption.text}</p>)}</details>}{live.captions.map((caption, index) => <p key={`${caption.start}-${index}`} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? t('You') : t('Mr. Mak')}</span>{caption.text}</p>)}{(sending || state.coordinator === 'working') && <p className="voice-working"><i /><i /><i />{t('Checking your workspace')}</p>}<div ref={bottom} /></> : <>{state.notices.length === 0 && <p className="desk-muted">{t('Terminal attention requests and exits appear here.')}</p>}{[...state.notices].reverse().map(notice => <button className="activity-item" key={notice.id} onClick={() => api(`/sessions/${notice.sessionId}/focus`, {}).catch(reportError)}><Icon name="bell" size={16} /><span><strong>{notice.name}</strong><small>{notice.text}</small></span><time>{new Date(notice.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></button>)}</>}
    </div>{live.error && <div className="voice-error" role="alert"><span>{live.error}</span><button className="desk-icon" aria-label={t('Dismiss voice error')} onClick={() => liveVoice.dismissError()}><Icon name="close" size={14} /></button></div>}{!live.audible && <button className="desk-secondary" onClick={() => liveVoice.enablePlayback()}>{t('Enable speaker audio')}</button>}{otherVoice && <div className="voice-hint">{t('Voice is active in {window}. Use that window to stop it.', { window: t(String(state.voice.owner?.surface ?? '')) })}</div>}<MakComposer connected={state.connected} sending={sending} onSend={send} /></section>
    <div className="voice-controls"><button className="voice-nose" title={active ? t('Stop voice conversation') : t('Talk to Mr. Mak')} aria-label={active ? t('Stop voice') : t('Start voice')} aria-pressed={active} onClick={toggle} disabled={!!otherVoice || !state.connected || live.status === 'closing'}><Nose size={35} /><span>{live.status === 'live' ? t('Listening') : live.status === 'connecting' ? t('Connecting') : live.status === 'closing' ? t('Finishing') : t('Talk to Mak')}</span>{live.status === 'live' && <div className="voice-wave"><i /><i /><i /><i /></div>}</button><button className={`voice-caption-toggle ${panel ? 'selected' : ''}`} title={panel ? t('Hide conversation') : t('Conversation and activity')} onClick={() => setPanel(value => !value)} aria-label={t('Toggle conversation')}><Icon name="chats" size={17} />{state.notices.some(notice => state.sessions.find(item => item.id === notice.sessionId)?.attention) && <i />}</button></div>
  </div>
}
