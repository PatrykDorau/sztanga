import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type { Measurement, SessionLog } from '@/types'

const LOG_COLS =
  'id, client_id, session_id, workout_id, started_at, finished_at, notes, summary, summary_status, set_logs(id, exercise_id, workout_exercise_id, position, set_index, reps, load_kg, rpe, done)'

function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

/** Historia treningowa klientów (logi sesji z seriami) i pomiary – cache per klient. */
export const useProgressStore = defineStore('progress', () => {
  const logs = ref<Record<string, SessionLog[]>>({})
  const measurements = ref<Record<string, Measurement[]>>({})

  async function loadClient(clientId: string) {
    const [l, m] = await Promise.all([
      supabase.from('session_logs').select(LOG_COLS).eq('client_id', clientId).order('started_at', { ascending: false }).limit(300),
      supabase.from('measurements').select('*').eq('client_id', clientId).order('measured_on'),
    ])
    logs.value[clientId] = ok(l) as unknown as SessionLog[]
    measurements.value[clientId] = ok(m) as Measurement[]
  }

  /** Ostatnie logi wszystkich klientów (do zbiorczego widoku) – bez serii, lekko. */
  async function loadAllRecent(days = 120) {
    const since = new Date(Date.now() - days * 864e5).toISOString()
    return ok(
      await supabase.from('session_logs').select(LOG_COLS).gte('started_at', since).order('started_at', { ascending: false }).limit(2000),
    ) as unknown as SessionLog[]
  }

  async function updateLog(clientId: string, id: string, patch: Partial<Pick<SessionLog, 'summary' | 'summary_status' | 'notes'>>) {
    ok(await supabase.from('session_logs').update(patch).eq('id', id))
    const l = logs.value[clientId]?.find((x) => x.id === id)
    if (l) Object.assign(l, patch)
  }

  async function addMeasurement(input: Omit<Measurement, 'id'>) {
    const row = ok(await supabase.from('measurements').insert(input).select('*').single()) as Measurement
    ;(measurements.value[input.client_id] ??= []).push(row)
    measurements.value[input.client_id].sort((a, b) => a.measured_on.localeCompare(b.measured_on))
  }

  async function removeMeasurement(clientId: string, id: string) {
    ok(await supabase.from('measurements').delete().eq('id', id))
    measurements.value[clientId] = measurements.value[clientId].filter((m) => m.id !== id)
  }

  return { logs, measurements, loadClient, loadAllRecent, updateLog, addMeasurement, removeMeasurement }
})
