// Budowanie wierszy heatmapy z zapisanych analiz (tylko pomiary powtórzeń – bez szkieletu).
import { refStats, summarize, zScore, type RefStats } from './analysis'
import { PROFILES, type ExerciseKey, type MetricDef } from './profiles'
import type { AnalysisRow } from '@/stores/analysis'

export interface HeatCell {
  value: number | null
  z: number | null
  ref: number | null
}
export interface HeatRow {
  id: string
  label: string
  sub?: string
  to?: string
  cells: Record<string, HeatCell | undefined> // klucz: `${exercise}.${metric}`
}
export interface HeatGroup {
  key: string
  name: string
  metrics: MetricDef[]
}

export const groupsFor = (keys: ExerciseKey[]): HeatGroup[] => keys.map((k) => ({ key: k, name: PROFILES[k].name, metrics: PROFILES[k].metrics }))

/** Statystyki wzorca na ćwiczenie: wszystkie powtórzenia wszystkich nagrań oznaczonych jako wzorzec. */
export function refStatsByExercise(list: AnalysisRow[], excludeId?: string): Partial<Record<ExerciseKey, Record<string, RefStats>>> {
  const out: Partial<Record<ExerciseKey, Record<string, RefStats>>> = {}
  for (const k of Object.keys(PROFILES) as ExerciseKey[]) {
    const reps = list.filter((a) => a.is_reference && a.exercise_key === k && a.id !== excludeId).flatMap((a) => a.reps)
    if (reps.length) out[k] = refStats(reps)
  }
  return out
}

/**
 * Komórki dla zestawu analiz danej osoby: każdy pomiar z najnowszego nagrania, które go mierzy
 * (np. kolana z ostatniego nagrania z przodu, pochylenie z ostatniego z boku).
 */
export function cellsFor(analyses: AnalysisRow[], stats: ReturnType<typeof refStatsByExercise>): Record<string, HeatCell> {
  const cells: Record<string, HeatCell> = {}
  for (const a of [...analyses].sort((x, y) => y.recorded_at.localeCompare(x.recorded_at))) {
    const p = PROFILES[a.exercise_key]
    const m = summarize(a.reps)
    for (const def of p.metrics) {
      const key = `${a.exercise_key}.${def.key}`
      if (cells[key]?.value != null || m[def.key] == null) continue
      const ref = stats[a.exercise_key]?.[def.key]
      cells[key] = { value: m[def.key] ?? null, ref: ref?.mean ?? null, z: zScore(m[def.key], ref, def.tol) }
    }
  }
  return cells
}

/** Data najnowszego nagrania w zestawie. */
export const lastDate = (list: AnalysisRow[]) => list.reduce((d, a) => (a.recorded_at > d ? a.recorded_at : d), '')

export type { ExerciseKey }

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })
