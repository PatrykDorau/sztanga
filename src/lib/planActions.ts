// Propozycje zmian w planie od asystenta AI. Model tylko proponuje (karta ze stanem przed/po);
// zapis robi ta aplikacja uprawnieniami trenerki, dopiero po dwóch potwierdzeniach. Każdą zastosowaną propozycję da się cofnąć.
import { supabase } from '@/lib/supabase'

export const FIELD_LABEL: Record<string, string> = {
  sets: 'serie',
  reps: 'powtórzenia',
  load: 'obciążenie',
  tempo: 'tempo',
  rest_sec: 'przerwa',
  rpe: 'RPE',
  notes: 'uwagi',
}
type Fields = Record<string, string | number | null>

export interface PlanChange {
  type: 'update' | 'swap' | 'add' | 'remove'
  where: string // "Tydz. 2 · Dolne partie"
  reason: string
  we_id: string | null
  workout_id: string
  exercise: string
  exercise_id?: string
  new_exercise?: string
  new_exercise_id?: string
  before?: Fields
  after?: Fields
  // uzupełniane przy zastosowaniu – potrzebne do cofnięcia
  created_id?: string
  removed_row?: Record<string, unknown>
}
export interface Proposal {
  id: string
  summary: string
  program: { id: string; name: string; status: string; is_template: boolean }
  changes: PlanChange[]
  state?: 'pending' | 'applied' | 'undone' | 'rejected'
}

export const fmtField = (k: string, v: unknown) =>
  v == null || v === '' ? '—' : k === 'rest_sec' ? `${v} s` : typeof v === 'number' ? String(v).replace('.', ',') : String(v)

const ROW = 'id, workout_id, exercise_id, position, group_label, sets, reps, load, tempo, rest_sec, rpe, notes, progression'
function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')
const STALE = 'Plan zmienił się od czasu przygotowania propozycji – poproś asystenta o nową.'

/** Zapisuje propozycję. Najpierw sprawdza, czy plan wygląda tak jak wtedy, gdy asystent ją przygotował. */
export async function applyProposal(p: Proposal) {
  const ids = p.changes.map((c) => c.we_id).filter((x): x is string => !!x)
  const rows = ids.length ? (ok(await supabase.from('workout_exercises').select(ROW).in('id', ids)) as Record<string, unknown>[]) : []
  const by = new Map(rows.map((r) => [r.id as string, r]))
  for (const c of p.changes) {
    if (c.type === 'add') continue
    const r = by.get(c.we_id!)
    if (!r || r.exercise_id !== c.exercise_id) throw new Error(STALE)
    for (const k of Object.keys(c.before ?? {})) if (!same(r[k], c.before![k])) throw new Error(STALE)
  }
  for (const c of p.changes) {
    if (c.type === 'update') ok(await supabase.from('workout_exercises').update(c.after!).eq('id', c.we_id!))
    else if (c.type === 'swap') ok(await supabase.from('workout_exercises').update({ ...c.after, exercise_id: c.new_exercise_id }).eq('id', c.we_id!))
    else if (c.type === 'remove') {
      c.removed_row = by.get(c.we_id!)
      ok(await supabase.from('workout_exercises').delete().eq('id', c.we_id!))
    } else {
      const last = ok(await supabase.from('workout_exercises').select('position').eq('workout_id', c.workout_id).order('position', { ascending: false }).limit(1)) as { position: number }[]
      const row = ok(
        await supabase
          .from('workout_exercises')
          .insert({ workout_id: c.workout_id, exercise_id: c.new_exercise_id, position: (last[0]?.position ?? -1) + 1, ...c.after })
          .select('id')
          .single(),
      ) as { id: string }
      c.created_id = row.id
    }
  }
  await touch(p)
}

/** Przywraca stan sprzed zastosowania (w odwrotnej kolejności). */
export async function undoProposal(p: Proposal) {
  for (const c of [...p.changes].reverse()) {
    if (c.type === 'update') ok(await supabase.from('workout_exercises').update(c.before!).eq('id', c.we_id!))
    else if (c.type === 'swap') ok(await supabase.from('workout_exercises').update({ ...c.before, exercise_id: c.exercise_id }).eq('id', c.we_id!))
    else if (c.type === 'remove' && c.removed_row) ok(await supabase.from('workout_exercises').insert(c.removed_row))
    else if (c.type === 'add' && c.created_id) ok(await supabase.from('workout_exercises').delete().eq('id', c.created_id))
  }
  await touch(p)
}

const touch = (p: Proposal) => supabase.from('programs').update({ updated_at: new Date().toISOString() }).eq('id', p.program.id)

/** Jedna linia opisu zmiany (karta i okno potwierdzenia). */
export function describe(c: PlanChange): string {
  const fields = (f?: Fields) =>
    Object.entries(f ?? {})
      .map(([k, v]) => `${FIELD_LABEL[k] ?? k} ${fmtField(k, v)}`)
      .join(', ')
  const diff = Object.keys(c.after ?? {})
    .map((k) => `${FIELD_LABEL[k] ?? k}: ${fmtField(k, c.before?.[k])} → ${fmtField(k, c.after![k])}`)
    .join(' · ')
  if (c.type === 'update') return diff
  if (c.type === 'swap') return `zamiana na: ${c.new_exercise}${diff ? ` · ${diff}` : ''}`
  if (c.type === 'add') return `nowe ćwiczenie${fields(c.after) ? ` (${fields(c.after)})` : ''}`
  return 'usunięcie z treningu'
}
