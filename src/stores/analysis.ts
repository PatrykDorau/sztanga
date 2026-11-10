import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type { StoredTrack } from '@/lib/pose/skeleton'
import type { ExerciseKey, Thresholds, View } from '@/lib/pose/profiles'

export const ANALYSIS_BUCKET = 'analysis-videos'
export const VIDEO_KEEP_DAYS = 90

export interface StoredRep {
  start: number
  bottom: number
  end: number
  view?: View
  metrics: Record<string, number | null>
}

/** Wiersz listy – bez szkieletu (frames), żeby lista była lekka. */
export interface AnalysisRow {
  id: string
  client_id: string | null
  exercise_key: ExerciseKey
  session_id: string | null
  label: string | null
  recorded_at: string
  view: View
  fps: number
  duration: number
  reps: StoredRep[]
  is_reference: boolean
  reps_actual: number | null
  notes: string | null
  video_path: string | null
  video_expires_at: string | null
  created_at: string
}
/** Uwaga trenerska zapisana przy analizie (skrót Finding z lib/pose/coaching). */
export interface StoredFinding {
  key: string
  title: string
  severity: 'high' | 'medium' | 'low'
  reps: number[]
  obs: string
  cue: string
  fix: string
}
export interface AnalysisFull extends AnalysisRow {
  findings?: StoredFinding[] | null
  width: number | null
  height: number | null
  frames: StoredTrack
}

const LIST_COLS = 'id, client_id, exercise_key, session_id, label, recorded_at, view, fps, duration, reps, is_reference, reps_actual, notes, video_path, video_expires_at, created_at'

function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

export const useAnalysisStore = defineStore('analysis', () => {
  const list = ref<AnalysisRow[]>([])
  const thresholds = ref<Thresholds>({})
  const loaded = ref(false)

  async function load() {
    const [a, s] = await Promise.all([
      supabase.from('movement_analyses').select(LIST_COLS).order('recorded_at', { ascending: false }).limit(1000),
      supabase.from('analysis_settings').select('thresholds').eq('id', 1).maybeSingle(),
    ])
    list.value = ok(a) as AnalysisRow[]
    thresholds.value = ((ok(s) as { thresholds: Thresholds } | null)?.thresholds ?? {}) as Thresholds
    loaded.value = true
    purgeExpiredVideos().catch(() => null)
  }

  async function get(id: string): Promise<AnalysisFull> {
    return ok(await supabase.from('movement_analyses').select(`${LIST_COLS}, width, height, frames, findings`).eq('id', id).single()) as AnalysisFull
  }

  async function create(input: Omit<AnalysisFull, 'id' | 'created_at' | 'video_path' | 'video_expires_at' | 'reps_actual'>, video?: Blob) {
    const row = ok(await supabase.from('movement_analyses').insert(input).select(LIST_COLS).single()) as AnalysisRow
    if (video) {
      try {
        await attachVideo(row, video)
      } catch (e) {
        console.error(e)
      }
    }
    list.value.unshift(row)
    return row
  }

  async function attachVideo(row: AnalysisRow, video: Blob) {
    const ext = video.type.includes('webm') ? 'webm' : video.type.includes('quicktime') ? 'mov' : 'mp4'
    const path = `${row.id}.${ext}`
    ok(await supabase.storage.from(ANALYSIS_BUCKET).upload(path, video, { contentType: video.type || 'video/mp4', upsert: true }))
    const patch = { video_path: path, video_expires_at: new Date(Date.now() + VIDEO_KEEP_DAYS * 864e5).toISOString() }
    await update(row.id, patch)
    Object.assign(row, patch)
  }

  async function update(id: string, patch: Partial<Pick<AnalysisRow, 'label' | 'is_reference' | 'reps_actual' | 'notes' | 'client_id' | 'video_path' | 'video_expires_at' | 'reps' | 'view'>> & { findings?: StoredFinding[] }) {
    ok(await supabase.from('movement_analyses').update(patch).eq('id', id))
    const r = list.value.find((x) => x.id === id)
    if (r) Object.assign(r, patch)
  }

  async function remove(id: string) {
    const r = list.value.find((x) => x.id === id)
    if (r?.video_path) await supabase.storage.from(ANALYSIS_BUCKET).remove([r.video_path])
    ok(await supabase.from('movement_analyses').delete().eq('id', id))
    list.value = list.value.filter((x) => x.id !== id)
  }

  async function deleteVideo(id: string) {
    const r = list.value.find((x) => x.id === id)
    if (!r?.video_path) return
    await supabase.storage.from(ANALYSIS_BUCKET).remove([r.video_path])
    await update(id, { video_path: null, video_expires_at: null })
  }

  async function videoUrl(path: string) {
    const { data } = await supabase.storage.from(ANALYSIS_BUCKET).createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  }

  /** RODO: nagrania po terminie usuwamy przy każdym otwarciu listy przez trenerkę (szkielet i pomiary zostają). */
  async function purgeExpiredVideos() {
    const now = new Date().toISOString()
    for (const r of list.value.filter((x) => x.video_path && x.video_expires_at && x.video_expires_at < now)) await deleteVideo(r.id)
  }

  async function saveThresholds(th: Thresholds) {
    ok(await supabase.from('analysis_settings').update({ thresholds: th, updated_at: new Date().toISOString() }).eq('id', 1))
    thresholds.value = th
  }

  const references = (ex: ExerciseKey) => list.value.filter((r) => r.is_reference && r.exercise_key === ex)
  const forClient = (clientId: string) => list.value.filter((r) => r.client_id === clientId)

  return { list, thresholds, loaded, load, get, create, attachVideo, update, remove, deleteVideo, videoUrl, saveThresholds, references, forClient }
})
