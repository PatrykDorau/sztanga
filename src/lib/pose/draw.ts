// Rysowanie szkieletu na płótnie (odtwarzacz i kamera na żywo): lewa strona pomarańczowa, prawa niebieska.
import { BONES, LEFT, type Pose } from './skeleton'

export function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Rysuje pozę w obszarze W×H (współrzędne MediaPipe 0..1). mirror = obraz odbity (kamera przednia). */
export function drawSkeleton(g: CanvasRenderingContext2D, p: Pose, W: number, H: number, mirror = false, hot?: number[]) {
  const lc = cssVar('--chart-1', '#ea580c')
  const rc = cssVar('--div-neg', '#4c7ef0')
  const X = (x: number) => (mirror ? 1 - x : x) * W
  g.lineCap = 'round'
  g.lineWidth = Math.max(3, W / 120)
  for (const [i, k] of BONES) {
    if (p[i].v < 0.3 || p[k].v < 0.3) continue
    g.strokeStyle = LEFT.has(i) && LEFT.has(k) ? lc : !LEFT.has(i) && !LEFT.has(k) ? rc : '#ffffff'
    g.globalAlpha = Math.min(p[i].v, p[k].v) < 0.5 ? 0.45 : 0.95
    g.beginPath()
    g.moveTo(X(p[i].x), p[i].y * H)
    g.lineTo(X(p[k].x), p[k].y * H)
    g.stroke()
  }
  g.globalAlpha = 1
  for (let i = 1; i < p.length; i++) {
    if (p[i].v < 0.3) continue
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.arc(X(p[i].x), p[i].y * H, Math.max(3, W / 110), 0, Math.PI * 2)
    g.fill()
    g.fillStyle = LEFT.has(i) ? lc : rc
    g.beginPath()
    g.arc(X(p[i].x), p[i].y * H, Math.max(2, W / 180), 0, Math.PI * 2)
    g.fill()
  }
  // Punkty, których dotyczy wybrana uwaga: wyraźny pierścień.
  if (hot?.length) {
    const hc = cssVar('--div-pos', '#e5484d')
    for (const i of hot) {
      if (p[i].v < 0.3) continue
      const r = Math.max(12, W / 26)
      g.beginPath()
      g.arc(X(p[i].x), p[i].y * H, r, 0, Math.PI * 2)
      g.fillStyle = hc
      g.globalAlpha = 0.22
      g.fill()
      g.globalAlpha = 1
      g.lineWidth = Math.max(3, W / 160)
      g.strokeStyle = hc
      g.stroke()
    }
  }
}

/** Dopasowanie rozmiaru płótna do elementu (ostro na ekranach o dużej gęstości pikseli). */
export function fitCanvas(c: HTMLCanvasElement, W: number, H: number) {
  const dpr = window.devicePixelRatio || 1
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
  }
  const g = c.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, W, H)
  return g
}
