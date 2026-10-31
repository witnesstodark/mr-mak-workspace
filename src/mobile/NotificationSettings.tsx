import { useEffect, useState } from 'react'
import { mobileApi } from './client'

// The push service takes the key as raw bytes; Mr. Mak sends it as base64url.
const keyBytes = (key: string) => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')), char => char.charCodeAt(0))
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// Notifications when a chat waits for you. iPhone offers them only to the installed app.
export default function NotificationSettings({ disabled }: { disabled: boolean }) {
  const [info, setInfo] = useState<{ publicKey: string; enabled: boolean } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (!supported()) return
    let active = true
    void (async () => {
      const value = await mobileApi<{ publicKey: string; enabled: boolean }>('/push')
      // This browser may have dropped its subscription while the computer still had it.
      const local = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
      if (active) setInfo({ ...value, enabled: value.enabled && !!local })
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
        setInfo(await mobileApi('/push', { subscription: null }))
      } else {
        if (await Notification.requestPermission() !== 'granted') { setError('Allow notifications for Mr. Mak in this browser’s settings, then try again.'); return }
        const subscription = current || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) })
        setInfo(await mobileApi('/push', { subscription: subscription.toJSON() }))
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <fieldset className="mobile-reading-settings"><legend>Notifications</legend>
    {!supported() ? <p>On iPhone, add Mr. Mak to your Home Screen and open it from there to turn on notifications.</p>
      : <><p>{info?.enabled ? 'This phone is notified when a chat is waiting for you.' : 'Get a notification when a chat is waiting for you.'}</p><button onClick={() => void toggle()} disabled={disabled || busy || !info}>{info?.enabled ? 'Turn off notifications' : 'Turn on notifications'}</button></>}
    {error && <p role="alert">{error}</p>}
  </fieldset>
}
