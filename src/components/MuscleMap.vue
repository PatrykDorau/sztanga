<script setup lang="ts">
// Mapa obciążenia mięśni: sylwetka z przodu i z tyłu, kolor = liczba serii na partię w treningu
// (mięsień główny ćwiczenia = 1 seria, pomocniczy = 0,5). Dotknięcie partii pokazuje, które ćwiczenia ją angażują.
import { computed, ref } from 'vue'
import { MUSCLES } from '@/lib/vocab'

export interface MapItem {
  name: string
  sets: number
  primary: string[]
  secondary: string[]
}
const props = defineProps<{ items: MapItem[]; title?: string }>()
const selected = ref<string | null>(null)

const load = computed(() => {
  const m: Record<string, number> = {}
  for (const it of props.items) {
    const s = it.sets || 1
    for (const p of it.primary) m[p] = (m[p] ?? 0) + s
    for (const p of it.secondary) if (!it.primary.includes(p)) m[p] = (m[p] ?? 0) + s * 0.5
  }
  return m
})
// Progi w seriach efektywnych na jeden trening
const LEVELS = [
  { min: 0.01, pct: 22, label: '1–3' },
  { min: 3.5, pct: 45, label: '4–6' },
  { min: 6.5, pct: 72, label: '7–9' },
  { min: 9.5, pct: 100, label: '10+' },
]
const levelOf = (v: number) => [...LEVELS].reverse().find((l) => v >= l.min) ?? null
function fill(m: string) {
  const l = levelOf(load.value[m] ?? 0)
  if (!l) return 'var(--surface-2)'
  return `color-mix(in oklab, var(--surface-2), var(--chart-1) ${l.pct}%)`
}
const ranking = computed(() =>
  Object.entries(load.value)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]),
)
const max = computed(() => Math.max(1, ...Object.values(load.value)))
const touching = computed(() =>
  selected.value
    ? props.items
        .filter((it) => it.primary.includes(selected.value!) || it.secondary.includes(selected.value!))
        .map((it) => ({ ...it, role: it.primary.includes(selected.value!) ? 'główny' : 'pomocniczy' }))
    : [],
)
const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',')
const pick = (m: string) => (selected.value = selected.value === m ? null : m)

/** Kształty partii: [mięsień, ścieżka SVG] – widok z przodu i z tyłu (środek sylwetki x = 100). */
const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${200 - Number(x)},${y}`)
const both = (m: string, d: string): [string, string][] => [
  [m, d],
  [m, mirror(d)],
]
const FRONT: [string, string][] = [
  ['neck', 'M92,44 L108,44 L108,56 L92,56 Z'],
  ['traps', 'M84,56 L100,52 L116,56 L124,64 L76,64 Z'],
  ...both('shoulders', 'M66,62 C54,64 50,78 54,90 C60,92 70,86 76,76 C78,68 74,62 66,62 Z'),
  ...both('chest', 'M99,66 L80,66 C72,70 70,82 72,94 C84,102 94,102 99,98 Z'),
  ...both('biceps', 'M54,94 C48,104 48,122 54,130 C62,130 66,118 64,98 Z'),
  ...both('forearms', 'M52,134 C44,146 44,166 50,176 C58,176 62,160 60,136 Z'),
  ['abdominals', 'M86,102 L114,102 L116,162 C110,170 90,170 84,162 Z'],
  ...both('abdominals', 'M84,104 L76,106 C74,126 76,148 82,160 L84,160 Z'),
  ...both('abductors', 'M76,166 C70,170 68,184 72,192 L78,190 L80,168 Z'),
  ...both('adductors', 'M99,176 L92,178 C90,196 94,214 99,226 Z'),
  ...both('quadriceps', 'M80,170 C72,196 74,228 82,256 L94,256 C96,232 94,204 91,178 Z'),
  ...both('calves', 'M82,276 C76,292 78,316 84,332 L90,332 C92,314 92,292 88,276 Z'),
]
const BACK: [string, string][] = [
  ['neck', 'M92,44 L108,44 L108,52 L92,52 Z'],
  ['traps', 'M100,50 L124,64 L110,92 L100,98 L90,92 L76,64 Z'],
  ...both('shoulders', 'M66,62 C54,64 50,78 54,90 C60,92 70,86 76,76 C78,68 74,62 66,62 Z'),
  ...both('lats', 'M78,90 C68,112 72,136 86,152 L94,146 L90,96 Z'),
  ['middle back', 'M90,96 L110,96 L108,138 L92,138 Z'],
  ['lower back', 'M90,140 L110,140 L112,166 L88,166 Z'],
  ...both('triceps', 'M54,94 C48,104 48,122 54,130 C62,130 66,118 64,98 Z'),
  ...both('forearms', 'M52,134 C44,146 44,166 50,176 C58,176 62,160 60,136 Z'),
  ...both('abductors', 'M76,164 C70,168 68,180 72,188 L80,184 L82,166 Z'),
  ...both('glutes', 'M99,168 L82,168 C72,182 74,198 84,204 C94,206 99,200 99,194 Z'),
  ...both('hamstrings', 'M82,208 C76,230 78,250 84,262 L94,262 C98,244 98,224 96,208 Z'),
  ...both('calves', 'M82,272 C74,288 76,312 84,330 L92,330 C94,312 94,290 90,272 Z'),
]
const SILHOUETTE = 'M100,12 C112,12 116,22 116,30 C116,40 110,46 108,48 L126,58 C140,60 146,74 146,90 L150,134 C156,150 156,176 148,184 L140,180 L136,140 L130,104 L126,166 L124,170 L120,260 L114,340 L118,356 L104,356 L104,340 L102,262 L100,190 L98,262 L96,340 L96,356 L82,356 L86,340 L80,260 L76,170 L74,166 L70,104 L64,140 L60,180 L52,184 C44,176 44,150 50,134 L54,90 C54,74 60,60 74,58 L92,48 C90,46 84,40 84,30 C84,22 88,12 100,12 Z'
</script>

<template>
  <div class="space-y-3">
    <p v-if="title" class="font-semibold">{{ title }}</p>
    <div class="grid grid-cols-2 gap-2">
      <figure v-for="(view, vi) in [FRONT, BACK]" :key="vi" class="text-center">
        <svg viewBox="40 6 120 356" class="mx-auto h-64 w-auto" role="group" :aria-label="vi === 0 ? 'Sylwetka z przodu' : 'Sylwetka z tyłu'">
          <path :d="SILHOUETTE" fill="none" stroke="var(--line-strong)" stroke-width="1.2" />
          <circle cx="100" cy="28" r="15" fill="var(--surface-2)" stroke="var(--line-strong)" stroke-width="1" />
          <path
            v-for="([m, d], i) in view"
            :key="i"
            :d="d"
            :fill="fill(m)"
            :stroke="selected === m ? 'var(--fg)' : 'var(--line-strong)'"
            :stroke-width="selected === m ? 2 : 0.8"
            class="cursor-pointer outline-none"
            role="button"
            tabindex="0"
            :aria-label="`${MUSCLES[m]}: ${fmt(load[m] ?? 0)} serii`"
            @click="pick(m)"
            @keydown.enter.prevent="pick(m)"
          >
            <title>{{ MUSCLES[m] }} – {{ fmt(load[m] ?? 0) }} serii</title>
          </path>
        </svg>
        <figcaption class="text-xs text-muted">{{ vi === 0 ? 'przód' : 'tył' }}</figcaption>
      </figure>
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span>Serie na partię:</span>
      <span class="flex items-center gap-1"><span class="size-3.5 rounded-sm border border-line-strong bg-surface-2" />0</span>
      <span v-for="l in LEVELS" :key="l.label" class="flex items-center gap-1">
        <span class="size-3.5 rounded-sm" :style="{ background: `color-mix(in oklab, var(--surface-2), var(--chart-1) ${l.pct}%)` }" />{{ l.label }}
      </span>
    </div>

    <div v-if="selected" class="rounded-xl bg-surface-2 p-3 text-sm" aria-live="polite">
      <p class="font-semibold">{{ MUSCLES[selected] }} · {{ fmt(load[selected] ?? 0) }} serii</p>
      <ul v-if="touching.length" class="mt-1 space-y-0.5">
        <li v-for="t in touching" :key="t.name">{{ t.name }} <span class="text-muted">– {{ t.sets }} {{ t.sets === 1 ? 'seria' : 'serie' }}, mięsień {{ t.role }}</span></li>
      </ul>
      <p v-else class="text-muted">Żadne ćwiczenie tego treningu nie angażuje tej partii.</p>
    </div>

    <ul class="space-y-1 text-sm">
      <li v-for="[m, v] in ranking" :key="m">
        <button type="button" class="flex w-full items-center gap-2 text-left" @click="pick(m)">
          <span class="w-36 shrink-0 truncate" :class="selected === m ? 'font-semibold' : ''">{{ MUSCLES[m] ?? m }}</span>
          <span class="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2"><span class="block h-full rounded-full bg-[var(--chart-1)]" :style="{ width: `${(v / max) * 100}%` }" /></span>
          <span class="w-10 text-right text-muted tabular-nums">{{ fmt(v) }}</span>
        </button>
      </li>
    </ul>
    <p class="text-xs text-muted">Mięsień główny ćwiczenia liczy się jako pełna seria, pomocniczy jako pół serii. Dotknij partii, żeby zobaczyć ćwiczenia.</p>
  </div>
</template>
