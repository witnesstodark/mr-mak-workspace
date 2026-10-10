import { useEffect, useRef, useState } from 'react'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
const installedDisplay = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)

export function useInstall() {
  const prompt = useRef<InstallPrompt | null>(null)
  const [available, setAvailable] = useState(false), [installed, setInstalled] = useState(installedDisplay)
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('mrmak.mobile.install-dismissed') === 'true')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)')
    const syncDisplay = () => setInstalled(installedDisplay())
    const ready = (event: Event) => {
      event.preventDefault()
      prompt.current = event as InstallPrompt
      setAvailable(true); setError('')
    }
    const complete = () => { prompt.current = null; setAvailable(false); setInstalled(true); setError('') }
    window.addEventListener('beforeinstallprompt', ready)
    window.addEventListener('appinstalled', complete)
    display.addEventListener('change', syncDisplay)
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', complete); display.removeEventListener('change', syncDisplay) }
  }, [])
  function dismiss() { setDismissed(true); sessionStorage.setItem('mrmak.mobile.install-dismissed', 'true') }
  async function install() {
    const event = prompt.current
    if (!event || busy || installed) return
    prompt.current = null; setAvailable(false); setBusy(true); setError('')
    try {
      await event.prompt()
      const choice = await event.userChoice
      if (choice.outcome === 'accepted') setInstalled(true)
      else dismiss()
    } catch { setError('Installation could not open. Use your browser’s Install app or Add to Home Screen menu.') }
    finally { setBusy(false) }
  }
  return { available: available && !installed, installed, dismissed, busy, error, dismiss, install }
}
