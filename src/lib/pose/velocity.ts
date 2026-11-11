// Prędkość i moc z kamery (VBT). Szacunek: skala z MediaPipe (metry w przybliżeniu) – dokładność ok. ±10–20%,
// porównania tej samej osoby i ten sam sposób nagrania są wiarygodniejsze niż liczby bezwzględne.
import type { ExerciseKey } from './profiles'

const G = 9.81
/** Prędkość przy 1RM (minimal velocity threshold) – wartości z literatury VBT. */
export const MVT: Partial<Record<ExerciseKey, number>> = { squat: 0.3, deadlift: 0.15, press: 0.19, bench: 0.17 }

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

/**
 * Prędkość → % ciężaru maksymalnego (średnia prędkość w górę). Ogólne tabele z badań VBT (przysiad: Sánchez-Medina i in.,
 * wyciskanie leżąc: González-Badillo i Sánchez-Medina, martwy ciąg i wyciskanie nad głowę – przybliżenia). Dla jednej osoby
 * dokładniejszy jest jej własny profil z kilku ciężarów (loadVelocity).
 */
const PCT_TABLE: Partial<Record<ExerciseKey, [number, number][]>> = {
  squat: [[1.1, 45], [1.0, 55], [0.9, 62], [0.8, 68], [0.7, 75], [0.6, 81], [0.5, 87], [0.4, 93], [0.3, 100]],
  bench: [[1.3, 40], [1.1, 50], [0.92, 60], [0.75, 70], [0.58, 80], [0.4, 90], [0.17, 100]],
  deadlift: [[0.9, 50], [0.75, 60], [0.6, 70], [0.48, 80], [0.35, 90], [0.15, 100]],
  press: [[1.1, 40], [0.95, 50], [0.8, 60], [0.65, 70], [0.5, 80], [0.35, 90], [0.19, 100]],
}

/** Szacowany % 1RM z prędkości najszybszego powtórzenia (null, gdy brak tabeli dla ćwiczenia). */
export function pctFromVelocity(ex: ExerciseKey, v: number | null | undefined) {
  const t = PCT_TABLE[ex]
  if (!t || !v || v <= 0) return null
  if (v >= t[0][0]) return t[0][1]
  if (v <= t.at(-1)![0]) return 100
  for (let i = 1; i < t.length; i++) {
    const [v0, p0] = t[i - 1]
    const [v1, p1] = t[i]
    if (v <= v0 && v >= v1) return Math.round(p0 + ((v0 - v) / (v0 - v1)) * (p1 - p0))
  }
  return null
}

/** 1RM z jednej serii: ciężar / % 1RM z prędkości najszybszego powtórzenia. Orientacyjnie (±10%). */
export function e1rmFromSet(ex: ExerciseKey, loadKg: number | null | undefined, bestV: number | null) {
  const pct = pctFromVelocity(ex, bestV)
  if (!loadKg || !pct || pct < 40) return null
  return Math.round((loadKg / (pct / 100)) * 2) / 2
}

/**
 * Powtórzenia w zapasie (RIR) po serii. Główna metoda: tempo spadku prędkości w serii (prosta przez prędkości kolejnych
 * powtórzeń) – ile jeszcze powtórzeń, zanim ostatnie spadłoby do prędkości przy 1RM (MVT). Gdy prędkość prawie nie spada,
 * z % 1RM: ile powtórzeń da się zrobić z takim ciężarem (odwrócony wzór Epleya) minus wykonane.
 */
export function estimateRir(ex: ExerciseKey, reps: RepV[]): { rir: number; method: 'slope' | 'pct'; text: string } | null {
  const mvt = MVT[ex]
  const v = reps.map((r) => r.mcv).filter((x): x is number => x != null && x > 0)
  if (!mvt || v.length < 2) return null
  const n = v.length
  const mx = (n - 1) / 2
  const my = v.reduce((s, x) => s + x, 0) / n
  const sxx = v.reduce((s, _, i) => s + (i - mx) ** 2, 0)
  const slope = v.reduce((s, x, i) => s + (i - mx) * (x - my), 0) / sxx
  const last = my + slope * (n - 1 - mx) // wygładzona prędkość ostatniego powtórzenia
  let rir: number
  let method: 'slope' | 'pct'
  if (n >= 3 && slope < -0.01) {
    rir = Math.max(0, (last - mvt) / -slope)
    method = 'slope'
  } else {
    const pct = pctFromVelocity(ex, Math.max(...v))
    if (!pct) return null
    const maxReps = pct >= 100 ? 1 : 1 + 30 * (100 / pct - 1)
    rir = Math.max(0, maxReps - n)
    method = 'pct'
  }
  rir = Math.min(rir, 10)
  const text = rir < 0.75 ? '0 – seria do upadku' : rir < 1.75 ? '≈ 1' : rir < 2.75 ? '≈ 2' : rir < 3.75 ? '≈ 3' : rir < 5.5 ? '4–5' : rir < 9.5 ? '6 i więcej' : '10+ (bardzo lekko)'
  return { rir: Math.round(rir * 10) / 10, method, text }
}
