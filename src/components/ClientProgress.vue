<script setup lang="ts">
// Postępy klienta: kafelki statystyk (ten miesiąc vs poprzedni), wykres progresu ćwiczenia, rekordy,
// serie na partię w ostatnich 7 dniach, pomiary i testy.
import { computed, reactive, ref, watch } from 'vue'
import { useExercisesStore } from '@/stores/exercises'
import { useProgressStore } from '@/stores/progress'
import { avgRpe, inRange, seriesByExercise, setsPerMuscle, totalVolume } from '@/lib/analytics'
import { MEASUREMENTS, MUSCLES, label } from '@/lib/vocab'
import { fmtKg } from '@/lib/strength'
import LineChart from './LineChart.vue'
import Icon from './Icon.vue'

const props = defineProps<{ clientId: string }>()
const progress = useProgressStore()
const ex = useExercisesStore()

const logs = computed(() => progress.logs[props.clientId] ?? [])
const measurements = computed(() => progress.measurements[props.clientId] ?? [])

const now = new Date()
const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
const cur = computed(() => inRange(logs.value, thisMonth, nextMonth))
const prev = computed(() => inRange(logs.value, prevMonth, thisMonth))
const delta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null)

const series = computed(() => seriesByExercise(logs.value))
const exId = ref<string | null>(null)
watch(series, (s) => (exId.value ??= s[0]?.exercise_id ?? null), { immediate: true })
const metric = ref<'e1rm' | 'maxLoad' | 'volume'>('e1rm')
const selected = computed(() => series.value.find((s) => s.exercise_id === exId.value))
const chartPoints = computed(() =>
  (selected.value?.points ?? []).filter((p) => (metric.value === 'e1rm' ? p.e1rm : p[metric.value])).map((p) => ({ x: p.x, y: Number(metric.value === 'e1rm' ? p.e1rm : p[metric.value]) })),
)
const METRIC_LABEL = { e1rm: 'Szacowane 1RM', maxLoad: 'Maks. ciężar', volume: 'Objętość (serie × powt. × kg)' }

const records = computed(() => series.value.filter((s) => s.best).map((s) => ({ ...s.best!, id: s.exercise_id })).sort((a, b) => b.date.localeCompare(a.date)))
const recent = (d: string) => Date.now() - new Date(d).getTime() < 14 * 864e5

const week = computed(() => inRange(logs.value, new Date(Date.now() - 7 * 864e5), new Date(Date.now() + 864e5)))
const perMuscle = computed(() => setsPerMuscle(week.value, (id) => ex.byId(id)?.muscle_groups ?? []))
const maxMuscle = computed(() => Math.max(1, ...perMuscle.value.map((m) => m[1])))

// ===== Pomiary =====
const kinds = computed(() => [...new Set(measurements.value.map((m) => m.kind))])
const mKind = ref<string | null>(null)
watch(kinds, (k) => (mKind.value ??= k[0] ?? null), { immediate: true })
const mPoints = computed(() => measurements.value.filter((m) => m.kind === mKind.value).map((m) => ({ x: m.measured_on, y: Number(m.value) })))
const adding = ref(false)
const mf = reactive({ kind: 'weight', value: '', day: new Date().toISOString().slice(0, 10) })
const busy = ref(false)
const error = ref('')
async function addMeasurement() {
  busy.value = true
  error.value = ''
  try {
    await progress.addMeasurement({
      client_id: props.clientId,
      kind: mf.kind,
      value: Number(mf.value.replace(',', '.')),
      unit: MEASUREMENTS[mf.kind].unit,
      measured_on: mf.day,
      notes: null,
    })
    mKind.value = mf.kind
    mf.value = ''
    adding.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
const lowerIsBetter = (k: string | null) => k === 'waist' || k === 'hips'
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-2 gap-2">
      <div class="card p-3">
        <p class="eyebrow">Sesje w miesiącu</p>
        <p class="font-display text-3xl font-bold tabular-nums">{{ cur.length }}</p>
        <p class="text-xs text-muted">poprzedni: {{ prev.length }}</p>
      </div>
      <div class="card p-3">
        <p class="eyebrow">Objętość w miesiącu</p>
        <p class="font-display text-3xl font-bold tabular-nums">{{ (totalVolume(cur) / 1000).toFixed(1).replace('.', ',') }} t</p>
        <p class="text-xs text-muted">
          <template v-if="delta(totalVolume(cur), totalVolume(prev)) !== null">
            {{ delta(totalVolume(cur), totalVolume(prev))! >= 0 ? '+' : '' }}{{ delta(totalVolume(cur), totalVolume(prev)) }}% vs poprzedni
          </template>
          <template v-else>brak porównania</template>
        </p>
      </div>
      <div class="card p-3">
        <p class="eyebrow">Średnie RPE</p>
        <p class="font-display text-3xl font-bold tabular-nums">{{ avgRpe(cur)?.toString().replace('.', ',') ?? '—' }}</p>
        <p class="text-xs text-muted">ten miesiąc</p>
      </div>
      <div class="card p-3">
        <p class="eyebrow">Ostatni trening</p>
        <p class="font-display text-3xl font-bold tabular-nums">{{ logs[0] ? Math.floor((Date.now() - new Date(logs[0].started_at).getTime()) / 864e5) : '—' }}</p>
        <p class="text-xs text-muted">{{ logs[0] ? 'dni temu' : 'brak sesji' }}</p>
      </div>
    </div>

    <section v-if="series.length" class="space-y-2">
      <h3 class="text-lg font-bold">Progres ćwiczenia</h3>
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <button v-for="s in series" :key="s.exercise_id" :class="exId === s.exercise_id ? 'chip-on' : 'chip-off'" class="shrink-0" @click="exId = s.exercise_id">
          {{ ex.byId(s.exercise_id)?.name_pl ?? '…' }}
        </button>
      </div>
      <div class="flex gap-2">
        <button v-for="k in (Object.keys(METRIC_LABEL) as (keyof typeof METRIC_LABEL)[])" :key="k" class="chip !min-h-9 text-sm" :class="metric === k ? 'border-primary bg-primary-soft font-semibold' : 'border-line bg-surface text-muted'" @click="metric = k">
          {{ k === 'e1rm' ? '1RM' : k === 'maxLoad' ? 'Maks.' : 'Objętość' }}
        </button>
      </div>
      <LineChart :points="chartPoints" :unit="metric === 'volume' ? 'kg' : 'kg'" :title="`${METRIC_LABEL[metric]} – ${ex.byId(exId ?? '')?.name_pl ?? ''}`" />
    </section>
    <p v-else class="card p-4 text-sm text-muted">Postępy pojawią się po pierwszej sesji zapisanej w trybie „sesja na żywo”.</p>

    <section v-if="records.length">
      <h3 class="mb-2 text-lg font-bold">Rekordy</h3>
      <ul class="card divide-y divide-line">
        <li v-for="r in records.slice(0, 8)" :key="r.id" class="flex items-center gap-3 p-3">
          <Icon name="trophy" class="size-5 shrink-0" :class="recent(r.date) ? 'text-primary-fg' : 'text-subtle'" />
          <span class="min-w-0 flex-1 truncate">{{ ex.byId(r.id)?.name_pl }}</span>
          <span class="font-semibold tabular-nums">{{ fmtKg(r.load) }}</span>
          <span class="w-20 text-right text-xs text-muted">{{ recent(r.date) ? 'nowy! ' : '' }}{{ new Date(r.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) }}</span>
        </li>
      </ul>
    </section>

    <section v-if="perMuscle.length">
      <h3 class="mb-2 text-lg font-bold">Serie na partię – ostatnie 7 dni</h3>
      <ul class="card space-y-2 p-4">
        <li v-for="[m, n] in perMuscle" :key="m" class="grid grid-cols-[8rem_1fr_2rem] items-center gap-2 text-sm">
          <span class="truncate">{{ label(MUSCLES, m) }}</span>
          <span class="h-3 rounded-r bg-chart-1" :style="{ width: `${(n / maxMuscle) * 100}%` }" aria-hidden="true" />
          <span class="text-right font-semibold tabular-nums">{{ n }}</span>
        </li>
      </ul>
    </section>

    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold">Pomiary i testy</h3>
        <button class="btn-ghost !min-h-10 text-sm" @click="adding = !adding"><Icon name="plus" class="size-4" />Pomiar</button>
      </div>
      <form v-if="adding" class="card grid grid-cols-2 gap-3 p-4" @submit.prevent="addMeasurement">
        <label class="col-span-2"><span class="label">Rodzaj</span>
          <select v-model="mf.kind" class="input"><option v-for="(m, k) in MEASUREMENTS" :key="k" :value="k">{{ m.label }} ({{ m.unit }})</option></select>
        </label>
        <label><span class="label">Wartość</span><input v-model="mf.value" inputmode="decimal" class="input" required /></label>
        <label><span class="label">Data</span><input v-model="mf.day" type="date" class="input" required /></label>
        <p v-if="error" class="col-span-2 text-sm text-danger" role="alert">{{ error }}</p>
        <button class="btn-primary col-span-2" :disabled="busy">Zapisz pomiar</button>
      </form>
      <div v-if="kinds.length" class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <button v-for="k in kinds" :key="k" :class="mKind === k ? 'chip-on' : 'chip-off'" class="shrink-0" @click="mKind = k">{{ MEASUREMENTS[k]?.label ?? k }}</button>
      </div>
      <LineChart v-if="mKind" :points="mPoints" :unit="MEASUREMENTS[mKind]?.unit ?? ''" :title="MEASUREMENTS[mKind]?.label ?? mKind" :higher-is-better="!lowerIsBetter(mKind)" />
    </section>
  </div>
</template>
