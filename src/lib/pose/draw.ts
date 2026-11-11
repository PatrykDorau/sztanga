// Rysowanie szkieletu na płótnie (odtwarzacz i kamera na żywo): lewa strona pomarańczowa, prawa niebieska.
import { BONES, LEFT, type Pose } from './skeleton'
import type { AngleMark } from './marks'

export function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Rysuje pozę w obszarze W×H (współrzędne MediaPipe 0..1). mirror = obraz odbity (kamera przednia). */
export function drawSkeleton(g: CanvasRenderingContext2D, p: Pose, W: number, H: number, mirror = false, hot?: number[], hidden?: number[]) {
  const hide = new Set(hidden ?? [])
  const lc = cssVar('--chart-1', '#ea580c')
  const rc = cssVar('--div-neg', '#4c7ef0')
  const X = (x: number) => (mirror ? 1 - x : x) * W
  g.lineCap = 'round'
  g.lineWidth = Math.max(3, W / 120)
  for (const [i, k] of BONES) {
    if (p[i].v < 0.3 || p[k].v < 0.3 || hide.has(i) || hide.has(k)) continue
    g.strokeStyle = LEFT.has(i) && LEFT.has(k) ? lc : !LEFT.has(i) && !LEFT.has(k) ? rc : '#ffffff'
    g.globalAlpha = Math.min(p[i].v, p[k].v) < 0.5 ? 0.45 : 0.95
    g.beginPath()
    g.moveTo(X(p[i].x), p[i].y * H)
    g.lineTo(X(p[k].x), p[k].y * H)
    g.stroke()
  }
  g.globalAlpha = 1
  for (let i = 1; i < p.length; i++) {
    if (p[i].v < 0.3 || hide.has(i)) continue
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

/** Kąt z tabeli pomiarów na szkielecie: dwa ramiona, łuk i podpis (c brak = pochylenie od pionu). */
export function drawAngle(g: CanvasRenderingContext2D, p: Pose, W: number, H: number, m: AngleMark) {
  const P = (i: number): [number, number] => [p[i].x * W, p[i].y * H]
  const b = P(m.b)
  const a = P(m.a)
  const len = Math.hypot(a[0] - b[0], a[1] - b[1])
  const c: [number, number] = m.c != null ? P(m.c) : [b[0], b[1] - len] // pion w górę
  const col = '#facc15'
  g.save()
  g.lineCap = 'round'
  g.strokeStyle = 'rgba(0,0,0,0.55)'
  g.lineWidth = Math.max(7, W / 60)
  for (const e of [a, c]) {
    g.beginPath()
    g.moveTo(b[0], b[1])
    g.lineTo(e[0], e[1])
    g.stroke()
  }
  g.strokeStyle = col
  g.lineWidth = Math.max(4, W / 100)
  g.beginPath()
  g.moveTo(b[0], b[1])
  g.lineTo(a[0], a[1])
  g.stroke()
  if (m.c == null) g.setLineDash([8, 6])
  g.beginPath()
  g.moveTo(b[0], b[1])
  g.lineTo(c[0], c[1])
  g.stroke()
  g.setLineDash([])
  // łuk po mniejszej stronie kąta
  const r = Math.max(22, Math.min(len, Math.hypot(c[0] - b[0], c[1] - b[1])) * 0.35)
  const t1 = Math.atan2(a[1] - b[1], a[0] - b[0])
  let t2 = Math.atan2(c[1] - b[1], c[0] - b[0])
  let d = t2 - t1
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  t2 = t1 + d
  g.beginPath()
  g.moveTo(b[0], b[1])
  g.arc(b[0], b[1], r, t1, t2, d < 0)
  g.closePath()
  g.fillStyle = 'rgba(250,204,21,0.35)'
  g.fill()
  // podpis na dwusiecznej, po zewnętrznej stronie łuku
  const tm = t1 + d / 2
  const fs = Math.max(15, W / 24)
  g.font = `700 ${fs}px Barlow, system-ui, sans-serif`
  const tw = g.measureText(m.text).width
  let tx = b[0] + Math.cos(tm) * (r + fs * 1.2) - tw / 2
  let ty = b[1] + Math.sin(tm) * (r + fs * 1.2)
  tx = Math.max(4, Math.min(W - tw - 4, tx))
  ty = Math.max(fs, Math.min(H - 6, ty))
  g.fillStyle = 'rgba(0,0,0,0.75)'
  g.beginPath()
  g.roundRect(tx - 6, ty - fs * 0.85, tw + 12, fs * 1.25, 6)
  g.fill()
  g.fillStyle = col
  g.fillText(m.text, tx, ty)
  g.restore()
}

/** Tor sztangi (punkt na szkielecie, który ją niesie) w bieżącym powtórzeniu: linia + kropka w bieżącej klatce. */
export function drawBarPath(g: CanvasRenderingContext2D, pts: ([number, number] | null)[], cur: [number, number] | null, W: number, H: number) {
  const col = '#22d3ee'
  g.save()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.strokeStyle = col
  g.lineWidth = Math.max(3, W / 140)
  g.globalAlpha = 0.9
  g.beginPath()
  let on = false
  for (const q of pts) {
    if (!q) {
      on = false
      continue
    }
    if (on) g.lineTo(q[0] * W, q[1] * H)
    else g.moveTo(q[0] * W, q[1] * H)
    on = true
  }
  g.stroke()
  if (cur) {
    g.globalAlpha = 1
    g.fillStyle = col
    g.strokeStyle = '#0b1220'
    g.lineWidth = 2
    g.beginPath()
    g.arc(cur[0] * W, cur[1] * H, Math.max(6, W / 70), 0, Math.PI * 2)
    g.fill()
    g.stroke()
  }
  g.restore()
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
