<script setup lang="ts">
// Tempo i prędkość powtórzeń: czasy faz (w dół / pauza / w górę), średnia i szczytowa prędkość w górę, zakres ruchu,
// spadek prędkości w serii, a z podanym ciężarem – moc i (z kilku nagrań) szacowane 1RM z profilu obciążenie–prędkość.
import { computed } from 'vue'
import type { ExerciseKey } from '@/lib/pose/profiles'
import { loadVelocity, MVT, power, velocityLoss, zone } from '@/lib/pose/velocity'

const props = defineProps<{
  exercise: ExerciseKey
  reps: { metrics: Record<string, number | null> }[]
  loadKg: number | null
  phases: [string, string]
  history?: { load: number; v: number }[] // inne nagrania tej osoby: ciężar i najlepsza prędkość
}>()
const emit = defineEmits<{ 'update:loadKg': [v: number | null] }>()

const m = (r: { metrics: Record<string, number | null> }, k: string) => r.metrics[k] ?? null
const avg = (k: string) => {
  const v = props.reps.map((r) => m(r, k)).filter((x): x is number => x != null)
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
}
const rows = computed(() => props.reps.map((r) => ({ ecc: m(r, 'ecc'), pause: m(r, 'pause'), con: m(r, 'con'), mcv: m(r, 'mcv'), pv: m(r, 'pv'), rom: m(r, 'rom') })))
const meanV = computed(() => avg('mcv'))
const bestV = computed(() => Math.max(0, ...rows.value.map((r) => r.mcv ?? 0)) || null)
const loss = computed(() => velocityLoss(rows.value))
const hasV = computed(() => rows.value.some((r) => r.mcv != null))
const lv = computed(() => {
  if (!props.loadKg || !bestV.value) return loadVelocity(props.history ?? [], props.exercise)
  return loadVelocity([...(props.history ?? []), { load: props.loadKg, v: bestV.value }], props.exercise)
})

const f1 = (v: number | null) => (v == null ? '–' : v.toFixed(1).replace('.', ','))
const f2 = (v: number | null) => (v == null ? '–' : v.toFixed(2).replace('.', ','))
function onLoad(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(',', '.').trim()
  const v = raw === '' ? null : Number(raw)
  emit('update:loadKg', v != null && Number.isFinite(v) && v >= 0 ? v : null)
}
</script>

<template>
  <section class="space-y-3">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <h2 class="text-xl font-bold">Tempo i prędkość</h2>
      <label class="flex items-center gap-2 text-sm">
        Ciężar
        <input :value="loadKg ?? ''" inputmode="decimal" class="input !min-h-10 w-20 text-center" placeholder="kg" aria-label="Ciężar w kg" @change="onLoad" />
        kg
      </label>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="card p-3">
        <p class="text-xs text-muted">Tempo (średnio)</p>
        <p class="font-display text-2xl font-bold tabular-nums">{{ f1(avg('ecc')) }}–{{ f1(avg('pause')) }}–{{ f1(avg('con')) }}</p>
        <p class="text-[11px] text-muted">s: w dół – pauza – w górę</p>
      </div>
      <div class="card p-3">
        <p class="text-xs text-muted">Prędkość w górę</p>
        <p class="font-display text-2xl font-bold tabular-nums">{{ f2(meanV) }} <span class="text-sm font-normal">m/s</span></p>
        <p class="text-[11px] text-muted">{{ meanV ? zone(meanV) : 'brak pomiaru' }}</p>
      </div>
      <div class="card p-3">
        <p class="text-xs text-muted">Spadek prędkości</p>
        <p class="font-display text-2xl font-bold tabular-nums" :class="loss != null && loss >= 25 ? 'text-danger' : ''">{{ loss == null ? '–' : `${loss}%` }}</p>
        <p class="text-[11px] text-muted">{{ loss == null ? 'min. 3 powtórzenia' : loss >= 25 ? 'duże zmęczenie w serii' : loss >= 15 ? 'umiarkowane zmęczenie' : 'seria daleko od upadku' }}</p>
      </div>
      <div class="card p-3">
        <p class="text-xs text-muted">Moc (średnio)</p>
        <p class="font-display text-2xl font-bold tabular-nums">{{ loadKg && meanV ? power(loadKg, meanV) : '–' }} <span class="text-sm font-normal">W</span></p>
        <p class="text-[11px] text-muted">{{ loadKg ? 'ciężar × g × prędkość' : 'wpisz ciężar' }}</p>
      </div>
    </div>

    <div class="-mx-4 overflow-x-auto px-4">
      <table class="w-full min-w-[34rem] text-sm tabular-nums">
        <thead>
          <tr class="border-b border-line text-right text-xs text-muted">
            <th class="py-2 text-left font-semibold">Powt.</th>
            <th class="py-2 font-semibold">{{ phases[0] }}</th>
            <th class="py-2 font-semibold">pauza</th>
            <th class="py-2 font-semibold">{{ phases[1] }}</th>
            <th class="py-2 font-semibold">prędkość</th>
            <th class="py-2 font-semibold">szczyt</th>
            <th class="py-2 font-semibold">zakres</th>
            <th v-if="loadKg" class="py-2 font-semibold">moc szczyt.</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i" class="border-b border-line text-right last:border-0">
            <td class="py-2 text-left font-semibold">{{ i + 1 }}</td>
            <td class="py-2">{{ f1(r.ecc) }} s</td>
            <td class="py-2">{{ f1(r.pause) }} s</td>
            <td class="py-2">{{ f1(r.con) }} s</td>
            <td class="py-2">{{ f2(r.mcv) }} m/s</td>
            <td class="py-2">{{ f2(r.pv) }} m/s</td>
            <td class="py-2">{{ r.rom ?? '–' }} cm</td>
            <td v-if="loadKg" class="py-2">{{ power(loadKg, r.pv) ?? '–' }} W</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="MVT[exercise]" class="card space-y-1 p-4 text-sm">
      <p class="font-semibold">Szacowane 1RM z prędkości</p>
      <p v-if="lv">
        <span class="font-display text-2xl font-bold tabular-nums">≈ {{ String(lv.e1rm).replace('.', ',') }} kg</span>
        <span class="text-muted"> · z {{ lv.n }} nagrań{{ lv.reliable ? '' : ' – orientacyjnie, nagraj jeszcze 1–2 ciężary (różnica ≥ 20%)' }}</span>
      </p>
      <p v-else class="text-muted">Potrzeba nagrań tej osoby z co najmniej 2 różnymi ciężarami (najlepiej 3–4, np. 50–85% 1RM), każde z wpisanym ciężarem.</p>
      <p class="text-xs text-muted">Profil obciążenie–prędkość: przy jakim ciężarze najszybsze powtórzenie spadłoby do {{ String(MVT[exercise]).replace('.', ',') }} m/s (prędkość przy 1RM).</p>
    </div>

    <p class="text-xs text-muted">
      Prędkość liczona z ruchu {{ exercise === 'squat' ? 'bioder' : exercise === 'pushup' ? 'barków' : 'dłoni (sztangi)' }} w fazie w górę; skala z modelu sylwetki, więc liczby bezwzględne mają ok. ±10–20% błędu –
      najbardziej wiarygodne jest porównanie tej samej osoby nagrywanej tak samo. Moc dotyczy samego ciężaru (bez masy ciała).
      <template v-if="!hasV"> W tym nagraniu ruch był za mały albo niewidoczny, żeby policzyć prędkość.</template>
    </p>
  </section>
</template>
