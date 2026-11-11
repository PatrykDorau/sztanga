<script setup lang="ts">
// Analiza ruchu – przegląd: heatmapa (wzorce vs klienci, ostatnie nagranie każdego ćwiczenia) + ostatnie nagrania z flagami.
import { computed, onMounted, ref } from 'vue'
import { useAnalysisStore, type AnalysisRow } from '@/stores/analysis'
import { useClientsStore } from '@/stores/clients'
import { flagsFor } from '@/lib/pose/analysis'
import { EXERCISE_KEYS, PROFILES, VIEW_LABEL, type ExerciseKey } from '@/lib/pose/profiles'
import { cellsFor, groupsFor, lastDate, refStatsByExercise, shortDate, type HeatRow } from '@/lib/pose/heat'
import MetricHeatmap from '@/components/MetricHeatmap.vue'
import MovementInsights from '@/components/MovementInsights.vue'
import Icon from '@/components/Icon.vue'

const store = useAnalysisStore()
const clients = useClientsStore()
const error = ref('')
onMounted(async () => {
  try {
    await Promise.all([store.load(), clients.load()])
  } catch (e) {
    error.value = (e as Error).message
  }
})

const who = (a: AnalysisRow) => (a.client_id ? (clients.byId(a.client_id)?.full_name ?? 'Klient') : (a.label ?? 'Trenerka'))
const used = computed<ExerciseKey[]>(() => {
  const k = EXERCISE_KEYS.filter((e) => store.list.some((a) => a.exercise_key === e))
  return k.length ? k : ['squat']
})
const stats = computed(() => refStatsByExercise(store.list))

const sections = computed(() => {
  const byPerson = (rows: AnalysisRow[], key: (a: AnalysisRow) => string) => {
    const m = new Map<string, AnalysisRow[]>()
    for (const a of rows) m.set(key(a), [...(m.get(key(a)) ?? []), a])
    return [...m.entries()]
  }
  const refRows: HeatRow[] = byPerson(store.list.filter((a) => a.is_reference), (a) => a.client_id ?? 'trener').map(([k, list]) => ({
    id: `ref:${k}`,
    label: list[0].client_id ? who(list[0]) : 'Trenerka',
    sub: `${list.length} ${list.length === 1 ? 'nagranie' : 'nagrania'}`,
    cells: cellsFor(list, stats.value),
  }))
  const clientRows: HeatRow[] = byPerson(store.list.filter((a) => a.client_id && !a.is_reference), (a) => a.client_id!)
    .map(([id, list]) => {
      return {
        id,
        label: clients.byId(id)?.full_name ?? 'Klient',
        sub: `ostatnio ${shortDate(lastDate(list))}`,
        to: `/klienci/${id}?tab=ruch`,
        cells: cellsFor(list, stats.value),
      }
    })
    .sort((x, y) => x.label.localeCompare(y.label, 'pl'))
  return [
    { title: 'Wzorce', rows: refRows },
    { title: 'Klienci', rows: clientRows },
  ]
})

const recent = computed(() =>
  store.list.slice(0, 20).map((a) => ({ a, flags: flagsFor(a.exercise_key, a.reps, store.thresholds) })),
)
const missingRefs = computed(() => used.value.filter((k) => !store.references(k).length))
</script>

<template>
  <main class="pb-28">
    <header class="page-header flex items-center justify-between gap-2 px-4 pb-3">
      <div>
        <p class="eyebrow">Na telefonie, bez wysyłania wideo</p>
        <h1 class="page-title">Analiza ruchu</h1>
      </div>
      <RouterLink to="/analiza/progi" class="icon-btn !h-auto flex-col py-1" aria-label="Progi i dokładność licznika">
        <Icon name="filter" class="size-5" /><span class="mt-0.5 block text-[10px] leading-none font-semibold text-muted">Progi</span>
      </RouterLink>
    </header>

    <div class="space-y-6 px-4">
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <p v-else-if="!store.loaded" class="text-muted">Ładowanie…</p>

      <p v-if="store.loaded && missingRefs.length" class="card flex gap-3 p-4 text-sm">
        <Icon name="star" class="size-5 shrink-0 text-primary-fg" />
        <span>
          Brak wzorca: {{ missingRefs.map((k) => PROFILES[k].name.toLowerCase()).join(', ') }}. Nagraj siebie (albo klienta z dobrą techniką) i zaznacz „Wzorzec” – kolory heatmapy
          pokażą, czym klienci się od niego różnią.
        </span>
      </p>

      <section class="space-y-2">
        <h2 class="text-xl font-bold">Ostatnie nagrania</h2>
        <p v-if="store.loaded && !recent.length" class="text-sm text-muted">Jeszcze nic nie nagrano.</p>
        <RouterLink v-for="{ a, flags } in recent" :key="a.id" :to="`/analiza/${a.id}`" class="card pressable flex items-center gap-3 p-4 hover:bg-surface-2">
          <div class="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2">
            <span class="font-display text-xl leading-none font-bold tabular-nums">{{ a.reps.length }}</span>
            <span class="text-[10px] text-muted">powt.</span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold">
              {{ who(a) }} · {{ PROFILES[a.exercise_key].name }}<span v-if="a.is_reference" class="tag ml-1.5 !py-0 !text-[11px]">wzorzec</span>
            </p>
            <p class="truncate text-sm text-muted">{{ shortDate(a.recorded_at) }} · {{ VIEW_LABEL[a.view] }}<template v-if="a.video_path"> · z nagraniem</template></p>
            <p v-if="flags.length" class="truncate text-sm text-[var(--div-pos)]">{{ flags.map((f) => f.text).join(' · ') }}</p>
          </div>
          <Icon name="chevron" class="size-5 shrink-0 text-subtle" />
        </RouterLink>
      </section>

      <section class="space-y-2">
        <h2 class="text-xl font-bold">Porównanie z wzorcem</h2>
        <MetricHeatmap :groups="groupsFor(used)" :sections="sections" empty-text="Brak nagrań. Zacznij od przysiadu – nagraj wzorzec, potem klientów." />
      </section>

      <section v-if="sections[1].rows.length" class="space-y-2">
        <h2 class="text-xl font-bold">Wnioski</h2>
        <MovementInsights :rows="sections[1].rows" />
      </section>
    </div>

    <RouterLink to="/analiza/nowa" class="btn-primary fixed right-4 z-20 shadow-lg" style="bottom: calc(5rem + env(safe-area-inset-bottom))">
      <Icon name="video" class="size-5" />Nagraj
    </RouterLink>
  </main>
</template>
