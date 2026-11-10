<script setup lang="ts">
// Zakładka "Sport" (sportowcy): dzisiejsza gotowość, trend ankiet, obciążenie sesji (sRPE × czas) i ACWR, link do ankiety.
import { computed, onMounted, ref } from 'vue'
import { useSportStore, type LoadRow } from '@/stores/sport'
import { acwr, acwrStatus, durationOf, LIGHT_LABEL, readinessScore, readinessStatus, READINESS_ITEMS, sessionLoad, type Readiness } from '@/lib/sport'
import LineChart from '@/components/LineChart.vue'
import ReadinessForm from '@/components/ReadinessForm.vue'
import LinkBox from '@/components/LinkBox.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ clientId: string; firstName: string }>()
const sport = useSportStore()
const rows = ref<Readiness[]>([])
const logs = ref<LoadRow[]>([])
const loaded = ref(false)
const asking = ref(false)
const saving = ref(false)
const plDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' })
const today = plDay()

async function load() {
  const from = new Date(Date.now() - 70 * 864e5).toISOString().slice(0, 10)
  const [r, l] = await Promise.all([sport.loadReadiness(from, props.clientId), sport.loads(props.clientId, from)])
  rows.value = r
  logs.value = l
  loaded.value = true
}
onMounted(load)

const todayEntry = computed(() => rows.value.find((r) => r.day === today) ?? null)
const todayStatus = computed(() => (todayEntry.value ? readinessStatus(todayEntry.value, rows.value) : null))
const trend = computed(() => rows.value.slice(-42).map((r) => ({ x: r.day, y: readinessScore(r) })))
const filled7 = computed(() => rows.value.filter((r) => r.day > new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).length)

const series = computed(() => acwr(logs.value))
const last = computed(() => series.value.at(-1) ?? null)
const status = computed(() => acwrStatus(last.value?.ratio ?? null))
const ratioPoints = computed(() => series.value.filter((p) => p.ratio != null).slice(-42).map((p) => ({ x: p.day, y: p.ratio! })))
const missingSrpe = computed(() => logs.value.filter((l) => l.srpe == null).slice(-5).reverse())
const weekLoad = computed(() => series.value.slice(-7).reduce((s, p) => s + p.load, 0))

async function saveToday(v: Omit<Readiness, 'client_id' | 'day'>) {
  saving.value = true
  try {
    const row = await sport.saveReadiness({ ...v, client_id: props.clientId, day: today })
    rows.value = [...rows.value.filter((r) => r.day !== today), row]
    asking.value = false
  } finally {
    saving.value = false
  }
}
async function setSrpe(l: LoadRow, e: Event) {
  const v = (e.target as HTMLSelectElement).value
  const srpe = v === '' ? null : Number(v)
  await sport.setLoad(l.id, { srpe, duration_min: durationOf(l) })
  l.srpe = srpe
  l.duration_min = durationOf(l)
}

const LIGHT = { green: 'bg-success-soft text-success', yellow: 'bg-warn-soft text-warn-fg', red: 'bg-danger-soft text-danger', none: 'bg-surface-2 text-muted' } as const
const fmt = (n: number, d = 2) => n.toFixed(d).replace('.', ',')
const shortDay = (d: string) => new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })
</script>

<template>
  <div class="space-y-5">
    <!-- Dziś -->
    <section class="space-y-2">
      <h3 class="text-lg font-bold">Gotowość dziś</h3>
      <div v-if="todayStatus" class="card space-y-2 p-4">
        <div class="flex items-center gap-3">
          <span class="rounded-full px-3 py-1 text-sm font-bold" :class="LIGHT[todayStatus.light]">{{ LIGHT_LABEL[todayStatus.light] }}</span>
          <span class="font-display text-3xl font-bold tabular-nums">{{ todayStatus.score }}</span><span class="text-sm text-muted">/100</span>
          <span v-if="todayStatus.baseline != null" class="ml-auto text-xs text-muted">norma: {{ todayStatus.baseline }}</span>
        </div>
        <p v-if="todayStatus.reasons.length" class="text-sm">{{ todayStatus.reasons.join(' · ') }}</p>
        <div class="grid grid-cols-5 gap-1 text-center text-xs">
          <div v-for="it in READINESS_ITEMS" :key="it.key">
            <p class="text-muted">{{ it.label.split(' ')[0] }}</p>
            <p class="text-base font-bold tabular-nums" :class="todayEntry![it.key] <= 2 ? 'text-danger' : ''">{{ todayEntry![it.key] }}</p>
          </div>
        </div>
        <p v-if="todayEntry?.notes" class="text-sm italic">„{{ todayEntry.notes }}”</p>
        <button class="text-sm font-semibold text-primary-fg underline" @click="asking = !asking">Popraw</button>
      </div>
      <button v-else-if="!asking" class="btn-ghost w-full border border-line-strong" @click="asking = true"><Icon name="clipboard" class="size-5" />Wypełnij ankietę z {{ firstName }}</button>
      <div v-if="asking" class="card p-4">
        <ReadinessForm :initial="todayEntry ?? undefined" :busy="saving" @submit="saveToday" />
      </div>
      <p class="text-xs text-muted">Wypełnione w ostatnich 7 dniach: {{ filled7 }}. Cel: co najmniej 4 z 5 dni treningowych.</p>
    </section>

    <LinkBox
      :client-id="clientId"
      purpose="readiness"
      title="Link do ankiety dla sportowca"
      hint="Sportowiec wypełnia sam z telefonu, bez konta – codziennie ten sam link. Wynik od razu widzisz tutaj i na stronie głównej."
      :share-text="`Ankieta gotowości przed treningiem (20 s):`"
    />

    <LineChart v-if="trend.length > 1" :points="trend" unit="" title="Gotowość (0–100)" :mark-best="false" />

    <!-- Obciążenie -->
    <section class="space-y-2">
      <h3 class="text-lg font-bold">Obciążenie treningowe</h3>
      <div class="grid grid-cols-3 gap-2">
        <div class="card p-3">
          <p class="text-xs text-muted">ACWR</p>
          <p class="font-display text-3xl font-bold tabular-nums">{{ last?.ratio != null ? fmt(last.ratio) : '—' }}</p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-muted">Ostatnie 7 dni</p>
          <p class="font-display text-3xl font-bold tabular-nums">{{ Math.round(weekLoad) }}</p>
          <p class="text-[11px] text-muted">j.u. (sRPE × min)</p>
        </div>
        <div class="card p-3">
          <p class="text-xs text-muted">Średnio / dzień</p>
          <p class="font-display text-3xl font-bold tabular-nums">{{ last ? Math.round(last.chronic) : '—' }}</p>
          <p class="text-[11px] text-muted">28 dni</p>
        </div>
      </div>
      <p class="rounded-xl px-3 py-2 text-sm font-semibold" :class="LIGHT[status.light]">{{ status.text }}</p>
      <LineChart v-if="ratioPoints.length > 1" :points="ratioPoints" unit="" title="ACWR (ostre 7 dni / przewlekłe 28 dni)" :higher-is-better="false" :mark-best="false" />
      <p class="text-xs text-muted">
        Obciążenie sesji = RPE całej sesji (0–10, pytane ok. 30 min po treningu) × minuty. ACWR liczony średnią wykładniczą; bezpieczny zakres zwykle 0,8–1,3, powyżej 1,5 rośnie ryzyko urazu.
      </p>
      <div v-if="loaded && missingSrpe.length" class="card space-y-2 p-4 text-sm">
        <p class="font-semibold">Sesje bez RPE sesji</p>
        <div v-for="l in missingSrpe" :key="l.id" class="flex items-center gap-3">
          <span class="w-20 text-muted">{{ shortDay(l.started_at) }}</span>
          <span class="flex-1 text-muted">{{ durationOf(l) ? `${durationOf(l)} min` : 'brak czasu' }}</span>
          <select class="input !min-h-10 w-24" :aria-label="`RPE sesji z ${shortDay(l.started_at)}`" @change="setSrpe(l, $event)">
            <option value="">RPE…</option>
            <option v-for="n in 11" :key="n - 1" :value="n - 1">{{ n - 1 }}</option>
          </select>
        </div>
      </div>
      <p v-if="loaded && !logs.length" class="text-sm text-muted">Brak zapisanych sesji w ostatnich 10 tygodniach.</p>
      <p v-else-if="loaded && logs.some((l) => sessionLoad(l) == null) && !missingSrpe.length" class="text-sm text-muted">Część sesji nie ma czasu trwania – nie wchodzą do obciążenia.</p>
    </section>
  </div>
</template>
