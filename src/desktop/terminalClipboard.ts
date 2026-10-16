// OSC 52 is output from an untrusted program, not a browser copy gesture.
// Allow one write after the owner selects text or presses Copy in this terminal.
export const terminalCopyWindow = 2000
export function terminalClipboardGate(now = () => performance.now()) {
  let until = 0
  return {
    arm(trusted: boolean) { if (trusted) until = now() + terminalCopyWindow },
    clear() { until = 0 },
    read(data: string, ready: boolean, foreground: boolean): string | null {
      if (!ready || !foreground || !until || now() > until) return null
      const separator = data.indexOf(';'), target = data.slice(0, separator), payload = data.slice(separator + 1)
      if (separator < 0 || !['', 'c'].includes(target) || !payload || payload.length > 4 * 1024 * 1024 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(payload), char => char.charCodeAt(0)))
        until = 0
        return text
      } catch { return null }
    },
  }
}

export type PendingCopy = { fill(text: string): void; cancel(): void }
// WKWebView (macOS) writes the clipboard only inside the user gesture, and OSC 52
// arrives later from the socket. Start the write while arming and fill it with the
// program's text; a cancelled write leaves the clipboard unchanged.
export function deferredClipboardWrite(clipboard: Pick<Clipboard, 'write'> | undefined, onError: (error: unknown) => void): PendingCopy | null {
  if (typeof ClipboardItem !== 'function' || typeof clipboard?.write !== 'function') return null
  let resolve: (blob: Blob) => void = () => {}, reject: (reason: Error) => void = () => {}, filled = false
  const blob = new Promise<Blob>((ok, fail) => { resolve = ok; reject = fail })
  blob.catch(() => {})
  clipboard.write([new ClipboardItem({ 'text/plain': blob })]).catch(error => { if (filled) onError(error) })
  return {
    fill(text) { filled = true; resolve(new Blob([text], { type: 'text/plain' })) },
    cancel() { reject(new Error('Terminal copy expired.')) },
  }
}
