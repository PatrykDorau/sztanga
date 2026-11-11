<script setup lang="ts">
// Postępy z perspektywy klienta – tylko sekcje włączone przez trenerkę (Widok klienta na karcie klienta).
import { computed, onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useProgressStore } from '@/stores/progress'
import { useExercisesStore } from '@/stores/exercises'
import { loadMyView, myClientId, myProgressAny, myView } from '@/lib/clientView'
import { seriesByExercise } from '@/lib/analytics'
import { fmtKg } from '@/lib/strength'
import { MEASUREMENTS } from '@/lib/vocab'
import { PROFILES, type ExerciseKey } from '@/lib/pose/profiles'
import type { StoredFinding } from '@/stores/analysis'
import ClientExerciseStats from '@/components/ClientExerciseStats.vue'
import ClientHistory from '@/components/ClientHistory.vue'
import LineChart from '@/components/LineChart.vue'
import Icon from '@/components/Icon.vue'

const progress = useProgressStore()
const ex = useExercisesStore()
const ready = ref(false)
const error = ref('')

interface MyAnalysis {
  id: string
  exercise_key: ExerciseKey
  recorded_at: string
  reps: unknown[]
  findings: StoredFinding[] | null
}
const analyses = ref<MyAnalysis[]>([])

onMounted(async () => {
  try {
    await Promise.all([loadMyView(), ex.load()])
    if (myClientId.value) {
      await progress.loadClient(myClientId.value)
      if (myView('analyses')) {
        const { data } = await supabase.from('movement_analyses').select('id, exercise_key, recorded_at, reps, findings').eq('client_id', myClientId.value).order('recorded_at', { ascending: false }).limit(20)
        analyses.value = (data ?? []) as MyAnalysis[]
      }
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    ready.value = true
  }
})

const logs = computed(() => (myClientId.value ? (progress.logs[myClientId.value] ?? []) : []))
const records = computed(() =>
  seriesByExercise(logs.value)
    .filter((s) => s.best)
    .map((s) => ({ ...s.best!, id: s.exercise_id }))
    .sort((a, b) => b.date.localeCompare(a.date)),
)
const measurements = computed(() => (myClientId.value ? (progress.measurements[myClientId.value] ?? []) : []))
const kinds = computed(() => [...new Set(measurements.value.map((m) => m.kind))])
const mKind = ref<string | null>(null)
const kind = computed(() => mKind.value ?? kinds.value[0] ?? null)
const mPoints = computed(() => measurements.value.filter((m) => m.kind === kind.value).map((m) => ({ x: m.measured_on, y: Number(m.value) })))
const unitOf = (k: string | null) => (k ? (MEASUREMENTS[k]?.unit ?? measurements.value.find((m) => m.kind === k)?.unit ?? '') : '')
const day = (d: string) => new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })
</script>

<template>
  <main class="space-y-5 px-4 pb-8" style="padding-top: max(1.5rem, env(safe-area-inset-top))">
    <h1 class="page-title">Moje postępy</h1>
    <p v-if="!ready" class="text-muted">Ładowanie…</p>
    <p v-else-if="error" class="text-danger" role="alert">{{ error }}</p>
    <p v-else-if="!myClientId || !myProgressAny" class="card p-5 text-sm text-muted">Trenerka nie udostępniła jeszcze postępów w aplikacji.</p>
    <template v-else>
      <ClientExerciseStats v-if="myView('progress')" :logs="logs" />

      <section v-if="myView('records') && records.length">
        <h2 class="mb-2 text-lg font-bold">Rekordy</h2>
        <ul class="card divide-y divide-line">
          <li v-for="r in records.slice(0, 12)" :key="r.id" class="flex items-center gap-3 p-3">
            <Icon name="trophy" class="size-5 shrink-0 text-primary-fg" />
            <span class="min-w-0 flex-1 truncate">{{ ex.byId(r.id)?.name_pl }}</span>
            <span class="font-semibold tabular-nums">{{ fmtKg(r.load) }}</span>
            <span class="w-20 text-right text-xs text-muted">{{ day(r.date) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="myView('measurements') && kinds.length" class="space-y-2">
        <h2 class="text-lg font-bold">Pomiary i testy</h2>
        <select v-model="mKind" class="input" aria-label="Rodzaj pomiaru">
          <option v-for="k in kinds" :key="k" :value="k">{{ MEASUREMENTS[k]?.label ?? k }}</option>
        </select>
        <LineChart v-if="kind" :points="mPoints" :unit="unitOf(kind)" :title="MEASUREMENTS[kind]?.label ?? kind" :mark-best="false" />
      </section>

      <section v-if="myView('analyses') && analyses.length" class="space-y-2">
        <h2 class="text-lg font-bold">Analizy ruchu</h2>
        <article v-for="a in analyses" :key="a.id" class="card space-y-1 p-4">
          <p class="font-semibold">{{ PROFILES[a.exercise_key]?.name ?? 'Ćwiczenie' }} · {{ a.reps.length }} powt.</p>
          <p class="text-xs text-muted">{{ day(a.recorded_at) }}</p>
          <ul v-if="a.findings?.length" class="mt-1 space-y-1 text-sm">
            <li v-for="f in a.findings" :key="f.key"><strong>{{ f.title }}</strong> – {{ f.cue }}</li>
          </ul>
          <p v-else class="text-sm text-success">Bez uwag do techniki.</p>
        </article>
      </section>

      <section v-if="myView('history')" class="space-y-2">
        <h2 class="text-lg font-bold">Historia treningów</h2>
        <ClientHistory :client-id="myClientId" readonly />
      </section>
    </template>
  </main>
</template>
