<script setup lang="ts">
// Heatmapa odchyleń od wzorca (jak porównanie zawodowców i amatorów): wiersze = osoby/nagrania,
// kolumny = pomiary pogrupowane po ćwiczeniach. Kolor: niebieski = mniej niż wzorzec, czerwony = więcej,
// szary = jak wzorzec; przerywana ramka = pomiar niemożliwy z tego ujęcia / brak nagrania.
import { computed, ref } from 'vue'
import { fmtMetric, type MetricDef } from '@/lib/pose/profiles'
import type { HeatCell, HeatGroup, HeatRow } from '@/lib/pose/heat'

const props = defineProps<{ groups: HeatGroup[]; sections: { title: string; rows: HeatRow[] }[]; emptyText?: string }>()

const hover = ref<{ row: HeatRow; group: HeatGroup; metric: MetricDef } | null>(null)
const hoverCol = computed(() => (hover.value ? `${hover.value.group.key}.${hover.value.metric.key}` : null))

function bg(c: HeatCell | undefined) {
  if (!c || c.z == null) return undefined
  const pct = Math.round(Math.min(1, Math.abs(c.z) / 2) * 100)
  return `color-mix(in oklab, var(--div-mid), var(${c.z < 0 ? '--div-neg' : '--div-pos'}) ${pct}%)`
}

function describe(c: HeatCell | undefined, m: MetricDef) {
  if (!c || c.value == null) return 'brak pomiaru (inne ujęcie kamery albo brak nagrania)'
  if (c.ref == null || c.z == null) return `${fmtMetric(m, c.value)} · brak wzorca`
  const d = c.value - c.ref
  const near = Math.abs(c.z) < 0.5
  return `${fmtMetric(m, c.value)} · wzorzec ${fmtMetric(m, c.ref)}${near ? ' · jak wzorzec' : ` · ${d > 0 ? 'więcej' : 'mniej'} o ${fmtMetric(m, Math.abs(d))}`}`
}

const cols = computed(() => props.groups.flatMap((g) => g.metrics.map((m) => ({ g, m }))))
const hasRows = computed(() => props.sections.some((s) => s.rows.length))
</script>

<template>
  <div>
    <p v-if="!hasRows" class="card p-6 text-center text-sm text-muted">{{ emptyText ?? 'Brak nagrań do porównania.' }}</p>
    <template v-else>
      <!-- Podpowiedź pod palcem / kursorem (zamiast liczby w każdej komórce) -->
      <p class="mb-2 min-h-10 text-sm" aria-live="polite">
        <template v-if="hover">
          <strong>{{ hover.row.label }}</strong> · {{ hover.group.name }}, {{ hover.metric.label.toLowerCase() }}:
          <span class="text-muted">{{ describe(hover.row.cells[`${hover.group.key}.${hover.metric.key}`], hover.metric) }}</span>
        </template>
        <span v-else class="text-muted">Dotknij komórki, żeby zobaczyć wartość i porównanie ze wzorcem.</span>
      </p>
      <div class="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin]">
        <table class="border-separate border-spacing-[2px] text-xs" @mouseleave="hover = null">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 bg-bg" />
              <th v-for="g in groups" :key="g.key" :colspan="g.metrics.length" class="px-1 pb-1 text-center font-display text-sm font-bold">
                <span class="block border-b-2 border-line-strong pb-0.5">{{ g.name }}</span>
              </th>
            </tr>
            <tr>
              <th class="sticky left-0 z-10 bg-bg" />
              <th v-for="c in cols" :key="`${c.g.key}.${c.m.key}`" class="relative h-24 w-7 max-w-7 min-w-7 p-0 align-bottom">
                <span
                  class="absolute bottom-1 left-3.5 origin-bottom-left -rotate-[55deg] font-medium whitespace-nowrap"
                  :class="hoverCol === `${c.g.key}.${c.m.key}` ? 'font-bold text-fg' : 'text-muted'"
                  >{{ c.m.short }}</span
                >
              </th>
            </tr>
          </thead>
          <tbody v-for="s in sections" :key="s.title">
            <tr v-if="s.rows.length">
              <th :colspan="cols.length + 1" class="sticky left-0 pt-3 pb-1 text-left text-sm font-bold">{{ s.title }}</th>
            </tr>
            <tr v-for="r in s.rows" :key="r.id">
              <th class="sticky left-0 z-10 max-w-36 bg-bg pr-2 text-left font-semibold">
                <RouterLink v-if="r.to" :to="r.to" class="block truncate underline-offset-4 hover:underline">{{ r.label }}</RouterLink>
                <span v-else class="block truncate">{{ r.label }}</span>
                <span v-if="r.sub" class="block truncate text-[10px] font-normal text-subtle">{{ r.sub }}</span>
              </th>
              <td v-for="c in cols" :key="`${c.g.key}.${c.m.key}`" class="p-0">
                <button
                  type="button"
                  class="block size-7 rounded-[4px] outline-offset-1"
                  :class="[
                    r.cells[`${c.g.key}.${c.m.key}`]?.z == null ? 'border border-dashed border-line-strong' : '',
                    hover?.row.id === r.id && hoverCol === `${c.g.key}.${c.m.key}` ? 'outline-2 outline-fg' : '',
                    hoverCol === `${c.g.key}.${c.m.key}` && hover?.row.id !== r.id ? 'opacity-90 ring-1 ring-line-strong' : '',
                  ]"
                  :style="{ background: bg(r.cells[`${c.g.key}.${c.m.key}`]) }"
                  :aria-label="`${r.label}, ${c.g.name}, ${c.m.label}: ${describe(r.cells[`${c.g.key}.${c.m.key}`], c.m)}`"
                  @mouseenter="hover = { row: r, group: c.g, metric: c.m }"
                  @focus="hover = { row: r, group: c.g, metric: c.m }"
                  @click="hover = { row: r, group: c.g, metric: c.m }"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- Legenda -->
      <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <span class="flex items-center gap-1.5">
          mniej niż wzorzec
          <span class="flex gap-[2px]" aria-hidden="true">
            <span v-for="z in [-2, -1, 0, 1, 2]" :key="z" class="size-4 rounded-[3px]" :style="{ background: bg({ value: 0, z, ref: 0 }) }" />
          </span>
          więcej niż wzorzec
        </span>
        <span class="flex items-center gap-1.5"><span class="size-4 rounded-[3px] border border-dashed border-line-strong" aria-hidden="true" />brak pomiaru</span>
      </div>
    </template>
  </div>
</template>
