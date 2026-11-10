<script setup lang="ts">
// Wykres liniowy jednej serii (skill dataviz): linia 2 px, kropki r=4 z pierścieniem 2 px w kolorze powierzchni,
// delikatne siatki, etykieta tylko przy ostatnim punkcie i rekordzie, krzyżyk + tooltip na hover/dotyk,
// przełącznik na tabelę (dostępność). Jedna seria → bez legendy, tytuł mówi, co pokazujemy.
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{ points: { x: string; y: number }[]; unit: string; title: string; height?: number; higherIsBetter?: boolean }>(),
  { height: 180, higherIsBetter: true },
)

const W = 340
const PAD = { l: 36, r: 44, t: 14, b: 24 }
const showTable = ref(false)
const hover = ref<number | null>(null)

const sorted = computed(() => [...props.points].sort((a, b) => a.x.localeCompare(b.x)))
const xs = computed(() => sorted.value.map((p) => new Date(p.x).getTime()))
const ys = computed(() => sorted.value.map((p) => p.y))

function niceTicks(min: number, max: number, n = 4) {
  if (min === max) {
    min -= 1
    max += 1
  }
  const raw = (max - min) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const t: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v * 100) / 100)
  return t
}
const ticks = computed(() => niceTicks(Math.min(...ys.value), Math.max(...ys.value)))
const yMin = computed(() => ticks.value[0])
const yMax = computed(() => ticks.value.at(-1)!)
const xMin = computed(() => Math.min(...xs.value))
const xMax = computed(() => Math.max(...xs.value))

const px = (t: number) => PAD.l + (xMax.value === xMin.value ? (W - PAD.l - PAD.r) / 2 : ((t - xMin.value) / (xMax.value - xMin.value)) * (W - PAD.l - PAD.r))
const py = (v: number) => PAD.t + (1 - (v - yMin.value) / (yMax.value - yMin.value || 1)) * (props.height - PAD.t - PAD.b)
const pts = computed(() => sorted.value.map((p, i) => ({ x: px(xs.value[i]), y: py(p.y), p })))
const path = computed(() => pts.value.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(''))
const area = computed(() =>
  pts.value.length > 1 ? `${path.value}L${pts.value.at(-1)!.x},${props.height - PAD.b}L${pts.value[0].x},${props.height - PAD.b}Z` : '',
)
const bestIdx = computed(() => {
  const v = ys.value
  const best = props.higherIsBetter ? Math.max(...v) : Math.min(...v)
  return v.lastIndexOf(best)
})
const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',')
const fmtDate = (s: string) => new Date(s).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })

function onMove(ev: PointerEvent) {
  const svg = ev.currentTarget as SVGSVGElement
  const r = svg.getBoundingClientRect()
  const x = ((ev.clientX - r.left) / r.width) * W
  let best = 0
  pts.value.forEach((q, i) => Math.abs(q.x - x) < Math.abs(pts.value[best].x - x) && (best = i))
  hover.value = best
}
</script>

<template>
  <figure class="card p-4">
    <figcaption class="mb-2 flex items-baseline justify-between gap-2">
      <span class="font-semibold">{{ title }}</span>
      <button class="text-xs font-semibold text-primary-fg underline-offset-4 hover:underline" @click="showTable = !showTable">
        {{ showTable ? 'Wykres' : 'Tabela' }}
      </button>
    </figcaption>

    <p v-if="points.length < 2 && !showTable" class="py-6 text-center text-sm text-muted">
      {{ points.length ? `Jeden pomiar: ${fmt(points[0].y)} ${unit} – wykres pojawi się po kolejnym.` : 'Brak danych.' }}
    </p>

    <div v-else-if="!showTable" class="relative">
      <svg
        :viewBox="`0 0 ${W} ${height}`"
        class="w-full touch-pan-y select-none"
        role="img"
        :aria-label="`${title}: od ${fmt(ys[0])} do ${fmt(ys.at(-1)!)} ${unit}`"
        @pointermove="onMove"
        @pointerdown="onMove"
        @pointerleave="hover = null"
      >
        <g aria-hidden="true">
          <line v-for="t in ticks" :key="t" :x1="PAD.l" :x2="W - PAD.r" :y1="py(t)" :y2="py(t)" class="stroke-chart-grid" stroke-width="1" />
          <text v-for="t in ticks" :key="'l' + t" :x="PAD.l - 6" :y="py(t) + 4" text-anchor="end" class="fill-muted text-[10px]">{{ fmt(t) }}</text>
          <text :x="PAD.l" :y="height - 6" class="fill-muted text-[10px]">{{ fmtDate(sorted[0].x) }}</text>
          <text :x="W - PAD.r" :y="height - 6" text-anchor="end" class="fill-muted text-[10px]">{{ fmtDate(sorted.at(-1)!.x) }}</text>

          <path :d="area" class="fill-chart-1" fill-opacity="0.1" />
          <path :d="path" fill="none" class="stroke-chart-1" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <circle v-for="(q, i) in pts" :key="i" :cx="q.x" :cy="q.y" r="4" class="fill-chart-1 stroke-surface" stroke-width="2" />

          <!-- Etykiety selektywnie: ostatni punkt i rekord (jeśli inny) -->
          <text :x="pts.at(-1)!.x + 7" :y="pts.at(-1)!.y + 4" class="fill-fg text-[11px] font-semibold">{{ fmt(ys.at(-1)!) }}</text>
          <text v-if="bestIdx !== pts.length - 1" :x="pts[bestIdx].x" :y="pts[bestIdx].y - 9" text-anchor="middle" class="fill-muted text-[10px]">
            rekord {{ fmt(ys[bestIdx]) }}
          </text>

          <g v-if="hover !== null">
            <line :x1="pts[hover].x" :x2="pts[hover].x" :y1="PAD.t" :y2="height - PAD.b" class="stroke-muted" stroke-width="1" />
            <circle :cx="pts[hover].x" :cy="pts[hover].y" r="6" class="fill-chart-1 stroke-surface" stroke-width="2" />
          </g>
        </g>
      </svg>
      <div
        v-if="hover !== null"
        class="pointer-events-none absolute top-0 rounded-lg bg-fg px-2 py-1 text-xs whitespace-nowrap text-bg shadow"
        :style="{ left: `${(pts[hover].x / W) * 100}%`, transform: `translateX(${pts[hover].x > W / 2 ? '-105%' : '5%'})` }"
      >
        <strong class="tabular-nums">{{ fmt(ys[hover]) }} {{ unit }}</strong> · {{ fmtDate(sorted[hover].x) }}
      </div>
    </div>

    <table v-else class="w-full text-sm">
      <thead>
        <tr class="text-left text-xs text-muted"><th class="py-1 font-semibold">Data</th><th class="py-1 text-right font-semibold">Wartość</th></tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in [...sorted].reverse()" :key="i" class="border-t border-line">
          <td class="py-1.5">{{ new Date(p.x).toLocaleDateString('pl-PL') }}</td>
          <td class="py-1.5 text-right tabular-nums">{{ fmt(p.y) }} {{ unit }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>
