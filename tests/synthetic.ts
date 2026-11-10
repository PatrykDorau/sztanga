// Syntetyczny przysiad (szkielet MediaPipe) do testów analizy – bez kamery i modelu.
import { J, type Track, type Pt } from '../src/lib/pose/skeleton'

const rad = Math.PI / 180
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5 }
type V = [number, number, number]

// Przysiad: θ kąt kolana, ankle stała; zwraca punkty świata (y w dół, z do kamery)
function squatPose(theta: number, valgus: number, lean: number): V[] {
  const L = 0.45, beta = (180 - theta) / 2 * rad
  const leg = (sx: number, inward: number): { ank: V; knee: V; hip: V; heel: V; foot: V } => {
    const ank: V = [sx, 0, 0]
    const knee: V = [sx - Math.sign(sx) * inward, -L * Math.cos(beta), L * Math.sin(beta)]
    const hip: V = [sx * 0.8, knee[1] - L * Math.cos(beta), knee[2] - L * Math.sin(beta)]
    return { ank, knee, hip, heel: [sx, 0.02, -0.06], foot: [sx, 0.03, 0.15] }
  }
  const l = leg(0.15, valgus), r = leg(-0.15, valgus)
  const g = lean * rad
  const sh = (h: V, s: number): V => [s * 0.2, h[1] - 0.5 * Math.cos(g), h[2] + 0.5 * Math.sin(g)]
  const lSh = sh(l.hip, 1), rSh = sh(r.hip, -1)
  const el = (s: V): V => [s[0], s[1] + 0.28, s[2] + 0.1]
  const wr = (s: V): V => [s[0], s[1] + 0.2, s[2] + 0.35]
  const nose: V = [0, lSh[1] - 0.25, lSh[2] + 0.1]
  // kolejność jak J
  return [nose, lSh, rSh, el(lSh), el(rSh), wr(lSh), wr(rSh), l.hip, r.hip, l.knee, r.knee, l.ank, r.ank, l.heel, r.heel, l.foot, r.foot]
}

export function makeTrack(view: 'front' | 'side', opts: { reps: number; valgusReps?: number[]; seed?: number; fps?: number; depth?: number }): Track {
  const fps = opts.fps ?? 30, noise = rng(opts.seed ?? 7)
  const t: number[] = [], poses: (Pt[] | null)[] = []
  // każde powtórzenie: 1 s góra, 1.6 s w dół, 0.3 s pauza, 1.0 s w górę
  const seg = [1.0, 1.6, 0.3, 1.0]
  const total = opts.reps * seg.reduce((a, b) => a + b) + 1.0
  const top = 175, bottom = opts.depth ?? 85
  for (let i = 0; i < total * fps; i++) {
    const tt = i / fps
    let rest = tt, rep = 0, theta = top
    const cyc = seg.reduce((a, b) => a + b)
    rep = Math.floor(rest / cyc); rest -= rep * cyc
    if (rep >= opts.reps) theta = top
    else if (rest < seg[0]) theta = top
    else if (rest < seg[0] + seg[1]) { const f = (rest - seg[0]) / seg[1]; theta = top - (top - bottom) * (1 - Math.cos(Math.PI * f)) / 2 }
    else if (rest < seg[0] + seg[1] + seg[2]) theta = bottom
    else { const f = (rest - seg[0] - seg[1] - seg[2]) / seg[3]; theta = bottom + (top - bottom) * (1 - Math.cos(Math.PI * f)) / 2 }
    const depthF = (top - theta) / (top - bottom)
    const valg = opts.valgusReps?.includes(rep + 1) ? 0.12 * depthF : 0
    const w = squatPose(theta, valg, 15 + 25 * depthF)
    // świat MediaPipe: środek bioder w (0,0,0)
    const hc: V = [(w[J.lHip][0] + w[J.rHip][0]) / 2, (w[J.lHip][1] + w[J.rHip][1]) / 2, (w[J.lHip][2] + w[J.rHip][2]) / 2]
    const p: Pt[] = w.map((q, k) => {
      const n = () => noise() * 0.006
      const X = view === 'front' ? q[0] : q[2] + q[0] * 0.05
      const vis = view === 'side' && [J.rSh, J.rEl, J.rWr, J.rHip, J.rKnee, J.rAnk, J.rHeel, J.rFoot].includes(k as any) ? 0.35 : 0.95
      return { x: 0.5 + X * 0.5 + n(), y: 0.85 + q[1] * 0.28 + n(), v: vis, wx: q[0] - hc[0] + n(), wy: q[1] - hc[1] + n(), wz: q[2] - hc[2] + n() }
    })
    t.push(tt); poses.push(i % 97 === 50 ? null : p)
  }
  return { fps, width: 720, height: 1280, t, poses }
}

