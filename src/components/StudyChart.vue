<script setup lang="ts">
// Wykres badania: jeden test, poziome słupki dla każdej osoby, po jednym słupku na termin (kolor = termin).
// Skala od zera, legenda zawsze widoczna, wartości po dotknięciu wiersza (pełne liczby są też w tabeli).
import { computed, ref } from 'vue'
import { fmt } from '@/lib/studies'

const props = defineProps<{
  rows: { id: string; name: string; sub?: string | null; values: (number | null)[]; excluded?: boolean[] }[]
  series: { label: string }[]
  unit: string
  average?: (number | null)[]
}>()
const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']
const max = computed(() => {
  const all = props.rows.flatMap((r) => r.values).concat(props.average ?? []).filter((v): v is number => v != null)
  const m = Math.max(0, ...all)
  if (!m) return 1
  const step = 10 ** Math.floor(Math.log10(m))
  return Math.ceil((m * 1.05) / step) * step
})
const ticks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((f) => f * max.value))
const picked = ref<string | null>(null)
const pct = (v: number | null) => (v == null ? 0 : (v / max.value) * 100)
</script>

<template>
  <div class="space-y-3">
    <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
      <li v-for="(s, i) in series" :key="i" class="flex items-center gap-1.5">
        <span class="size-3 rounded-sm" :style="{ background: COLORS[i] }" />{{ s.label }}
      </li>
    </ul>

    <!-- oś: podziałka u góry -->
    <div class="grid grid-cols-[8rem_1fr] gap-2 text-[11px] text-muted tabular-nums">
      <span />
      <div class="relative h-4">
        <span v-for="(t, i) in ticks" :key="i" class="absolute -translate-x-1/2" :class="i === 0 ? 'translate-x-0' : i === ticks.length - 1 ? '-translate-x-full' : ''" :style="{ left: `${(t / max) * 100}%` }">{{ fmt(t, t < 10 ? 1 : 0) }}</span>
      </div>
    </div>

    <div class="space-y-1.5">
      <button
        v-for="r in rows"
        :key="r.id"
        type="button"
        class="grid w-full grid-cols-[8rem_1fr] items-center gap-2 rounded-lg py-1 text-left"
        :class="picked === r.id ? 'bg-surface-2' : ''"
        :aria-expanded="picked === r.id"
        @click="picked = picked === r.id ? null : r.id"
      >
        <span class="min-w-0">
          <span class="line-clamp-2 block text-sm leading-tight font-semibold">{{ r.name }}</span>
          <span v-if="r.sub" class="block truncate text-[11px] text-muted">{{ r.sub }}</span>
        </span>
        <span class="relative block">
          <!-- linie siatki -->
          <span v-for="(t, i) in ticks.slice(1)" :key="'g' + i" class="absolute inset-y-0 w-px bg-[var(--chart-grid)]" :style="{ left: `${(t / max) * 100}%` }" />
          <span class="relative flex flex-col gap-[2px]">
            <span v-for="(v, i) in r.values" :key="i" class="h-2 rounded-r" :style="{ width: `${pct(v)}%`, background: COLORS[i], opacity: r.excluded?.[i] ? 0.35 : 1 }" :title="`${series[i]?.label}: ${fmt(v, 2)} ${unit}`" />
          </span>
          <span v-if="picked === r.id" class="relative mt-1 block text-xs tabular-nums">
            <span v-for="(v, i) in r.values" :key="'v' + i" class="mr-3 inline-flex items-center gap-1">
              <span class="size-2 rounded-sm" :style="{ background: COLORS[i] }" />{{ fmt(v, 2) }}{{ unit ? ` ${unit}` : '' }}<span v-if="r.excluded?.[i]" class="text-muted"> (poza średnią)</span>
            </span>
          </span>
        </span>
      </button>
    </div>

    <div v-if="average?.some((v) => v != null)" class="grid grid-cols-[8rem_1fr] items-center gap-2 border-t border-line pt-2">
      <span class="text-sm font-bold">Średnia</span>
      <span class="flex flex-col gap-[2px]">
        <span v-for="(v, i) in average" :key="i" class="h-2 rounded-r" :style="{ width: `${pct(v)}%`, background: COLORS[i] }" :title="`${series[i]?.label}: ${fmt(v, 2)} ${unit}`" />
      </span>
    </div>
    <p class="text-xs text-muted">Dotknij wiersza, żeby zobaczyć wartości. Słupki przygaszone – osoba poza średnią w tym terminie.</p>
  </div>
</template>
