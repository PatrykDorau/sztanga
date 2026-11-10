// Stabilizacja punktów szkieletu.
//  • na żywo: filtr One-Euro (Casiez i in.) – mocno wygładza, gdy punkt stoi, i odpuszcza, gdy szybko się rusza (bez "ciągnięcia się" za ruchem)
//  • nagranie: filtr bez opóźnienia (mediana z 3 klatek usuwa pojedyncze przeskoki, potem średnia ważona z sąsiednich klatek)
import type { Pose, Pt, Track } from './skeleton'

const CH = ['x', 'y', 'wx', 'wy', 'wz'] as const
type Ch = (typeof CH)[number]

const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))

/**
 * Filtr dla kamery na żywo. Wywołanie: filter(pose, czas [s]) → wygładzona poza.
 * Po dłuższej przerwie (osoba wyszła z kadru) zaczyna od nowa.
 */
export function liveSmoother(minCutoff = 1.3, betaImg = 5, betaWorld = 2.5, dCutoff = 1) {
  let prev: Pose | null = null
  let vel: number[][] = []
  let tPrev = 0
  return (pose: Pose | null, t: number): Pose | null => {
    if (!pose) {
      if (t - tPrev > 0.4) prev = null
      return null
    }
    const dt = Math.min(0.2, Math.max(1 / 240, t - tPrev))
    if (!prev || t - tPrev > 0.4) {
      prev = pose.map((q) => ({ ...q }))
      vel = pose.map(() => [0, 0, 0, 0, 0])
      tPrev = t
      return prev
    }
    const out: Pose = pose.map((q, j) => {
      const p = prev![j]
      const r: Pt = { ...q }
      CH.forEach((c, k) => {
        const d = (q[c] - p[c]) / dt
        const dv = (vel[j][k] += alpha(dCutoff, dt) * (d - vel[j][k]))
        // Słabo widoczny punkt (zasłonięta strona) skacze najmocniej – wygładzamy go mocniej.
        const cut = (minCutoff + (k < 2 ? betaImg : betaWorld) * Math.abs(dv)) * (q.v < 0.5 ? 0.5 : 1)
        r[c] = p[c] + alpha(cut, dt) * (q[c] - p[c])
      })
      return r
    })
    prev = out
    tPrev = t
    return out
  }
}

/** Wygładzenie całego nagrania (bez opóźnienia). Nie zmienia liczby klatek ani czasów; wynik oznaczony `smoothed`. */
export function smoothTrack(tr: Track): Track {
  if (tr.smoothed) return tr
  const n = tr.poses.length
  const h = Math.max(1, Math.round((tr.fps || 30) * 0.07))
  const joints = tr.poses.find(Boolean)?.length ?? 0
  const out: (Pose | null)[] = tr.poses.map((p) => (p ? p.map((q) => ({ ...q })) : null))
  const med3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
  for (let j = 0; j < joints; j++) {
    for (const c of CH as readonly Ch[]) {
      // 1) mediana z 3 klatek – pojedynczy przeskok znika
      const m = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const p = tr.poses[i]
        if (!p) continue
        const a = tr.poses[i - 1]
        const b = tr.poses[i + 1]
        m[i] = a && b ? med3(a[j][c], p[j][c], b[j][c]) : p[j][c]
      }
      // 2) średnia ważona (trójkąt × widoczność) z sąsiednich klatek
      for (let i = 0; i < n; i++) {
        if (!tr.poses[i]) continue
        let s = 0
        let w = 0
        for (let k = Math.max(0, i - h); k <= Math.min(n - 1, i + h); k++) {
          const q = tr.poses[k]
          if (!q) continue
          const wk = (h + 1 - Math.abs(k - i)) * (0.2 + q[j].v)
          s += m[k] * wk
          w += wk
        }
        out[i]![j][c] = s / w
      }
    }
  }
  return { ...tr, poses: out, smoothed: true }
}

/** Miara drgań: średnia zmiana przyspieszenia punktów w obrazie (im mniej, tym stabilniej) – do testów. */
export function jitter(tr: Track): number {
  let s = 0
  let c = 0
  for (let i = 2; i < tr.poses.length; i++) {
    const [a, b, d] = [tr.poses[i - 2], tr.poses[i - 1], tr.poses[i]]
    if (!a || !b || !d) continue
    for (let j = 0; j < d.length; j++) {
      s += Math.hypot(d[j].x - 2 * b[j].x + a[j].x, d[j].y - 2 * b[j].y + a[j].y)
      c++
    }
  }
  return c ? s / c : 0
}
