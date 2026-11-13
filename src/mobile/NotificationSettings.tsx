import { useEffect, useState } from 'react'
import { Icon } from '../desktop/Icons'
import { mobileApi, muteMobileChat, useMobile } from './client'

interface PushStatus { publicKey: string; enabled: boolean }

// The push service takes the key as raw bytes; Mr. Mak sends it as base64url.
const keyBytes = (key: string) => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')), char => char.charCodeAt(0))
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// Notifications when a chat waits for you. iPhone offers them only to the installed app.
export default function NotificationSettings({ disabled }: { disabled: boolean }) {
  const [info, setInfo] = useState<PushStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!supported()) return
    let active = true
    void (async () => {
      const value = await mobileApi<PushStatus>('/push')
      // This browser may have dropped its subscription while the computer still had it.
      const local = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
      if (active) setInfo({ publicKey: value.publicKey, enabled: value.enabled && !!local })
    })().catch(() => { if (active) setError('Could not read the notification setting.') })
    return () => { active = false }
  }, [])
  async function toggle() {
    if (!info) return
    setBusy(true); setError('')
    try {
      const registration = await navigator.serviceWorker.ready
      const current = await registration.pushManager.getSubscription()
      if (info.enabled) {
        await current?.unsubscribe()
        const value = await mobileApi<PushStatus>('/push', { subscription: null })
        setInfo({ publicKey: value.publicKey, enabled: value.enabled })
      } else {
        if (await Notification.requestPermission() !== 'granted') { setError('Allow notifications for Mr. Mak in this browser’s settings, then try again.'); return }
        const subscription = current || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) })
        const value = await mobileApi<PushStatus>('/push', { subscription: subscription.toJSON() })
        setInfo({ publicKey: value.publicKey, enabled: value.enabled })
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <fieldset className="mobile-reading-settings"><legend>Notifications</legend>
    {!supported() ? <p>On iPhone, add Mr. Mak to your Home Screen and open it from there to turn on notifications.</p>
      : <><p>{info?.enabled ? 'This phone is notified when a chat is waiting for you, unless that chat is open on a phone screen or muted with its bell.' : 'Get a notification when a chat is waiting for you.'}</p><button onClick={() => void toggle()} disabled={disabled || busy || !info}>{info?.enabled ? 'Turn off notifications' : 'Turn on notifications'}</button></>}
    {error && <p role="alert">{error}</p>}
  </fieldset>
}

// The bell beside a chat's views: a muted chat sends no notification to any paired phone.
export function MuteChat({ id, onError }: { id: string; onError: (message: string) => void }) {
  const state = useMobile(), muted = !!state.mutedChats?.includes(id), [busy, setBusy] = useState(false)
  async function toggle() {
    setBusy(true)
    try { await muteMobileChat(id, !muted); onError('') }
    catch (failure) { onError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <button type="button" className={`mobile-icon mobile-chat-mute ${muted ? 'muted' : ''}`} aria-label="Mute notifications" aria-pressed={muted} title={muted ? 'Notifications for this chat are muted' : 'Mute notifications for this chat'} disabled={!state.connected || busy} onClick={() => void toggle()}><Icon name={muted ? 'bell-off' : 'bell'} size={17} /></button>
}
