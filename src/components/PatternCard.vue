<script setup lang="ts">
// Porównanie powtórzeń ze wzorcem rodziny ruchu: zgodność zakresów ruchu stawów + animowany wzorzec obok.
import { computed } from 'vue'
import type { Rep, Series } from '@/lib/pose/analysis'
import { comparePattern, FAMILIES, variantOf, type FamilyKey } from '@/lib/pose/families'
import ExerciseAnimation from '@/components/ExerciseAnimation.vue'

const props = defineProps<{ family: FamilyKey; series: Series; reps: Pick<Rep, 'start' | 'end'>[]; equipment?: string[] }>()
const match = computed(() => comparePattern(props.series, props.reps, props.family, variantOf(props.equipment)))
const tone = (s: number) => (s >= 80 ? 'bg-success-soft text-success' : s >= 60 ? 'bg-warn-soft text-warn-fg' : 'bg-danger-soft text-danger')
const order = { extra: 0, short: 1, long: 2, ok: 3 } as const
const lines = computed(() => [...(match.value?.joints ?? [])].sort((a, b) => order[a.verdict] - order[b.verdict]))
</script>

<template>
  <section class="card space-y-3 p-4">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-lg font-bold">Wzorzec: {{ FAMILIES[family].name.toLowerCase() }}</h2>
      <span v-if="match" class="rounded-full px-2.5 py-1 text-sm font-bold tabular-nums" :class="tone(match.score)">{{ match.score }}% zgodności</span>
    </div>
    <div class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3">
      <ExerciseAnimation :family="family" :equipment="equipment" small />
      <ul v-if="lines.length" class="space-y-2 text-sm">
        <li v-for="j in lines" :key="j.joint" class="flex gap-2">
          <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="j.verdict === 'ok' ? 'bg-success' : j.verdict === 'extra' || j.verdict === 'short' ? 'bg-danger' : 'bg-warn-fg'" />
          <span>{{ j.text }}</span>
        </li>
      </ul>
      <p v-else class="text-sm text-muted">Za mało danych do porównania – potrzebne co najmniej jedno wykryte powtórzenie.</p>
    </div>
    <p class="text-xs text-muted">Porównujemy zakresy ruchu stawów (kąty w 3D, niezależne od ujęcia) z rysowanym wzorcem – orientacyjnie. Dokładniejsze porównanie sylwetki daje Twoje nagranie zapisane jako „Wzorzec”.</p>
  </section>
</template>
