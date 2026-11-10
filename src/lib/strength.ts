// Obliczenia siłowe do dashboardu i podsumowań.
import type { SetLog } from '@/types'

/** Szacowane 1RM (Epley); dla 1 powtórzenia = ciężar. Powyżej 12 powtórzeń wynik jest mało wiarygodny – pomijamy. */
export function e1rm(load: number | null, reps: number | null) {
  if (!load || !reps || reps < 1 || reps > 12) return null
  return reps === 1 ? load : Math.round(load * (1 + reps / 30) * 10) / 10
}

export const volume = (sets: Pick<SetLog, 'reps' | 'load_kg' | 'done'>[]) =>
  sets.reduce((t, s) => t + (s.done && s.reps && s.load_kg ? s.reps * s.load_kg : 0), 0)

/** Pierwsza liczba z tekstu planu: "8-10" → 8, "20 kg" → 20, "22,5" → 22.5. */
export function firstNumber(s: string | null | undefined) {
  const m = s?.match(/\d+(?:[.,]\d+)?/)
  return m ? Number(m[0].replace(',', '.')) : null
}

export const fmtKg = (n: number | null | undefined) =>
  n == null ? '—' : `${String(Math.round(n * 10) / 10).replace('.', ',')} kg`
