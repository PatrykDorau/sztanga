import { defineStore } from 'pinia'
import { ref } from 'vue'
import { MEDIA_BUCKET, supabase } from '@/lib/supabase'
import type { Exercise, ExerciseInput, ExerciseRelation, RelationKind } from '@/types'

const COLUMNS =
  'id, name_pl, name_en, muscle_groups, equipment, movement_pattern, level, contraindications, cues, video_path, image_url, primary_muscles, secondary_muscles, description, mechanic, force, image_urls, attribution, search_terms, tags, cues_lang, source, external_id, created_at, updated_at'

export const useExercisesStore = defineStore('exercises', () => {
  const all = ref<Exercise[]>([])
  const favorites = ref<Set<string>>(new Set())
  const relations = ref<ExerciseRelation[]>([])
  const loaded = ref(false)
  const loading = ref(false)

  // Całą bazę trzymamy w pamięci: ~50 własnych + ewentualnie ~900 importowanych to wciąż mało,
  // a wyszukiwanie po stronie klienta jest natychmiastowe (cel: dowolne ćwiczenie w < 10 s).
  async function load(force = false) {
    if ((loaded.value && !force) || loading.value) return
    loading.value = true
    try {
      const pageSize = 1000
      const rows: Exercise[] = []
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from('exercises')
          .select(COLUMNS)
          .order('name_pl')
          .range(from, from + pageSize - 1)
        if (error) throw error
        rows.push(...(data as Exercise[]))
        if (!data || data.length < pageSize) break
      }
      const [fav, rel] = await Promise.all([
        supabase.from('exercise_favorites').select('exercise_id'),
        supabase.from('exercise_relations').select('from_exercise, to_exercise, kind'),
      ])
      all.value = rows
      favorites.value = new Set((fav.data ?? []).map((f) => f.exercise_id as string))
      relations.value = (rel.data ?? []) as ExerciseRelation[]
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  const byId = (id: string) => all.value.find((e) => e.id === id)

  async function save(input: ExerciseInput, id?: string): Promise<Exercise> {
    const q = id
      ? supabase.from('exercises').update(input).eq('id', id).select(COLUMNS).single()
      : supabase.from('exercises').insert(input).select(COLUMNS).single()
    const { data, error } = await q
    if (error) throw error
    const row = data as Exercise
    const i = all.value.findIndex((e) => e.id === row.id)
    if (i >= 0) all.value[i] = row
    else all.value.push(row)
    all.value.sort((a, b) => a.name_pl.localeCompare(b.name_pl, 'pl'))
    return row
  }

  /** Własne etykiety trenerki (np. „bułgar”, „ulubione Ani”) – widoczne obok nazwy i przeszukiwane. */
  async function setTags(id: string, tags: string[]) {
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 8)
    const { error } = await supabase.from('exercises').update({ tags: clean }).eq('id', id)
    if (error) throw error
    const e = all.value.find((x) => x.id === id)
    if (e) all.value.splice(all.value.indexOf(e), 1, { ...e, tags: clean })
  }

  async function remove(id: string) {
    const ex = byId(id)
    const { error } = await supabase.from('exercises').delete().eq('id', id)
    if (error) throw error
    if (ex?.video_path) await supabase.storage.from(MEDIA_BUCKET).remove([ex.video_path])
    all.value = all.value.filter((e) => e.id !== id)
    relations.value = relations.value.filter((r) => r.from_exercise !== id && r.to_exercise !== id)
  }

  async function uploadVideo(file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
    const path = `videos/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(path, file, { contentType: file.type || 'video/mp4', upsert: false })
    if (error) throw error
    return path
  }

  async function videoUrl(path: string): Promise<string | null> {
    const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60 * 60)
    return data?.signedUrl ?? null
  }

  async function toggleFavorite(id: string) {
    const next = new Set(favorites.value)
    if (next.has(id)) {
      next.delete(id)
      favorites.value = next
      await supabase.from('exercise_favorites').delete().eq('exercise_id', id)
    } else {
      next.add(id)
      favorites.value = next
      await supabase.from('exercise_favorites').insert({ exercise_id: id })
    }
  }

  // --- Graf powiązań ---
  // progression: from → to (to jest trudniejsze). Regresje ćwiczenia X = wiersze z to_exercise = X.
  const progressionsOf = (id: string) =>
    relations.value.filter((r) => r.kind === 'progression' && r.from_exercise === id).map((r) => r.to_exercise)
  const regressionsOf = (id: string) =>
    relations.value.filter((r) => r.kind === 'progression' && r.to_exercise === id).map((r) => r.from_exercise)
  // Alternatywy są zapisane w obie strony – bez powtórzeń.
  const alternativesOf = (id: string) => [
    ...new Set(
      relations.value
        .filter((r) => r.kind === 'alternative' && (r.from_exercise === id || r.to_exercise === id))
        .map((r) => (r.from_exercise === id ? r.to_exercise : r.from_exercise)),
    ),
  ]

  /** Pełny łańcuch od najłatwiejszej regresji do najtrudniejszej progresji (po pierwszej gałęzi). */
  function chainOf(id: string): string[] {
    const seen = new Set([id])
    const down: string[] = []
    let cur = id
    for (;;) {
      const next = regressionsOf(cur).find((x) => !seen.has(x))
      if (!next) break
      seen.add(next)
      down.unshift(next)
      cur = next
    }
    const up: string[] = []
    cur = id
    for (;;) {
      const next = progressionsOf(cur).find((x) => !seen.has(x))
      if (!next) break
      seen.add(next)
      up.push(next)
      cur = next
    }
    return [...down, id, ...up]
  }

  /** Dodaje powiązanie. Dla "regresji" zapisujemy odwrócony wiersz progresji. */
  async function link(id: string, otherId: string, type: 'regression' | RelationKind) {
    const row: ExerciseRelation =
      type === 'regression'
        ? { from_exercise: otherId, to_exercise: id, kind: 'progression' }
        : { from_exercise: id, to_exercise: otherId, kind: type }
    const { error } = await supabase.from('exercise_relations').insert(row)
    if (error && error.code !== '23505') throw error
    if (!error) relations.value.push(row)
  }

  async function unlink(a: string, b: string) {
    const { error } = await supabase
      .from('exercise_relations')
      .delete()
      .or(`and(from_exercise.eq.${a},to_exercise.eq.${b}),and(from_exercise.eq.${b},to_exercise.eq.${a})`)
    if (error) throw error
    relations.value = relations.value.filter(
      (r) => !((r.from_exercise === a && r.to_exercise === b) || (r.from_exercise === b && r.to_exercise === a)),
    )
  }

  return {
    setTags,
    all, favorites, relations, loaded, loading,
    load, byId, save, remove, uploadVideo, videoUrl, toggleFavorite,
    progressionsOf, regressionsOf, alternativesOf, chainOf, link, unlink,
  }
})
