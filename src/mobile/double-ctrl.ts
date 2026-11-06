// Double-tap Ctrl: two Ctrl presses with no other key or modifier in between.
const WINDOW_MS = 450
const targets: (() => boolean)[] = []
let held = false, clean = false, lastTap = 0

function reset() { held = false; clean = false; lastTap = 0 }
function fire() { for (let index = targets.length - 1; index >= 0; index--) if (targets[index]()) return }
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Control') { clean = false; lastTap = 0; return }
  if (event.repeat) { clean = false; return }
  held = true; clean = true
}
function keyup(event: KeyboardEvent) {
  if (event.key !== 'Control' || !held) return
  held = false
  if (!clean) { lastTap = 0; return }
  const now = performance.now()
  if (lastTap && now - lastTap < WINDOW_MS) { lastTap = 0; fire() } else lastTap = now
}

/** Calls the most recently registered handler that returns true; returns an unregister function. */
export function onDoubleCtrl(handler: () => boolean) {
  targets.push(handler)
  if (targets.length === 1) {
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true); window.addEventListener('blur', reset)
  }
  return () => {
    targets.splice(targets.indexOf(handler), 1)
    if (targets.length) return
    window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', reset)
    reset()
  }
}
