import { lazy, Suspense, useEffect } from 'react'
import App from '../App'
import { dismissError, sendEvent, startDesktop, surface, useDesktop } from './client'
import FilesRail, { FilePreview } from './FilesRail'
import VoiceDock from './VoiceDock'
import { Icon, Nose } from './Icons'
import './desktop.css'
import { t } from '../lib/i18n'

const Chats = lazy(() => import('./Chats'))

export default function DesktopApp() {
  const state = useDesktop()
  useEffect(() => { startDesktop() }, [])
  useEffect(() => {
    if (surface !== 'workspace') return
    const route = () => sendEvent({ type: 'workspace-route', route: location.hash })
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])
  if (!state.ready) return <div className="desktop-boot"><Nose size={70} /><h1>{t('Mr. Mak')}</h1><p>{state.error || t('Opening your workspace…')}</p>{state.error && <button className="desk-secondary" onClick={() => startDesktop()}>{t('Reconnect')}</button>}</div>
  return <div className={`desktop-root ${surface}-root`}>
    {surface === 'chats' ? <Suspense fallback={<div className="desktop-boot"><Nose size={50} /></div>}><Chats /></Suspense> : <><div className="workspace-surface"><App />{state.preview && <FilePreview file={state.preview} />}</div><FilesRail /></>}
    {state.error && <div className="desktop-error" role="alert"><span>{state.error}</span><button onClick={dismissError} aria-label={t('Dismiss error')}><Icon name="close" size={16} /></button></div>}
    {!state.connected && <div className="desktop-offline">{t('Reconnecting to the local service…')}</div>}
    <VoiceDock />
  </div>
}
