// Prędkość i moc z kamery (VBT). Szacunek: skala z MediaPipe (metry w przybliżeniu) – dokładność ok. ±10–20%,
// porównania tej samej osoby i ten sam sposób nagrania są wiarygodniejsze niż liczby bezwzględne.
import type { ExerciseKey } from './profiles'

const G = 9.81
/** Prędkość przy 1RM (minimal velocity threshold) – wartości z literatury VBT. */
export const MVT: Partial<Record<ExerciseKey, number>> = { squat: 0.3, deadlift: 0.15, press: 0.19 }

/** Strefy prędkości (średnia prędkość w górę) – klasyczny podział VBT. */
export function zone(v: number) {
  if (v < 0.5) return 'siła maksymalna'
  if (v < 0.75) return 'siła przyspieszająca'
  if (v < 1.0) return 'siła–szybkość'
  if (v < 1.3) return 'szybkość–siła'
  return 'siła startowa / szybkość'
}

export interface RepV {
  mcv: number | null
  pv: number | null
  rom: number | null
}
export const power = (loadKg: number | null | undefined, v: number | null) => (loadKg && v ? Math.round(loadKg * G * v) : null)

/** Spadek prędkości w serii: od najszybszego powtórzenia do ostatniego [%]. */
export function velocityLoss(reps: RepV[]) {
  const v = reps.map((r) => r.mcv).filter((x): x is number => x != null)
  if (v.length < 3) return null
  const best = Math.max(...v)
  return best > 0 ? Math.round(((best - v.at(-1)!) / best) * 100) : null
}

/**
 * Profil obciążenie–prędkość: prosta przez (ciężar, najlepsza prędkość) z kilku nagrań, 1RM = ciężar przy prędkości MVT.
 * Wymaga co najmniej 2 różnych ciężarów (najlepiej 3–4, różnica ≥ 20%).
 */
export function loadVelocity(points: { load: number; v: number }[], ex: ExerciseKey) {
  const mvt = MVT[ex]
  const loads = new Set(points.map((p) => p.load))
  if (!mvt || loads.size < 2) return null
  const n = points.length
  const mx = points.reduce((s, p) => s + p.load, 0) / n
  const my = points.reduce((s, p) => s + p.v, 0) / n
  const sxx = points.reduce((s, p) => s + (p.load - mx) ** 2, 0)
  if (!sxx) return null
  const b = points.reduce((s, p) => s + (p.load - mx) * (p.v - my), 0) / sxx
  const a = my - b * mx
  if (b >= 0) return null // prędkość musi spadać z ciężarem
  const e1rm = (mvt - a) / b
  const spread = (Math.max(...loads) - Math.min(...loads)) / Math.max(...loads)
  return e1rm > 0 && e1rm < 1000 ? { e1rm: Math.round(e1rm * 2) / 2, slope: b, intercept: a, n, reliable: loads.size >= 3 && spread >= 0.2 } : null
}
