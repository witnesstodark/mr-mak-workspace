import { useRef, useEffect } from 'react'

// Render "Mr. Mak" as animated particle dots.
// Technique: draw text to an offscreen canvas, sample pixels, animate as particles.
// Re-samples once webfonts finish loading so the glyphs stay crisp.

export default function MakText({ height = 28, animated = true }: { height?: number; animated?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const reduced = !animated || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
    const textH = height

    let animId = 0
    let cancelled = false
    let points: { x: number; y: number }[] = []
    let textW = 120

    const sample = () => {
      const offscreen = document.createElement('canvas')
      const offCtx = offscreen.getContext('2d')
      if (!offCtx) return
      const fontSize = height * 0.85
      const font = `700 ${fontSize}px "Inter", "Segoe UI", system-ui, sans-serif`
      offCtx.font = font
      textW = Math.ceil(offCtx.measureText('Mr. Mak').width) + 4

      offscreen.width = textW
      offscreen.height = textH
      offCtx.font = font
      offCtx.fillStyle = '#fff'
      offCtx.textBaseline = 'middle'
      offCtx.fillText('Mr. Mak', 1, textH / 2)

      const data = offCtx.getImageData(0, 0, textW, textH).data
      const pts: { x: number; y: number }[] = []
      const step = 1.8  // density of dots
      for (let y = 0; y < textH; y += step) {
        for (let x = 0; x < textW; x += step) {
          const alpha = data[(Math.floor(y) * textW + Math.floor(x)) * 4 + 3]
          if (alpha > 100) pts.push({ x, y })
        }
      }
      points = pts

      canvas.width = textW * dpr
      canvas.height = textH * dpr
      canvas.style.width = `${textW}px`
      canvas.style.height = `${textH}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // The shimmer is subtle, so a low frame rate is indistinguishable from full
    // refresh. Dots are batched into a few alpha buckets: one fill per bucket
    // instead of one per dot keeps the WebView GPU process near idle.
    const FRAME_MS = 1000 / 24
    const BUCKETS = 6
    let last = -Infinity

    const draw = (time: number) => {
      ctx.clearRect(0, 0, textW, textH)
      const pulse = Math.sin(time * 0.001) * 0.04 + 1
      const paths = Array.from({ length: BUCKETS }, () => new Path2D())

      for (const pt of points) {
        const x = pt.x + Math.sin(time * 0.0015 + pt.x * 0.25 + pt.y * 0.3) * 0.3
        const y = pt.y + Math.cos(time * 0.0012 + pt.x * 0.2 + pt.y * 0.4) * 0.2
        const r = (0.75 + Math.sin(time * 0.002 + pt.x * 0.1 + pt.y * 0.15) * 0.12) * pulse
        const level = (Math.sin(time * 0.0018 + pt.x * 0.3 + pt.y * 0.2) + 1) / 2
        const path = paths[Math.min(BUCKETS - 1, Math.floor(level * BUCKETS))]
        path.moveTo(x + r, y)
        path.arc(x, y, r, 0, Math.PI * 2)
      }

      paths.forEach((path, i) => {
        ctx.fillStyle = `rgba(235, 235, 240, ${0.3 + ((i + 0.5) / BUCKETS) * 0.4})`
        ctx.fill(path)
      })
    }

    const loop = (time: number) => {
      animId = requestAnimationFrame(loop)
      if (document.hidden || time - last < FRAME_MS) return
      last = time
      draw(time)
    }

    sample()
    if (reduced) draw(0)
    else animId = requestAnimationFrame(loop)

    // Inter may swap in after first paint — re-sample for crisp glyphs.
    document.fonts?.ready.then(() => {
      if (cancelled) return
      sample()
      if (reduced) draw(0)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(animId)
    }
  }, [height, animated])

  return <canvas ref={canvasRef} style={{ height, display: 'block' }} />
}
