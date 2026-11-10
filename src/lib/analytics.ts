// Analiza historii treningowej – liczby liczone w kodzie (AI w fazie 5 tylko je opisze, niczego nie liczy).
import { e1rm, volume } from './strength'
import type { SessionLog } from '@/types'

export interface ExerciseSeries {
  exercise_id: string
  points: { x: string; maxLoad: number; e1rm: number | null; volume: number }[]
  best: { load: number; date: string } | null
}

/** Dla każdego ćwiczenia: punkty w czasie (max ciężar, najlepsze e1RM, objętość) i rekord ciężaru. */
export function seriesByExercise(logs: SessionLog[]): ExerciseSeries[] {
  const map = new Map<string, ExerciseSeries>()
  for (const log of [...logs].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const byEx = new Map<string, NonNullable<SessionLog['set_logs']>>()
    for (const s of log.set_logs ?? []) {
      if (!s.done) continue
      byEx.set(s.exercise_id, [...(byEx.get(s.exercise_id) ?? []), s])
    }
    for (const [exId, sets] of byEx) {
      const loads = sets.map((s) => Number(s.load_kg ?? 0))
      const maxLoad = Math.max(...loads)
      const bestE = Math.max(...sets.map((s) => e1rm(Number(s.load_kg), Number(s.reps)) ?? 0))
      const entry = map.get(exId) ?? { exercise_id: exId, points: [], best: null }
      entry.points.push({ x: log.started_at, maxLoad, e1rm: bestE || null, volume: volume(sets.map((s) => ({ ...s, reps: Number(s.reps), load_kg: Number(s.load_kg) }))) })
      if (maxLoad > 0 && (!entry.best || maxLoad > entry.best.load)) entry.best = { load: maxLoad, date: log.started_at }
      map.set(exId, entry)
    }
  }
  return [...map.values()].sort((a, b) => b.points.length - a.points.length)
}

/** Rekordy pobite w danej sesji (ciężar wyższy niż kiedykolwiek wcześniej). */
export function prsInLog(log: SessionLog, history: SessionLog[]) {
  const before = history.filter((l) => l.started_at < log.started_at)
  const prev = new Map<string, number>()
  for (const l of before) for (const s of l.set_logs ?? []) if (s.done && s.load_kg) prev.set(s.exercise_id, Math.max(prev.get(s.exercise_id) ?? 0, Number(s.load_kg)))
  const out = new Map<string, number>()
  for (const s of log.set_logs ?? []) {
    if (!s.done || !s.load_kg || !prev.has(s.exercise_id)) continue
    if (Number(s.load_kg) > prev.get(s.exercise_id)!) out.set(s.exercise_id, Math.max(out.get(s.exercise_id) ?? 0, Number(s.load_kg)))
  }
  return out
}

export function avgRpe(logs: SessionLog[]) {
  const r = logs.flatMap((l) => (l.set_logs ?? []).filter((s) => s.done && s.rpe).map((s) => Number(s.rpe)))
  return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null
}

export function totalVolume(logs: SessionLog[]) {
  return Math.round(logs.reduce((t, l) => t + volume((l.set_logs ?? []).map((s) => ({ ...s, reps: Number(s.reps), load_kg: Number(s.load_kg) }))), 0))
}

export const inRange = (logs: SessionLog[], from: Date, to: Date) =>
  logs.filter((l) => l.started_at >= from.toISOString() && l.started_at < to.toISOString())

/** Liczba ukończonych serii na partię mięśniową (partie z bazy ćwiczeń). */
export function setsPerMuscle(logs: SessionLog[], muscleOf: (exId: string) => string[]) {
  const m = new Map<string, number>()
  for (const l of logs) for (const s of l.set_logs ?? []) if (s.done) for (const g of muscleOf(s.exercise_id)) m.set(g, (m.get(g) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export type Trend = 'up' | 'flat' | 'down' | 'none'

/**
 * Status klienta do widoku zbiorczego: dni od ostatniej sesji, sesje w 30 dniach i trend siły
 * (najlepsze e1RM z ostatnich 3 tygodni vs 3 tygodnie wcześniej, w ćwiczeniach robionych w obu okresach).
 */
export function clientStatus(logs: SessionLog[]) {
  const sorted = [...logs].sort((a, b) => b.started_at.localeCompare(a.started_at))
  const last = sorted[0]?.started_at ?? null
  const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : null
  const d = (n: number) => new Date(Date.now() - n * 864e5)
  const sessions30 = inRange(logs, d(30), d(-1)).length
  const best = (ls: SessionLog[]) => {
    const m = new Map<string, number>()
    for (const l of ls) for (const s of l.set_logs ?? []) {
      const v = s.done ? e1rm(Number(s.load_kg), Number(s.reps)) : null
      if (v) m.set(s.exercise_id, Math.max(m.get(s.exercise_id) ?? 0, v))
    }
    return m
  }
  const recent = best(inRange(logs, d(21), d(-1)))
  const before = best(inRange(logs, d(42), d(21)))
  const changes = [...recent.keys()].filter((k) => before.has(k)).map((k) => (recent.get(k)! - before.get(k)!) / before.get(k)!)
  let trend: Trend = 'none'
  if (changes.length) {
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length
    trend = avg > 0.015 ? 'up' : avg < -0.015 ? 'down' : 'flat'
  }
  return { last, daysSince, sessions30, trend }
}
