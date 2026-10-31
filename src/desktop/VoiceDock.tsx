import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api, clientId, onServiceEvent, reportError, surface, useDesktop } from './client'
import { liveVoice } from './live'
import { Icon, Nose } from './Icons'
import MakComposer from './MakComposer'
import MakImages from './MakImages'
import type { Operation } from './types'

export default function VoiceDock() {
  const state = useDesktop()
  const coordinatorLabel = state.settings.coordinatorAgent === 'claude' ? 'Claude Code' : 'Codex'
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
      if (result.status !== 'completed') throw new Error(result.result || 'Mr. Mak could not complete this request.')
    } finally { setSending(false) }
  }
  return <div className={`voice-dock ${surface} ${active ? 'is-live' : ''} ${panel ? 'panel-open' : ''}`}>
    <section className="voice-panel" hidden={!panel} style={{ display: panel ? undefined : 'none' }} aria-label="Mr. Mak conversation"><header><span><Nose size={24} /><strong>Mr. Mak</strong><small>{live.status === 'live' ? 'Listening' : live.status === 'connecting' ? 'Connecting…' : live.status === 'closing' ? 'Finishing…' : state.coordinator === 'working' ? 'Working…' : 'At your service'}</small></span><button className="desk-icon" title="Hide conversation · voice stays as selected" onClick={() => setPanel(false)}><Icon name="close" size={16} /></button></header><div className="voice-tabs"><button className={tab === 'conversation' ? 'selected' : ''} onClick={() => setTab('conversation')}>Conversation</button><button className={tab === 'activity' ? 'selected' : ''} onClick={() => setTab('activity')}>Activity{state.notices.length > 0 && <span>{state.notices.length}</span>}</button></div><div className="voice-settings"><label>{coordinatorLabel}<select aria-label="Coordinator reasoning" value={state.settings.coordinatorEffort || 'medium'} onChange={event => api('/settings', { coordinatorEffort: event.target.value }).catch(reportError)}><option value="medium">Medium</option><option value="high">High</option></select></label><span>{coordinatorLabel} subscription</span></div><div className="voice-messages" aria-live="polite">
      {tab === 'conversation' ? <>{live.captions.length === 0 && state.operations.length === 0 && <div className="voice-welcome"><p>One conversation.<br />All your agents.</p><span>“Open the Dream Game chat.”<br />“Ask Claude to check the animation.”</span></div>}{state.operations.slice(-15).map(operation => <div key={operation.id} className="mak-exchange"><p className="caption user"><span>You</span>{operation.text}</p>{!!operation.images?.length && <MakImages paths={operation.images} />}<p className={`caption assistant ${operation.status !== 'completed' ? 'failed' : ''}`}><span>Mr. Mak</span>{operation.result || 'Working…'}</p></div>)}{!live.captions.length && state.voiceHistory.length > 0 && <details className="previous-voice"><summary>Previous voice conversation</summary>{state.voiceHistory[state.voiceHistory.length - 1].captions.map((caption, index) => <p key={index} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? 'You' : 'Mr. Mak'}</span>{caption.text}</p>)}</details>}{live.captions.map((caption, index) => <p key={`${caption.start}-${index}`} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? 'You' : 'Mr. Mak'}</span>{caption.text}</p>)}{(sending || state.coordinator === 'working') && <p className="voice-working"><i /><i /><i />Checking your workspace</p>}<div ref={bottom} /></> : <>{state.notices.length === 0 && <p className="desk-muted">Terminal attention requests and exits appear here.</p>}{[...state.notices].reverse().map(notice => <button className="activity-item" key={notice.id} onClick={() => api(`/sessions/${notice.sessionId}/focus`, {}).catch(reportError)}><Icon name="bell" size={16} /><span><strong>{notice.name}</strong><small>{notice.text}</small></span><time>{new Date(notice.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></button>)}</>}
    </div>{live.error && <div className="voice-error" role="alert"><span>{live.error}</span><button className="desk-icon" aria-label="Dismiss voice error" onClick={() => liveVoice.dismissError()}><Icon name="close" size={14} /></button></div>}{!live.audible && <button className="desk-secondary" onClick={() => liveVoice.enablePlayback()}>Enable speaker audio</button>}{otherVoice && <div className="voice-hint">Voice is active in {state.voice.owner?.surface}. Use that window to stop it.</div>}<MakComposer connected={state.connected} sending={sending} onSend={send} /></section>
    <div className="voice-controls"><button className="voice-nose" title={active ? 'Stop voice conversation' : 'Talk to Mr. Mak'} aria-label={active ? 'Stop voice' : 'Start voice'} aria-pressed={active} onClick={toggle} disabled={!!otherVoice || !state.connected || live.status === 'closing'}><Nose size={35} /><span>{live.status === 'live' ? 'Listening' : live.status === 'connecting' ? 'Connecting' : live.status === 'closing' ? 'Finishing' : 'Talk to Mak'}</span>{live.status === 'live' && <div className="voice-wave"><i /><i /><i /><i /></div>}</button><button className={`voice-caption-toggle ${panel ? 'selected' : ''}`} title={panel ? 'Hide conversation' : 'Conversation and activity'} onClick={() => setPanel(value => !value)} aria-label="Toggle conversation"><Icon name="chats" size={17} />{state.notices.some(notice => state.sessions.find(item => item.id === notice.sessionId)?.attention) && <i />}</button></div>
  </div>
}
