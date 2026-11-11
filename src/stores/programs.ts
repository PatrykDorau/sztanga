import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { applyProgression } from '@/lib/progression'
import type { Program, ProgramTree, ProgramWeek, Workout, WorkoutExercise } from '@/types'

const PROGRAM_COLS = 'id, name, description, is_template, client_id, template_id, start_date, status, kind, created_at, updated_at'
const WE_COLS = 'id, workout_id, exercise_id, position, group_label, sets, reps, load, tempo, rest_sec, rpe, notes, progression'
const TREE = `${PROGRAM_COLS}, program_weeks(id, program_id, position, phase, notes, workouts(id, week_id, position, name, notes, workout_exercises(${WE_COLS})))`

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position
function sortTree(p: ProgramTree) {
  p.program_weeks.sort(byPos)
  for (const w of p.program_weeks) {
    w.workouts.sort(byPos)
    for (const wo of w.workouts) wo.workout_exercises.sort(byPos)
  }
  return p
}

function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

type WeInput = Partial<Omit<WorkoutExercise, 'id' | 'workout_id'>> & { exercise_id: string }

export const useProgramsStore = defineStore('programs', () => {
  const list = ref<Program[]>([])
  const listLoaded = ref(false)
  const current = ref<ProgramTree | null>(null)

  async function loadList(force = false) {
    if (listLoaded.value && !force) return
    list.value = ok(await supabase.from('programs').select(PROGRAM_COLS).order('updated_at', { ascending: false })) as Program[]
    listLoaded.value = true
  }

  async function open(id: string) {
    const data = ok(await supabase.from('programs').select(TREE).eq('id', id).single()) as unknown as ProgramTree
    current.value = sortTree(data)
    return current.value
  }

  function touchList(p: Program) {
    const { program_weeks: _, ...flat } = p as ProgramTree
    const i = list.value.findIndex((x) => x.id === p.id)
    if (i >= 0) list.value[i] = flat
    else list.value.unshift(flat)
  }

  // ===== Program =====
  async function create(input: Partial<Program> & { name: string }, weeks = 1, workoutName = 'Trening A') {
    const p = ok(await supabase.from('programs').insert(input).select(PROGRAM_COLS).single()) as Program
    const wk = ok(
      await supabase
        .from('program_weeks')
        .insert(Array.from({ length: weeks }, (_, i) => ({ program_id: p.id, position: i })))
        .select('id'),
    ) as { id: string }[]
    await supabase.from('workouts').insert(wk.map((w) => ({ week_id: w.id, position: 0, name: workoutName })))
    touchList(p)
    return p
  }

  async function update(id: string, patch: Partial<Program>) {
    const p = ok(await supabase.from('programs').update(patch).eq('id', id).select(PROGRAM_COLS).single()) as Program
    if (current.value?.id === id) Object.assign(current.value, p)
    touchList(p)
    return p
  }

  async function remove(id: string) {
    ok(await supabase.from('programs').delete().eq('id', id))
    list.value = list.value.filter((p) => p.id !== id)
    if (current.value?.id === id) current.value = null
  }

  /** Kopia całego programu (szablon → klient, plan → szablon, duplikat). */
  async function copy(src: string, opts: { clientId?: string | null; asTemplate?: boolean; start?: string | null; name?: string | null }) {
    const id = ok(
      await supabase.rpc('copy_program', {
        src,
        target_client: opts.clientId ?? null,
        as_template: opts.asTemplate ?? false,
        start: opts.start ?? null,
        new_name: opts.name ?? null,
      }),
    ) as string
    await loadList(true)
    return id
  }

  // ===== Tygodnie =====
  const week = (id: string) => current.value?.program_weeks.find((w) => w.id === id)

  async function addWeek(phase: string | null = null) {
    const p = current.value!
    const position = (p.program_weeks.at(-1)?.position ?? -1) + 1
    const w = ok(await supabase.from('program_weeks').insert({ program_id: p.id, position, phase }).select('id, program_id, position, phase, notes').single()) as ProgramWeek
    w.workouts = []
    p.program_weeks.push(w)
    return w
  }

  async function updateWeek(id: string, patch: Partial<Pick<ProgramWeek, 'phase' | 'notes'>>) {
    ok(await supabase.from('program_weeks').update(patch).eq('id', id))
    Object.assign(week(id)!, patch)
  }

  /** Zamiana tygodnia z sąsiednim (dir −1 = wcześniej, +1 = później). */
  async function moveWeek(id: string, dir: -1 | 1) {
    const p = current.value!
    const ws = [...p.program_weeks].sort(byPos)
    const i = ws.findIndex((w) => w.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ws.length) return
    const [a, b] = [ws[i], ws[j]]
    ;[a.position, b.position] = [b.position, a.position]
    ok(await supabase.from('program_weeks').update({ position: a.position }).eq('id', a.id))
    ok(await supabase.from('program_weeks').update({ position: b.position }).eq('id', b.id))
    p.program_weeks = [...p.program_weeks].sort(byPos)
  }

  async function removeWeek(id: string) {
    ok(await supabase.from('program_weeks').delete().eq('id', id))
    const p = current.value!
    p.program_weeks = p.program_weeks.filter((w) => w.id !== id)
  }

  /**
   * Kopia tygodnia na koniec programu. Z `progress` każde ćwiczenie z regułą progresji
   * dostaje podniesiony ciężar/powtórzenia – to szkic, który trenerka przegląda i poprawia.
   */
  async function duplicateWeek(id: string, progress: boolean, phase?: string | null) {
    const src = week(id)!
    const w = await addWeek(phase === undefined ? src.phase : phase)
    for (const wo of src.workouts) {
      const nw = await addWorkout(w.id, wo.name, wo.notes)
      if (wo.workout_exercises.length) {
        const rows = wo.workout_exercises.map(({ id: _id, workout_id: _w, ...rest }) => ({
          ...rest,
          ...(progress ? applyProgression(rest) : {}),
          workout_id: nw.id,
        }))
        nw.workout_exercises = ok(await supabase.from('workout_exercises').insert(rows).select(WE_COLS)) as WorkoutExercise[]
        nw.workout_exercises.sort(byPos)
      }
    }
    return w
  }

  // ===== Treningi =====
  const workout = (id: string) => {
    for (const w of current.value?.program_weeks ?? []) {
      const wo = w.workouts.find((x) => x.id === id)
      if (wo) return wo
    }
  }

  async function addWorkout(weekId: string, name?: string, notes: string | null = null) {
    const w = week(weekId)!
    const position = (w.workouts.at(-1)?.position ?? -1) + 1
    const label = name ?? `Trening ${String.fromCharCode(65 + w.workouts.length)}`
    const wo = ok(await supabase.from('workouts').insert({ week_id: weekId, position, name: label, notes }).select('id, week_id, position, name, notes').single()) as Workout
    wo.workout_exercises = []
    w.workouts.push(wo)
    return wo
  }

  async function updateWorkout(id: string, patch: Partial<Pick<Workout, 'name' | 'notes'>>) {
    ok(await supabase.from('workouts').update(patch).eq('id', id))
    Object.assign(workout(id)!, patch)
  }

  async function removeWorkout(id: string) {
    ok(await supabase.from('workouts').delete().eq('id', id))
    for (const w of current.value!.program_weeks) w.workouts = w.workouts.filter((x) => x.id !== id)
  }

  async function reorderWorkouts(weekId: string, ids: string[]) {
    const w = week(weekId)!
    w.workouts = ids.map((id, position) => ({ ...w.workouts.find((x) => x.id === id)!, position }))
    ok(await supabase.from('workouts').upsert(w.workouts.map(({ workout_exercises: _, ...r }) => r)))
  }

  // ===== Ćwiczenia w treningu =====
  async function addExercise(workoutId: string, input: WeInput) {
    const wo = workout(workoutId)!
    const position = (wo.workout_exercises.at(-1)?.position ?? -1) + 1
    const row = ok(
      await supabase.from('workout_exercises').insert({ sets: 3, reps: '10', rest_sec: 90, ...input, workout_id: workoutId, position }).select(WE_COLS).single(),
    ) as WorkoutExercise
    wo.workout_exercises.push(row)
    return row
  }

  async function updateExercise(id: string, patch: Partial<WorkoutExercise>) {
    const row = ok(await supabase.from('workout_exercises').update(patch).eq('id', id).select(WE_COLS).single()) as WorkoutExercise
    const wo = workout(row.workout_id)!
    const i = wo.workout_exercises.findIndex((x) => x.id === id)
    wo.workout_exercises[i] = row
    return row
  }

  async function removeExercise(id: string, workoutId: string) {
    ok(await supabase.from('workout_exercises').delete().eq('id', id))
    const wo = workout(workoutId)!
    wo.workout_exercises = wo.workout_exercises.filter((x) => x.id !== id)
  }

  /** Nowa kolejność ćwiczeń; obsługuje też przeniesienie do innego treningu. */
  async function moveExercise(id: string, fromWorkout: string, toWorkout: string, newIndex: number) {
    const from = workout(fromWorkout)!
    const to = workout(toWorkout)!
    const item = from.workout_exercises.find((x) => x.id === id)!
    from.workout_exercises = from.workout_exercises.filter((x) => x.id !== id)
    const target = fromWorkout === toWorkout ? from : to
    target.workout_exercises.splice(newIndex, 0, { ...item, workout_id: toWorkout })
    const touched = fromWorkout === toWorkout ? [from] : [from, to]
    const rows: WorkoutExercise[] = []
    for (const wo of touched) {
      wo.workout_exercises = wo.workout_exercises.map((x, position) => ({ ...x, position }))
      rows.push(...wo.workout_exercises)
    }
    if (rows.length) ok(await supabase.from('workout_exercises').upsert(rows))
  }

  return {
    list, listLoaded, current,
    loadList, open, create, update, remove, copy,
    addWeek, updateWeek, removeWeek, duplicateWeek, moveWeek,
    addWorkout, updateWorkout, removeWorkout, reorderWorkouts,
    addExercise, updateExercise, removeExercise, moveExercise,
  }
})
