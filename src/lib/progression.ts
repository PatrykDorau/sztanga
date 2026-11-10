import type { Progression, WorkoutExercise } from '@/types'

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '')).replace('.', ',')
const num = (s: string) => parseFloat(s.replace(',', '.'))

/** Dodaje krok do pierwszej liczby w tekście, zachowując jednostkę: "20 kg" + 2,5 → "22,5 kg". */
export function bumpLoad(load: string | null, step: number): string | null {
  if (!load) return load
  const m = load.match(/(\d+(?:[.,]\d+)?)/)
  if (!m) return load
  return load.replace(m[1], fmt(num(m[1]) + step))
}

/** Dodaje krok do każdej liczby w zakresie powtórzeń: "8-10" + 1 → "9-11". Czas ("30 s") też rośnie. */
export function bumpReps(reps: string | null, step: number): string | null {
  if (!reps) return reps
  return reps.replace(/\d+(?:[.,]\d+)?/g, (n) => fmt(num(n) + step))
}

/** Wynik reguły progresji dla jednego ćwiczenia – podpowiedź, którą trenerka zatwierdza. */
export function applyProgression(we: Pick<WorkoutExercise, 'load' | 'reps' | 'progression'>) {
  const p = we.progression
  if (!p || !p.step) return { load: we.load, reps: we.reps }
  return p.kind === 'load'
    ? { load: bumpLoad(we.load, p.step), reps: we.reps }
    : { load: we.load, reps: bumpReps(we.reps, p.step) }
}

export function describeProgression(p: Progression | null) {
  if (!p || !p.step) return ''
  return p.kind === 'load' ? `+${fmt(p.step)} kg / tydz.` : `+${fmt(p.step)} powt. / tydz.`
}

/** Zwięzły zapis dawki: "3 × 8-10 · 20 kg · RPE 8 · 90 s". */
export function doseLine(we: WorkoutExercise) {
  const parts: string[] = []
  if (we.sets || we.reps) parts.push([we.sets, we.reps].filter(Boolean).join(' × '))
  if (we.load) parts.push(we.load)
  if (we.tempo) parts.push(`tempo ${we.tempo}`)
  if (we.rpe) parts.push(`RPE ${fmt(Number(we.rpe))}`)
  if (we.rest_sec) parts.push(we.rest_sec >= 60 && we.rest_sec % 30 === 0 ? `przerwa ${fmt(we.rest_sec / 60)} min` : `przerwa ${we.rest_sec} s`)
  return parts.join(' · ')
}
