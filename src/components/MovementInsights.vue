<script setup lang="ts">
// Wnioski z porównania ze wzorcem: dla każdej osoby – co wyraźnie odbiega (z liczbami) i co z tym zrobić.
import { computed, ref } from 'vue'
import type { HeatRow } from '@/lib/pose/heat'
import { insightsFor } from '@/lib/pose/insights'

const props = withDefaults(defineProps<{ rows: HeatRow[]; showName?: boolean; limit?: number }>(), { showName: true, limit: 4 })
const open = ref<Set<string>>(new Set())
const people = computed(() =>
  props.rows
    .map((r) => {
      const all = insightsFor(r.cells)
      return { row: r, fix: all.filter((i) => !i.ok), good: all.filter((i) => i.ok) }
    })
    .filter((p) => p.fix.length || p.good.length),
)
function toggle(id: string) {
  const s = new Set(open.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  open.value = s
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="!people.length" class="text-sm text-muted">Brak wyraźnych różnic względem wzorca (wszystko w granicach jego rozrzutu) albo brak wzorca do porównania.</p>
    <article v-for="p in people" :key="p.row.id" class="card space-y-2 p-4 text-sm">
      <p v-if="showName" class="flex items-baseline justify-between gap-2">
        <RouterLink v-if="p.row.to" :to="p.row.to" class="truncate font-bold underline-offset-4 hover:underline">{{ p.row.label }}</RouterLink>
        <span v-else class="truncate font-bold">{{ p.row.label }}</span>
        <span v-if="p.row.sub" class="shrink-0 text-xs text-muted">{{ p.row.sub }}</span>
      </p>
      <ul v-if="p.fix.length" class="space-y-2">
        <li v-for="i in open.has(p.row.id) ? p.fix : p.fix.slice(0, limit)" :key="i.key" class="flex gap-2">
          <span class="mt-1.5 size-2 shrink-0 rounded-full" :style="{ background: i.strong ? 'var(--div-pos)' : 'color-mix(in oklab, var(--div-mid), var(--div-pos) 60%)' }" aria-hidden="true" />
          <span class="min-w-0">
            <span class="block font-semibold first-letter:uppercase">{{ i.text }}</span>
            <span class="block text-xs text-muted tabular-nums">{{ i.exercise }} · {{ i.metric.toLowerCase() }}: {{ i.diff }}</span>
            <span v-if="i.tip" class="block">{{ i.tip }}</span>
          </span>
        </li>
      </ul>
      <button v-if="p.fix.length > limit" type="button" class="text-xs font-semibold text-primary-fg" @click="toggle(p.row.id)">
        {{ open.has(p.row.id) ? 'Pokaż mniej' : `Pokaż wszystkie (${p.fix.length})` }}
      </button>
      <p v-if="p.good.length" class="text-xs text-muted">
        <span class="font-semibold text-success">Na plus:</span> {{ p.good.map((i) => i.text).join(' · ') }}
      </p>
    </article>
    <p class="text-xs text-muted">
      Wnioski biorą tylko pomiary wyraźnie poza rozrzutem wzorca. To podpowiedź z kamery 2D – zawsze potwierdź na nagraniu, zanim zmienisz technikę.
    </p>
  </div>
</template>
