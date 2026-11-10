<script setup lang="ts">
// Zakładka "Ruch" klienta: nagrania po kolei (najnowsze na górze) na tle wzorca – widać postęp techniki.
import { computed, onMounted } from 'vue'
import { useAnalysisStore } from '@/stores/analysis'
import { flagsFor } from '@/lib/pose/analysis'
import { PROFILES, VIEW_LABEL, type ExerciseKey } from '@/lib/pose/profiles'
import { cellsFor, groupsFor, refStatsByExercise, shortDate, type HeatRow } from '@/lib/pose/heat'
import MetricHeatmap from '@/components/MetricHeatmap.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ clientId: string }>()
const store = useAnalysisStore()
onMounted(() => store.load().catch(() => null))

const mine = computed(() => store.forClient(props.clientId))
const used = computed(() => [...new Set(mine.value.map((a) => a.exercise_key))] as ExerciseKey[])
const stats = computed(() => refStatsByExercise(store.list))
const sections = computed(() => [
  {
    title: 'Nagrania',
    rows: mine.value.map(
      (a): HeatRow => ({
        id: a.id,
        label: shortDate(a.recorded_at),
        sub: `${PROFILES[a.exercise_key].name.toLowerCase()} · ${a.reps.length} powt.`,
        to: `/analiza/${a.id}`,
        cells: cellsFor([a], stats.value),
      }),
    ),
  },
])
</script>

<template>
  <div class="space-y-5">
    <RouterLink :to="`/analiza/nowa?client=${clientId}`" class="btn-primary w-full"><Icon name="video" class="size-5" />Nagraj analizę ruchu</RouterLink>

    <template v-if="mine.length">
      <section class="space-y-2">
        <h2 class="text-xl font-bold">Technika na tle wzorca</h2>
        <MetricHeatmap :groups="groupsFor(used)" :sections="sections" />
      </section>
      <section class="space-y-2">
        <RouterLink v-for="a in mine" :key="a.id" :to="`/analiza/${a.id}`" class="card pressable flex items-center gap-3 p-4 hover:bg-surface-2">
          <div class="min-w-0 flex-1">
            <p class="font-semibold">{{ PROFILES[a.exercise_key].name }} · {{ a.reps.length }} powt.</p>
            <p class="text-sm text-muted">{{ shortDate(a.recorded_at) }} · {{ VIEW_LABEL[a.view] }}</p>
            <p v-for="f in flagsFor(a.exercise_key, a.reps, store.thresholds)" :key="f.key" class="text-sm text-[var(--div-pos)]">{{ f.text }}</p>
          </div>
          <Icon name="chevron" class="size-5 shrink-0 text-subtle" />
        </RouterLink>
      </section>
    </template>
    <p v-else-if="store.loaded" class="card p-6 text-center text-sm text-muted">
      Brak nagrań. Nagraj np. przysiad z przodu i z boku – aplikacja policzy powtórzenia, zmierzy kąty i porówna ze wzorcem.
    </p>
  </div>
</template>
