<script setup lang="ts">
// Animowany ludzik – wzorzec ruchu rodziny (przysiad, wiosłowanie…) ze sprzętem dobranym do ćwiczenia.
// Ten sam wzorzec służy do rozpoznawania i porównywania nagrań w analizie ruchu.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { animTempo, FAMILIES, poseFor, variantOf, type FamilyKey, type Fig, type P } from '@/lib/pose/families'

const props = withDefaults(defineProps<{ family: FamilyKey; equipment?: string[]; small?: boolean; phase?: number | null; oneLeg?: boolean }>(), {
  equipment: () => [],
  small: false,
  phase: null,
  oneLeg: false,
})
const poseAt = (f: number) => poseFor(props.family, f, v.value, props.oneLeg)

const v = computed(() => variantOf(props.equipment))
const fam = computed(() => FAMILIES[props.family])
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
// Odtwarzanie w pętli: czas w cyklu (do punktu zwrotnego → pauza → powrót → pauza), pauza i przewijanie paskiem.
const tempo = computed(() => animTempo(props.family))
const total = computed(() => tempo.value.reduce((a, b) => a + b, 0))
const paused = ref(reduced)
const t = ref(reduced ? tempo.value[0] : 0) // sekundy w cyklu
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)
const ph = computed(() => {
  const [a, b, c] = tempo.value
  let x = t.value
  if (x < a) return ease(x / a)
  if ((x -= a) < b) return 1
  if ((x -= b) < c) return 1 - ease(x / c)
  return 0
})
const PHASE_NAMES = computed(() => (FAMILIES[props.family].effortTo1 ? ['ruch (wysiłek)', 'pauza', 'powrót', 'pauza'] : ['w dół', 'pauza', 'w górę', 'pauza']))
const phaseName = computed(() => {
  let x = t.value
  for (let i = 0; i < 4; i++) {
    if (x < tempo.value[i]) return PHASE_NAMES.value[i]
    x -= tempo.value[i]
  }
  return PHASE_NAMES.value[3]
})

let raf = 0
let last = 0
let dragging = false
function loop(now: number) {
  const dt = last ? (now - last) / 1000 : 0
  last = now
  if (!paused.value && !dragging && props.phase == null) t.value = (t.value + dt) % total.value
  raf = requestAnimationFrame(loop)
}
onMounted(() => (raf = requestAnimationFrame(loop)))
onBeforeUnmount(() => cancelAnimationFrame(raf))
watch(
  () => props.family,
  () => (t.value = 0),
)
function scrub(e: Event) {
  dragging = true
  t.value = Number((e.target as HTMLInputElement).value)
}
const scrubEnd = () => (dragging = false)
// Znaczniki faz na pasku (punkt zwrotny i powrót)
const marks = computed(() => {
  const [a, b, c] = tempo.value
  return [a, a + b, a + b + c].map((x) => (x / total.value) * 100)
})

const fig = computed<Fig>(() => poseAt(props.phase ?? ph.value))
const fmtS = (x: number) => x.toFixed(1).replace('.', ',')
const extra = computed(() => fam.value.props?.(v.value) ?? {})

// Kadr: wszystkie pozycje ruchu + rekwizyty, żeby ludzik nie skakał.
const box = computed(() => {
  const pts: P[] = []
  for (const f of [0, 0.5, 1]) {
    const g = poseAt(f)
    for (const val of Object.values(g)) if (Array.isArray(val)) pts.push(val as P)
  }
  const e = extra.value
  if (e.bench) pts.push([e.bench[0], 0], [e.bench[1], e.bench[2]])
  if (e.seat) pts.push([e.seat[0], 0], [e.seat[1], e.seat[2]])
  if (e.bar) pts.push([e.bar[0], e.bar[2]], [e.bar[1], e.bar[2]])
  if (e.pulley) pts.push(e.pulley)
  if (e.pulley2) pts.push(e.pulley2)
  if (e.lever) pts.push(e.lever)
  pts.push([0, 0])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const pad = 0.22
  const x0 = Math.min(...xs) - pad
  const x1 = Math.max(...xs) + pad
  const y0 = Math.min(0, ...ys) - 0.08
  const y1 = Math.max(...ys) + pad
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 }
})
const viewBox = computed(() => `${box.value.x0} ${-box.value.y1} ${box.value.w} ${box.value.h}`)
const pt = (p: P) => `${p[0]},${-p[1]}`
const line = (...ps: (P | undefined)[]) => ps.filter(Boolean).map((p) => pt(p!)).join(' ')

const W = 0.065 // grubość kończyn [m]
const main = computed(() => {
  const f = fig.value
  return [line(f.ankle, f.knee, f.hip), line(f.toe, f.heel, f.ankle, f.toe), line(f.hip, f.shoulder), line(f.shoulder, f.elbow, f.wrist)]
})
const far = computed(() => {
  const f = fig.value
  const out: string[] = []
  if (f.knee2 && f.ankle2) out.push(line(f.hip2 ?? f.hip, f.knee2, f.ankle2), line(f.toe2, f.heel2, f.ankle2, f.toe2))
  if (f.elbow2 && f.wrist2) out.push(line(f.shoulder2 ?? f.shoulder, f.elbow2, f.wrist2))
  if (f.hip2 && f.shoulder2) out.push(line(f.hip, f.hip2), line(f.shoulder, f.shoulder2), line(f.hip2, f.shoulder2))
  return out
})
const front = computed(() => fig.value.view === 'front')
const wrists = computed(() => [fig.value.wrist, ...(fig.value.wrist2 ? [fig.value.wrist2] : [])])
</script>

<template>
  <div class="overflow-hidden rounded-2xl bg-surface-2">
  <button
    type="button"
    class="relative block w-full"
    :aria-label="paused ? 'Wznów animację ruchu' : 'Zatrzymaj animację ruchu'"
    @click="paused = !paused"
  >
    <svg :viewBox="viewBox" class="mx-auto w-full" :class="small ? 'h-36' : 'h-64'" role="img" :aria-label="`Wzorzec ruchu: ${fam.name}`" stroke-linecap="round" stroke-linejoin="round">
      <!-- podłoga -->
      <line :x1="box.x0" :x2="box.x1" y1="0" y2="0" stroke="var(--line-strong)" :stroke-width="0.02" />
      <!-- rekwizyty -->
      <rect v-if="extra.bench" :x="extra.bench[0]" :y="-extra.bench[2]" :width="extra.bench[1] - extra.bench[0]" height="0.07" rx="0.03" fill="var(--line-strong)" />
      <line v-if="extra.bench" :x1="(extra.bench[0] + extra.bench[1]) / 2" :x2="(extra.bench[0] + extra.bench[1]) / 2" :y1="-extra.bench[2]" y2="0" stroke="var(--line-strong)" stroke-width="0.05" />
      <rect v-if="extra.seat" :x="extra.seat[0]" :y="-extra.seat[2]" :width="extra.seat[1] - extra.seat[0]" height="0.07" rx="0.03" fill="var(--line-strong)" />
      <line v-if="extra.seat" :x1="(extra.seat[0] + extra.seat[1]) / 2" :x2="(extra.seat[0] + extra.seat[1]) / 2" :y1="-extra.seat[2]" y2="0" stroke="var(--line-strong)" stroke-width="0.05" />
      <line v-if="extra.bar" :x1="extra.bar[0]" :x2="extra.bar[1]" :y1="-extra.bar[2]" :y2="-extra.bar[2]" stroke="var(--muted)" stroke-width="0.04" />
      <line v-if="extra.pulley" :x1="extra.pulley[0]" :y1="-extra.pulley[1]" :x2="fig.wrist[0]" :y2="-fig.wrist[1]" stroke="var(--muted)" stroke-width="0.015" />
      <line v-if="extra.pulley2 && fig.wrist2" :x1="extra.pulley2[0]" :y1="-extra.pulley2[1]" :x2="fig.wrist2[0]" :y2="-fig.wrist2[1]" stroke="var(--muted)" stroke-width="0.015" />
      <circle v-if="extra.pulley" :cx="extra.pulley[0]" :cy="-extra.pulley[1]" r="0.04" fill="var(--muted)" />
      <circle v-if="extra.pulley2" :cx="extra.pulley2[0]" :cy="-extra.pulley2[1]" r="0.04" fill="var(--muted)" />
      <!-- landmine: sztanga oparta końcem o podłogę, drugi koniec w dłoni -->
      <template v-if="extra.lever">
        <line :x1="extra.lever[0]" :y1="-extra.lever[1]" :x2="fig.wrist[0]" :y2="-fig.wrist[1]" stroke="var(--primary)" stroke-width="0.04" />
        <circle :cx="extra.lever[0]" :cy="-extra.lever[1]" r="0.05" fill="var(--muted)" />
      </template>
      <line v-if="v === 'band'" :x1="fig.wrist[0]" :y1="-fig.wrist[1]" :x2="fig.toe[0]" :y2="-fig.toe[1]" stroke="var(--success)" stroke-width="0.02" stroke-dasharray="0.04 0.03" />

      <!-- dalsza strona -->
      <polyline v-for="(d, i) in far" :key="'f' + i" :points="d" fill="none" stroke="var(--fg)" :stroke-opacity="front ? 1 : 0.35" :stroke-width="W" />
      <!-- bliższa strona -->
      <polyline v-for="(d, i) in main" :key="'m' + i" :points="d" fill="none" stroke="var(--fg)" :stroke-width="i === 2 ? W * 1.4 : W" />
      <circle :cx="fig.head[0]" :cy="-fig.head[1]" r="0.11" fill="var(--surface-2)" stroke="var(--fg)" :stroke-width="W * 0.8" />

      <!-- sprzęt w dłoniach -->
      <template v-if="v === 'barbell'">
        <line v-if="front && fig.wrist2" :x1="fig.wrist2[0] - 0.25" :x2="fig.wrist[0] + 0.25" :y1="-fig.wrist[1]" :y2="-fig.wrist2[1]" stroke="var(--primary)" stroke-width="0.04" />
        <circle v-else :cx="fig.wrist[0]" :cy="-fig.wrist[1]" r="0.2" fill="none" stroke="var(--primary)" stroke-width="0.05" />
      </template>
      <template v-else-if="v === 'dumbbell'">
        <rect v-for="(w, i) in wrists" :key="'d' + i" :x="w[0] - 0.09" :y="-w[1] - 0.04" width="0.18" height="0.08" rx="0.03" fill="var(--primary)" />
      </template>
      <template v-else-if="v === 'kettlebell'">
        <circle v-for="(w, i) in wrists" :key="'k' + i" :cx="w[0]" :cy="-w[1] + 0.09" r="0.075" fill="var(--primary)" />
      </template>
      <circle v-for="(w, i) in wrists" :key="'h' + i" :cx="w[0]" :cy="-w[1]" r="0.035" fill="var(--fg)" />
    </svg>
    <span class="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{{ phaseName }}</span>
  </button>
  <!-- Sterowanie: pauza / odtwarzanie i pasek postępu cyklu (przeciągnij, żeby obejrzeć dowolny moment ruchu) -->
  <div v-if="phase == null" class="flex items-center gap-2 px-2 pb-2">
    <button type="button" class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary" :aria-label="paused ? 'Odtwórz animację' : 'Pauza'" @click="paused = !paused">
      <svg v-if="paused" viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
      <svg v-else viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
    </button>
    <div class="relative h-9 flex-1">
      <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line-strong" />
      <div class="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-primary" :style="{ width: `${(t / total) * 100}%` }" />
      <span v-for="(m, i) in marks" :key="i" class="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-muted" :style="{ left: `${m}%` }" />
      <span class="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-surface" :style="{ left: `${(t / total) * 100}%` }" />
      <input
        type="range"
        class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        :min="0"
        :max="total"
        step="0.01"
        :value="t"
        aria-label="Moment ruchu"
        :aria-valuetext="`${fmtS(t)} z ${fmtS(total)} s – ${phaseName}`"
        @input="scrub"
        @change="scrubEnd"
        @pointerup="scrubEnd"
      />
    </div>
    <span class="w-14 shrink-0 text-right text-xs text-muted tabular-nums">{{ fmtS(t) }} / {{ fmtS(total) }} s</span>
  </div>
  </div>
</template>
