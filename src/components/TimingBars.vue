<script setup lang="ts">
// Tempo powtórzenia: faza w dół / pauza / w górę – klient vs wzorzec, na wspólnej osi czasu.
import { computed } from 'vue'

interface Phases {
  ecc: number
  pause: number
  con: number
}
const props = defineProps<{ a: Phases; b?: Phases | null; aLabel: string; bLabel?: string; phaseNames: [string, string] }>()

const total = (p: Phases) => p.ecc + p.pause + p.con
const max = computed(() => Math.max(total(props.a), props.b ? total(props.b) : 0, 0.1))
const s = (v: number) => `${v.toFixed(1).replace('.', ',')} s`
const rows = computed(() => [
  { label: props.aLabel, p: props.a, main: true },
  ...(props.b ? [{ label: props.bLabel ?? 'Wzorzec', p: props.b, main: false }] : []),
])
const verdict = computed(() => {
  if (!props.b) return null
  const d = props.a.ecc - props.b.ecc
  if (Math.abs(d) < 0.15) return `Faza ${props.phaseNames[0]} w tempie wzorca.`
  return `Faza ${props.phaseNames[0]} ${d > 0 ? 'dłuższa' : 'krótsza'} od wzorca o ${s(Math.abs(d))}.`
})
</script>

<template>
  <figure class="card space-y-3 p-4">
    <div v-for="r in rows" :key="r.label">
      <p class="mb-1 flex justify-between text-sm">
        <span class="font-semibold">{{ r.label }}</span>
        <span class="font-display font-bold tabular-nums">{{ s(total(r.p)) }}</span>
      </p>
      <div class="flex h-3 gap-[2px]" :style="{ width: `${(total(r.p) / max) * 100}%` }" aria-hidden="true">
        <span class="h-full rounded-l-full" :style="{ flex: r.p.ecc, background: r.main ? 'var(--chart-1)' : 'var(--ref-ink)' }" />
        <span v-if="r.p.pause > 0.05" class="h-full" :style="{ flex: r.p.pause, background: r.main ? 'var(--chart-1)' : 'var(--ref-ink)', opacity: 0.45 }" />
        <span class="h-full rounded-r-full" :style="{ flex: r.p.con, background: r.main ? 'var(--chart-1)' : 'var(--ref-ink)', opacity: 0.75 }" />
      </div>
      <p class="mt-1 text-xs text-muted tabular-nums">w dół {{ s(r.p.ecc) }} · pauza {{ s(r.p.pause) }} · w górę {{ s(r.p.con) }}</p>
    </div>
    <figcaption v-if="verdict" class="border-t border-line pt-2 text-sm">{{ verdict }}</figcaption>
  </figure>
</template>
