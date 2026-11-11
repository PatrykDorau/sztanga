<script setup lang="ts">
// Statystyki ćwiczeń klienta: ile razy i ile serii każdego ćwiczenia, wykres ciężaru i objętości wybranego ćwiczenia,
// historia serii, podział na treningi z planu. Liczone z zapisanych sesji (tryb „sesja na żywo”).
import { computed, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useExercisesStore } from '@/stores/exercises'
import { e1rm } from '@/lib/strength'
import { searchExercises } from '@/lib/exerciseSearch'
import type { SessionLog, SetLog } from '@/types'
import LineChart from './LineChart.vue'
import Icon from './Icon.vue'

const props = defineProps<{ logs: SessionLog[] }>()
const ex = useExercisesStore()

// ----- Okres -----
const PERIODS = [
  ['30', '30 dni'],
  ['90', '3 mies.'],
  ['180', '6 mies.'],
  ['365', 'rok'],
  ['all', 'całość'],
] as const
const period = ref<(typeof PERIODS)[number][0]>('all')
const inPeriod = computed(() => {
  if (period.value === 'all') return props.logs
  const from = new Date(Date.now() - Number(period.value) * 864e5).toISOString()
  return props.logs.filter((l) => l.started_at >= from)
})

// ----- Zestawienie ćwiczeń -----
interface Session {
  date: string
  logId: string
  sets: SetLog[]
  maxLoad: number
  e1rm: number | null
  volume: number
  reps: number
}
interface Row {
  id: string
  name: string
  sessions: Session[]
  sets: number
  reps: number
  volume: number
  best: number
  bestE1rm: number | null
  last: string
}
const num = (v: unknown) => Number(v ?? 0) || 0
const rows = computed<Row[]>(() => {
  const m = new Map<string, Row>()
  for (const log of [...inPeriod.value].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const byEx = new Map<string, SetLog[]>()
    for (const s of log.set_logs ?? []) if (s.done) byEx.set(s.exercise_id, [...(byEx.get(s.exercise_id) ?? []), s])
    for (const [id, sets] of byEx) {
      const r = m.get(id) ?? { id, name: ex.byId(id)?.name_pl ?? '…', sessions: [], sets: 0, reps: 0, volume: 0, best: 0, bestE1rm: null, last: '' }
      const vol = sets.reduce((t, s) => t + num(s.reps) * num(s.load_kg), 0)
      const reps = sets.reduce((t, s) => t + num(s.reps), 0)
      const maxLoad = Math.max(0, ...sets.map((s) => num(s.load_kg)))
      const e = Math.max(0, ...sets.map((s) => e1rm(num(s.load_kg), num(s.reps)) ?? 0)) || null
      r.sessions.push({ date: log.started_at, logId: log.id, sets, maxLoad, e1rm: e, volume: vol, reps })
      r.sets += sets.length
      r.reps += reps
      r.volume += vol
      r.best = Math.max(r.best, maxLoad)
      if (e && (!r.bestE1rm || e > r.bestE1rm)) r.bestE1rm = e
      r.last = log.started_at
      m.set(id, r)
    }
  }
  return [...m.values()]
})
const SORTS = { count: 'najczęściej', last: 'ostatnio', volume: 'objętość' } as const
const sort = ref<keyof typeof SORTS>('count')
const q = ref('')
const shown = computed(() => {
  let list = rows.value
  if (q.value.trim()) {
    const ids = new Set(searchExercises(q.value, list.map((r) => ex.byId(r.id)).filter((e): e is NonNullable<typeof e> => !!e)).map((e) => e.id))
    list = list.filter((r) => ids.has(r.id))
  }
  const key = sort.value
  return [...list].sort((a, b) => (key === 'count' ? b.sessions.length - a.sessions.length || b.sets - a.sets : key === 'last' ? b.last.localeCompare(a.last) : b.volume - a.volume))
})
const showAll = ref(false)

// ----- Wybrane ćwiczenie -----
const selId = ref<string | null>(null)
watch(
  rows,
  (r) => {
    if (!selId.value || !r.some((x) => x.id === selId.value)) selId.value = [...r].sort((a, b) => b.sessions.length - a.sessions.length)[0]?.id ?? null
  },
  { immediate: true },
)
const sel = computed(() => rows.value.find((r) => r.id === selId.value) ?? null)
const loadMetric = ref<'maxLoad' | 'e1rm'>('maxLoad')
const loadPoints = computed(() => (sel.value?.sessions ?? []).map((s) => ({ x: s.date, y: loadMetric.value === 'e1rm' ? (s.e1rm ?? 0) : s.maxLoad })).filter((p) => p.y > 0))
const volPoints = computed(() => (sel.value?.sessions ?? []).map((s) => ({ x: s.date, y: Math.round(s.volume) })).filter((p) => p.y > 0))
const change = computed(() => {
  const s = sel.value?.sessions.filter((x) => x.maxLoad > 0) ?? []
  if (s.length < 2) return null
  return Math.round(((s.at(-1)!.maxLoad - s[0].maxLoad) / s[0].maxLoad) * 100)
})
const fmt = (n: number, d = 1) => String(Math.round(n * 10 ** d) / 10 ** d).replace('.', ',')
const day = (d: string) => new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: '2-digit' })
/** Serie zgrupowane po ciężarze: „75 kg × 8, 8, 8, 7 · 80 kg × 5”. */
function setsText(sets: SetLog[]) {
  const groups: [number, number[]][] = []
  for (const s of sets) {
    const load = num(s.load_kg)
    const last = groups.at(-1)
    if (last && last[0] === load) last[1].push(num(s.reps))
    else groups.push([load, [num(s.reps)]])
  }
  return groups.map(([load, reps]) => `${load ? `${fmt(load, 2)} kg` : 'bez obciążenia'} × ${reps.join(', ')}`).join(' · ')
}
const history = ref(false)

// ----- Podział na treningi z planu -----
const workoutNames = ref<Record<string, string>>({})
watch(
  () => [...new Set(props.logs.map((l) => l.workout_id).filter(Boolean))] as string[],
  async (ids) => {
    const missing = ids.filter((i) => !(i in workoutNames.value))
    if (!missing.length) return
    const { data } = await supabase.from('workouts').select('id, name').in('id', missing)
    workoutNames.value = { ...workoutNames.value, ...Object.fromEntries((data ?? []).map((w) => [w.id, w.name])) }
  },
  { immediate: true },
)
const byWorkout = computed(() => {
  const m = new Map<string, { name: string; sessions: number; ex: Map<string, number> }>()
  for (const l of inPeriod.value) {
    if (!l.set_logs?.some((s) => s.done)) continue
    const key = l.workout_id ?? '—'
    const w = m.get(key) ?? { name: l.workout_id ? (workoutNames.value[l.workout_id] ?? 'Trening') : 'Poza planem', sessions: 0, ex: new Map() }
    w.sessions++
    for (const id of new Set(l.set_logs.filter((s) => s.done).map((s) => s.exercise_id))) w.ex.set(id, (w.ex.get(id) ?? 0) + 1)
    m.set(key, w)
  }
  return [...m.values()].sort((a, b) => b.sessions - a.sessions)
})
</script>

<template>
  <section class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-lg font-bold">Ćwiczenia</h3>
      <div class="flex rounded-xl bg-surface-2 p-1" role="group" aria-label="Okres">
        <button v-for="[k, l] in PERIODS" :key="k" class="min-h-8 rounded-lg px-2 text-xs font-semibold" :class="period === k ? 'bg-surface shadow' : 'text-muted'" :aria-pressed="period === k" @click="period = k">{{ l }}</button>
      </div>
    </div>

    <p v-if="!rows.length" class="card p-4 text-sm text-muted">Brak zapisanych serii w tym okresie. Statystyki liczą się z sesji prowadzonych w trybie „sesja na żywo”.</p>

    <template v-else>
      <!-- Wybrane ćwiczenie -->
      <div v-if="sel" class="card space-y-3 p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-xs text-muted">Wybrane ćwiczenie</p>
            <RouterLink :to="`/cwiczenia/${sel.id}`" class="block truncate text-lg font-bold underline-offset-2 hover:underline">{{ sel.name }}</RouterLink>
          </div>
          <span class="shrink-0 text-xs text-muted">ostatnio {{ day(sel.last) }}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="rounded-xl bg-surface-2 p-2.5">
            <p class="text-xs text-muted">Rekord ciężaru</p>
            <p class="font-display text-2xl font-bold tabular-nums">{{ sel.best ? `${fmt(sel.best, 2)} kg` : '—' }}</p>
          </div>
          <div class="rounded-xl bg-surface-2 p-2.5">
            <p class="text-xs text-muted">Szac. 1RM</p>
            <p class="font-display text-2xl font-bold tabular-nums">{{ sel.bestE1rm ? `${fmt(sel.bestE1rm)} kg` : '—' }}</p>
          </div>
          <div class="rounded-xl bg-surface-2 p-2.5">
            <p class="text-xs text-muted">Zmiana ciężaru</p>
            <p class="font-display text-2xl font-bold tabular-nums" :class="change == null ? '' : change > 0 ? 'text-success' : change < 0 ? 'text-danger' : ''">{{ change == null ? '—' : `${change > 0 ? '+' : ''}${change}%` }}</p>
          </div>
          <div class="rounded-xl bg-surface-2 p-2.5">
            <p class="text-xs text-muted">Treningi · serie</p>
            <p class="font-display text-2xl font-bold tabular-nums">{{ sel.sessions.length }} · {{ sel.sets }}</p>
          </div>
        </div>

        <div class="space-y-1">
          <div class="flex gap-2">
            <button class="chip !min-h-8 text-sm" :class="loadMetric === 'maxLoad' ? 'border-primary bg-primary-soft font-semibold' : 'border-line bg-surface text-muted'" @click="loadMetric = 'maxLoad'">Maks. ciężar</button>
            <button class="chip !min-h-8 text-sm" :class="loadMetric === 'e1rm' ? 'border-primary bg-primary-soft font-semibold' : 'border-line bg-surface text-muted'" @click="loadMetric = 'e1rm'">Szac. 1RM</button>
          </div>
          <LineChart :points="loadPoints" unit="kg" :title="loadMetric === 'e1rm' ? 'Szacowane 1RM na treningu' : 'Największy ciężar na treningu'" mark-best />
        </div>
        <LineChart :points="volPoints" unit="kg" title="Objętość na treningu (powtórzenia × kg)" :height="140" />

        <button class="flex w-full items-center justify-between text-sm font-semibold" :aria-expanded="history" @click="history = !history">
          Historia serii ({{ sel.sessions.length }})<Icon name="chevron" class="size-4 transition-transform" :class="history ? 'rotate-90' : ''" />
        </button>
        <ul v-if="history" class="divide-y divide-line text-sm">
          <li v-for="s in [...sel.sessions].reverse()" :key="s.logId" class="flex gap-3 py-2">
            <span class="w-20 shrink-0 text-muted">{{ day(s.date) }}</span>
            <span class="min-w-0 flex-1">{{ setsText(s.sets) }}</span>
            <span class="shrink-0 text-muted tabular-nums">{{ fmt(s.volume / 1000, 2) }} t</span>
          </li>
        </ul>
      </div>

      <!-- Lista ćwiczeń -->
      <div class="flex gap-2">
        <input v-model="q" type="search" class="input !min-h-10 flex-1 text-sm" placeholder="Szukaj ćwiczenia, np. klatka, przysiad…" aria-label="Szukaj ćwiczenia klienta" />
        <select v-model="sort" class="input !min-h-10 w-auto text-sm" aria-label="Sortowanie">
          <option v-for="(l, k) in SORTS" :key="k" :value="k">{{ l }}</option>
        </select>
      </div>
      <ul class="card divide-y divide-line">
        <li v-for="r in showAll ? shown : shown.slice(0, 8)" :key="r.id">
          <button class="flex w-full items-center gap-3 p-3 text-left" :class="r.id === selId ? 'bg-primary-soft' : 'hover:bg-surface-2'" :aria-pressed="r.id === selId" @click="selId = r.id">
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">{{ r.name }}</span>
              <span class="text-xs text-muted">{{ r.sessions.length }}× · {{ r.sets }} serii · {{ r.reps }} powt. · {{ fmt(r.volume / 1000) }} t</span>
            </span>
            <span class="shrink-0 text-right">
              <span class="block font-semibold tabular-nums">{{ r.best ? `${fmt(r.best, 2)} kg` : '—' }}</span>
              <span class="text-xs text-muted">{{ day(r.last) }}</span>
            </span>
          </button>
        </li>
        <li v-if="!shown.length" class="p-3 text-sm text-muted">Brak ćwiczeń pasujących do wyszukiwania.</li>
      </ul>
      <button v-if="shown.length > 8" class="btn-ghost w-full text-sm" @click="showAll = !showAll">{{ showAll ? 'Pokaż mniej' : `Pokaż wszystkie (${shown.length})` }}</button>

      <!-- Treningi z planu -->
      <details v-if="byWorkout.length" class="card p-4">
        <summary class="cursor-pointer font-semibold">Według treningu z planu ({{ byWorkout.length }})</summary>
        <div class="mt-3 space-y-3">
          <div v-for="w in byWorkout" :key="w.name">
            <p class="text-sm font-semibold">{{ w.name }} <span class="font-normal text-muted">· {{ w.sessions }} {{ w.sessions === 1 ? 'raz' : 'razy' }}</span></p>
            <ul class="mt-1 flex flex-wrap gap-1.5">
              <li v-for="[id, n] in [...w.ex.entries()].sort((a, b) => b[1] - a[1])" :key="id">
                <button class="tag hover:bg-primary-soft" @click="selId = id">{{ ex.byId(id)?.name_pl ?? '…' }} ×{{ n }}</button>
              </li>
            </ul>
          </div>
        </div>
      </details>
    </template>
  </section>
</template>
