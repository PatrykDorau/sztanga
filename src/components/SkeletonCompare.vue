<script setup lang="ts">
// Uśrednione powtórzenie klienta (pomarańczowe) nałożone na wzorzec (szare) + tor punktu (biodra / dłonie / barki).
// Suwak fazy: środek = najniższy punkt u obu (fazy wyrównane do dna, a nie do czasu).
import { computed, ref, watch } from 'vue'
import { BONES, J } from '@/lib/pose/skeleton'
import { PHASES, tracePoint, type AvgRep, type P2 } from '@/lib/pose/analysis'
import type { Profile } from '@/lib/pose/profiles'

const props = defineProps<{ a: AvgRep; b?: AvgRep | null; profile: Profile; aLabel: string; bLabel?: string }>()

// 0..1, 0.5 = dno ruchu
const phase = ref(0.5)
watch(() => props.a, () => (phase.value = 0.5))

/** Faza suwaka → indeks klatki uśrednionego powtórzenia (wyrównanie do dna). */
function frameAt(r: AvgRep, p: number): P2[] {
  const bp = r.bottomPhase
  const own = p <= 0.5 ? (p / 0.5) * bp : bp + ((p - 0.5) / 0.5) * (1 - bp)
  const x = own * (PHASES - 1)
  const i = Math.min(PHASES - 2, Math.floor(x))
  const f = x - i
  return r.frames[i].map((q, k) => [q[0] + (r.frames[i + 1][k][0] - q[0]) * f, q[1] + (r.frames[i + 1][k][1] - q[1]) * f])
}

const box = computed(() => {
  const pts = [...props.a.frames, ...(props.b?.frames ?? [])].flat()
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const pad = 0.35
  const x0 = Math.min(...xs) - pad
  const y0 = Math.min(...ys) - pad
  const w = Math.max(...xs) + pad - x0
  const h = Math.max(...ys) + pad - y0
  return { x0, y0, w, h }
})
const sw = computed(() => box.value.h / 110) // grubość linii w jednostkach tułowia
// Ręce na sztandze (przysiad itp.) nie są mierzone – nie rysujemy ich.
const ARM = new Set<number>([J.lEl, J.rEl, J.lWr, J.rWr])
const bones = computed(() => (props.profile.arms === false ? BONES.filter(([i, k]) => !ARM.has(i) && !ARM.has(k)) : BONES))

const fa = computed(() => frameAt(props.a, phase.value))
const fb = computed(() => (props.b ? frameAt(props.b, phase.value) : null))
const path = (r: AvgRep) => r.frames.map((f, i) => `${i ? 'L' : 'M'}${tracePoint(f, props.profile.trace).join(' ')}`).join(' ')
const head = (f: P2[]) => f[J.nose]
const phaseLabel = computed(() => (Math.abs(phase.value - 0.5) < 0.02 ? 'najniższy punkt' : phase.value < 0.5 ? `faza ${props.profile.phases[0]}` : `faza ${props.profile.phases[1]}`))
</script>

<template>
  <figure class="card p-3">
    <svg :viewBox="`${box.x0} ${box.y0} ${box.w} ${box.h}`" class="mx-auto block max-h-80 w-full" role="img" :aria-label="`Sylwetka: ${aLabel}${bLabel ? ` na tle: ${bLabel}` : ''}, ${phaseLabel}`">
      <!-- podłoże / punkt stały -->
      <line :x1="box.x0" :x2="box.x0 + box.w" y1="0.06" y2="0.06" stroke="var(--chart-grid)" :stroke-width="sw" />
      <g v-if="b && fb" stroke="var(--ref-ink)" fill="var(--ref-ink)">
        <path :d="path(b)" fill="none" :stroke-width="sw" stroke-dasharray="0.04 0.04" opacity="0.8" />
        <line v-for="([i, k], n) in bones" :key="`b${n}`" :x1="fb[i][0]" :y1="fb[i][1]" :x2="fb[k][0]" :y2="fb[k][1]" :stroke-width="sw * 2.2" stroke-linecap="round" />
        <circle :cx="head(fb)[0]" :cy="head(fb)[1]" :r="0.12" stroke="none" />
      </g>
      <g stroke="var(--chart-1)" fill="var(--chart-1)">
        <path :d="path(a)" fill="none" :stroke-width="sw * 1.2" />
        <line v-for="([i, k], n) in bones" :key="`a${n}`" :x1="fa[i][0]" :y1="fa[i][1]" :x2="fa[k][0]" :y2="fa[k][1]" :stroke-width="sw * 2.2" stroke-linecap="round" />
        <circle :cx="head(fa)[0]" :cy="head(fa)[1]" :r="0.12" stroke="none" />
        <circle :cx="tracePoint(fa, profile.trace)[0]" :cy="tracePoint(fa, profile.trace)[1]" :r="0.07" fill="var(--surface)" :stroke-width="sw * 1.5" />
      </g>
    </svg>
    <div class="mt-2 flex items-center gap-3">
      <span class="w-28 shrink-0 text-xs text-muted">{{ phaseLabel }}</span>
      <input v-model.number="phase" type="range" min="0" max="1" step="0.01" class="w-full accent-primary" aria-label="Faza powtórzenia" />
    </div>
    <figcaption class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <span class="flex items-center gap-1.5"><span class="h-1 w-5 rounded-full bg-chart-1" aria-hidden="true" />{{ aLabel }}</span>
      <span v-if="b" class="flex items-center gap-1.5"><span class="h-1 w-5 rounded-full" style="background: var(--ref-ink)" aria-hidden="true" />{{ bLabel }}</span>
      <span>linia: {{ profile.traceLabel }}</span>
    </figcaption>
  </figure>
</template>
