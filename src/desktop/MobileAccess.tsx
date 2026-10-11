import { useEffect, useState } from 'react'
import { api, onServiceEvent, useDesktop } from './client'
import { Icon } from './Icons'
import './mobile-access.css'
import DictationSettings from '../components/DictationSettings'
import { useDictation } from './useDictation'

interface MobileState {
  enabled: boolean; origin: string; error: string
  devices: { id: string; name: string; connected: boolean; lastSeen: string | null }[]
  pending: { id: string; name: string; code: string; expires: number }[]
}
interface Pairing { url: string; code: string; expires: number; qr: string }

export default function MobileAccess() {
  const desktop = useDesktop()
  const dictation = useDictation()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<MobileState | null>(null)
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [probe, setProbe] = useState<{ ready: boolean; message: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!desktop.connected) return
    const load = () => api<MobileState>('/mobile').then(setState).catch(() => {})
    void load()
    return onServiceEvent(event => { if (event.type === 'mobile-state') void load() })
  }, [desktop.connected])
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', escape)
    return () => { clearInterval(timer); window.removeEventListener('keydown', escape) }
  }, [open])
  async function action(route: string, data = {}) {
    setBusy(true); setError('')
    try { setState(await api<MobileState>(`/mobile/${route}`, data)); if (route === 'disable' || route === 'approve') setPairing(null) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  async function pair() {
    setBusy(true); setError('')
    try {
      if (!state?.enabled) setState(await api<MobileState>('/mobile/enable', {}))
      setPairing(await api<Pairing>('/mobile/pair', {})); setNow(Date.now())
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  const connected = state?.devices.filter(device => device.connected).length || 0
  const waiting = (state?.pending || []).filter(item => item.expires > now)
  return <>
    <button className={`desk-icon mobile-access-button ${connected || waiting.length ? 'active' : ''}`} aria-label="Mobile access" title={connected ? `Phone settings · ${connected} phone connected` : waiting.length ? 'Phone settings · Approve a phone connection' : 'Phone settings · Connect your phone'} onClick={() => setOpen(true)}><Icon name="phone" size={18} />{(connected > 0 || waiting.length > 0) && <i className={waiting.length ? 'pending' : ''} />}</button>
    {open && <div className="desk-scrim" onClick={() => setOpen(false)}><section className="desk-dialog mobile-access-dialog" role="dialog" aria-modal="true" aria-label="Mobile access" onClick={event => event.stopPropagation()}>
      <div className="desk-dialog-heading"><div><span className="desk-eyebrow">YOUR CHATS, WITH YOU</span><h2>Phone settings</h2></div><button className="desk-icon" aria-label="Close mobile access" onClick={() => setOpen(false)}><Icon name="close" /></button></div>
      <p className="mobile-access-intro">The agents keep working on this computer. Your phone opens the same conversations with its own view.</p>
      <div className="mobile-access-status"><span className={state?.enabled ? 'online' : ''} />{connected ? `${connected} phone${connected === 1 ? '' : 's'} connected` : state?.enabled ? 'Ready for your phone' : 'Mobile access is off'}</div>
      {waiting.map(item => <div className="mobile-pair-request" key={item.id}><strong>{item.name} wants to connect</strong><p>Check that this code matches the one on your phone.</p><code>{item.code}</code><div><button className="desk-primary" disabled={busy} onClick={() => action('approve', { id: item.id })}>Connect phone</button><button disabled={busy} onClick={() => action('revoke', { id: item.id })}>Decline</button></div></div>)}
      {pairing && pairing.expires > now && !waiting.length && <div className="mobile-qr"><img src={pairing.qr} alt="Scan to connect this phone to Mr. Mak" width="224" height="224" /><strong>Scan with your phone camera</strong><span>Or enter code <b>{pairing.code}</b> in the mobile app</span><p>Expires in {Math.ceil((pairing.expires - now) / 60000)} min. Confirm the connection here after scanning.</p><button onClick={() => navigator.clipboard.writeText(pairing.url).catch(() => setError('Could not copy the link. Scan the QR code instead.'))}>Copy connection link</button></div>}
      {!waiting.length && <button className="desk-primary" onClick={pair} disabled={busy || !desktop.connected}><Icon name="phone" size={17} />{busy ? 'Preparing connection…' : pairing && pairing.expires <= now ? 'Create a new QR code' : state?.enabled ? 'Connect another phone' : 'Enable & show QR code'}</button>}
      {(error || state?.error) && <div className="desk-error-inline" role="alert">{error || state?.error}<button aria-label="Dismiss mobile error" onClick={() => { setError(''); setState(current => current && { ...current, error: '' }) }}><Icon name="close" size={14} /></button></div>}
      {!!state?.devices.length && <div className="mobile-device-list"><h3>Your devices</h3>{state.devices.map(device => <div key={device.id}><Icon name="phone" /><span><strong>{device.name}</strong><small>{device.connected ? 'Connected now' : device.lastSeen ? `Last connected ${new Date(device.lastSeen).toLocaleString()}` : 'Paired · waiting for phone'}</small></span><button disabled={busy} onClick={() => action('revoke', { id: device.id })}>Disconnect</button></div>)}</div>}
      <details className="mobile-setup" open={!state?.enabled}><summary>First connection</summary><ol><li>Install <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale</a> on this computer and your phone.</li><li>Sign in to the same Tailscale account on both devices. Keep it connected.</li><li>Enable mobile access here, scan the QR code, then confirm the matching code.</li><li>On your phone, add Mr. Mak to your Home Screen from the browser menu.</li></ol><p>If HTTPS needs enabling, follow the <a href="https://tailscale.com/docs/features/tailscale-serve" target="_blank" rel="noreferrer">Tailscale Serve setup</a>.</p><button disabled={busy} onClick={async () => { setBusy(true); try { setProbe(await api('/mobile/check')) } catch { setError('Could not check Tailscale.') } finally { setBusy(false) } }}>Check Tailscale</button>{probe && <p role="status">{probe.ready ? 'Tailscale is ready. Enable mobile access above.' : probe.message}</p>}</details>
      <DictationSettings info={dictation.info} onChange={dictation.choose} disabled={!desktop.connected} />
      <footer className="mobile-access-footer"><span>Keep this computer awake and Mr. Mak running. A phone can send tasks with the chat's existing permissions.</span>{state?.enabled && <button disabled={busy} onClick={() => action('disable')}>Turn off mobile access</button>}</footer>
    </section></div>}
  </>
}
