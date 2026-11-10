// Sesja na żywo: cały przebieg trzymany lokalnie (localStorage), wysyłany do bazy po zakończeniu.
// Dzięki temu logowanie działa bez zasięgu na sali; nieudana wysyłka trafia do kolejki i ponawia się
// przy odzyskaniu sieci (client_uuid zapobiega duplikatom).
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { firstNumber } from '@/lib/strength'
import type { Workout } from '@/types'

export interface LiveSet {
  reps: number | null
  load_kg: number | null
  rpe: number | null
  done: boolean
}

export interface LiveExercise {
  key: string
  exercise_id: string
  workout_exercise_id: string | null
  group_label: string | null
  target: { sets: number | null; reps: string | null; load: string | null; tempo?: string | null; rest_sec: number | null; rpe: number | null; notes: string | null }
  sets: LiveSet[]
}

export interface LiveDraft {
  client_uuid: string
  client_id: string
  session_id: string | null
  workout_id: string | null
  workout_name: string | null
  started_at: string
  exercises: LiveExercise[]
  notes: string
  summary: string
  finished_at?: string
}

const DRAFTS = 'live:drafts'
const QUEUE = 'live:queue'

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* brak miejsca / tryb prywatny – sesja zostaje w pamięci */
  }
}

export const useLiveStore = defineStore('live', () => {
  const drafts = ref<Record<string, LiveDraft>>(read(DRAFTS, {}))
  const queue = ref<LiveDraft[]>(read(QUEUE, []))
  const online = ref(navigator.onLine)
  const syncing = ref(false)

  watch(drafts, (v) => write(DRAFTS, v), { deep: true })
  watch(queue, (v) => write(QUEUE, v), { deep: true })

  window.addEventListener('online', () => {
    online.value = true
    void flush()
  })
  window.addEventListener('offline', () => (online.value = false))

  const active = computed(() => Object.values(drafts.value).sort((a, b) => b.started_at.localeCompare(a.started_at)))

  function newExercise(exercise_id: string, we?: Workout['workout_exercises'][number]): LiveExercise {
    const n = we?.sets ?? 3
    const reps = firstNumber(we?.reps)
    const load = firstNumber(we?.load)
    return {
      key: crypto.randomUUID(),
      exercise_id,
      workout_exercise_id: we?.id ?? null,
      group_label: we?.group_label ?? null,
      target: {
        sets: we?.sets ?? null,
        reps: we?.reps ?? null,
        load: we?.load ?? null,
        tempo: we?.tempo ?? null,
        rest_sec: we?.rest_sec ?? 90,
        rpe: we?.rpe ?? null,
        notes: we?.notes ?? null,
      },
      sets: Array.from({ length: n }, () => ({ reps, load_kg: load, rpe: null, done: false })),
    }
  }

  /** Nowa sesja – z treningu z planu (ćwiczenia i dawki z planu) albo pusta. */
  function start(opts: { client_id: string; session_id?: string | null; workout?: Workout | null }) {
    // Jedna sesja z terminu = jeden szkic: wracamy do istniejącego zamiast tworzyć drugi.
    const existing = opts.session_id && active.value.find((d) => d.session_id === opts.session_id)
    if (existing) return existing.client_uuid
    const id = crypto.randomUUID()
    drafts.value[id] = {
      client_uuid: id,
      client_id: opts.client_id,
      session_id: opts.session_id ?? null,
      workout_id: opts.workout?.id ?? null,
      workout_name: opts.workout?.name ?? null,
      started_at: new Date().toISOString(),
      exercises: (opts.workout?.workout_exercises ?? []).map((we) => newExercise(we.exercise_id, we)),
      notes: '',
      summary: '',
    }
    return id
  }

  const discard = (id: string) => delete drafts.value[id]

  /** Zamyka sesję lokalnie i wysyła ją do bazy (albo zostawia w kolejce bez zasięgu). */
  async function finish(id: string) {
    const d = drafts.value[id]
    d.finished_at = new Date().toISOString()
    queue.value.push(JSON.parse(JSON.stringify(d)))
    delete drafts.value[id]
    await flush()
    return !queue.value.some((q) => q.client_uuid === id)
  }

  async function upload(d: LiveDraft) {
    const summary = d.summary.trim()
    const { data: existing } = await supabase.from('session_logs').select('id').eq('client_uuid', d.client_uuid).maybeSingle()
    let logId = existing?.id as string | undefined
    if (!logId) {
      const { data, error } = await supabase
        .from('session_logs')
        .insert({
          client_uuid: d.client_uuid,
          client_id: d.client_id,
          session_id: d.session_id,
          workout_id: d.workout_id,
          started_at: d.started_at,
          finished_at: d.finished_at,
          notes: d.notes.trim() || null,
          summary: summary || null,
          summary_status: summary ? 'draft' : 'none',
        })
        .select('id')
        .single()
      if (error) throw error
      logId = data.id
      const sets = d.exercises.flatMap((e, position) =>
        e.sets
          .filter((s) => s.done || s.reps != null)
          .map((s, i) => ({
            log_id: logId,
            exercise_id: e.exercise_id,
            workout_exercise_id: e.workout_exercise_id,
            position,
            set_index: i + 1,
            reps: s.reps,
            load_kg: s.load_kg,
            rpe: s.rpe,
            done: s.done,
          })),
      )
      if (sets.length) {
        const { error: e2 } = await supabase.from('set_logs').insert(sets)
        if (e2) {
          // bez serii log nie ma sensu – usuń, żeby ponowienie zaczęło od zera
          await supabase.from('session_logs').delete().eq('id', logId)
          throw e2
        }
      }
    }
    if (d.session_id) await supabase.from('sessions').update({ status: 'completed' }).eq('id', d.session_id)
    return logId!
  }

  async function flush() {
    if (syncing.value || !queue.value.length || !navigator.onLine) return
    syncing.value = true
    try {
      for (const d of [...queue.value]) {
        try {
          await upload(d)
          queue.value = queue.value.filter((q) => q.client_uuid !== d.client_uuid)
        } catch {
          break // spróbujemy ponownie przy następnym "online" lub starcie aplikacji
        }
      }
    } finally {
      syncing.value = false
    }
  }

  return { drafts, queue, online, syncing, active, start, discard, finish, flush, newExercise }
})
