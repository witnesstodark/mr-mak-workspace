// AbortSignal.any needs WebKit 17.4. Older WKWebView (macOS app) and iOS Safari
// lack it, so combine the signals by hand there.
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(signal.reason); break }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true, signal: controller.signal })
  }
  return controller.signal
}
