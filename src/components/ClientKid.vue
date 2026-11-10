<script setup lang="ts">
// Zakładka "Rozwój" (dzieci): kwartalne testy sprawności z wykresem rozwoju, odznaki, zgody rodzica i link do raportu.
import { computed, onMounted, reactive, ref } from 'vue'
import { useProgressStore } from '@/stores/progress'
import { CONSENT_LABEL, useSportStore, type Challenge, type Consent } from '@/stores/sport'
import { badgesFor, CHILD_TESTS, TEST_EVERY_DAYS, testProgress, type TestPoint } from '@/lib/sport'
import LineChart from '@/components/LineChart.vue'
import LinkBox from '@/components/LinkBox.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ clientId: string; firstName: string }>()
const progress = useProgressStore()
const sport = useSportStore()
const consents = ref<Consent[]>([])
const challenges = ref<Challenge[]>([])

onMounted(async () => {
  await progress.loadClient(props.clientId).catch(() => null)
  consents.value = await sport.consents(props.clientId).catch(() => [])
  challenges.value = await sport.challenges().catch(() => [])
})

// ----- Testy -----
const tests = computed<TestPoint[]>(() =>
  (progress.measurements[props.clientId] ?? []).filter((m) => CHILD_TESTS.some((t) => t.kind === m.kind)).map((m) => ({ kind: m.kind, value: Number(m.value), measured_on: m.measured_on })),
)
const lastTestDay = computed(() => tests.value.map((t) => t.measured_on).sort().at(-1) ?? null)
const daysSince = computed(() => (lastTestDay.value ? Math.floor((Date.now() - new Date(lastTestDay.value).getTime()) / 864e5) : null))
const due = computed(() => daysSince.value == null || daysSince.value >= TEST_EVERY_DAYS)
const open = ref<string | null>(null)
const points = (kind: string) => tests.value.filter((t) => t.kind === kind).map((t) => ({ x: t.measured_on, y: t.value }))

const entering = ref(false)
const day = ref(new Date().toISOString().slice(0, 10))
const vals = reactive<Record<string, string>>({})
const saving = ref(false)
const error = ref('')
async function saveTests() {
  saving.value = true
  error.value = ''
  try {
    const rows = CHILD_TESTS.filter((t) => (vals[t.kind] ?? '').trim()).map((t) => ({ t, v: Number(vals[t.kind].replace(',', '.')) }))
    if (!rows.length) throw new Error('Wpisz przynajmniej jeden wynik.')
    if (rows.some((r) => !Number.isFinite(r.v) || r.v < 0)) throw new Error('Wyniki muszą być liczbami.')
    for (const { t, v } of rows) await progress.addMeasurement({ client_id: props.clientId, kind: t.kind, value: v, unit: t.unit, measured_on: day.value, notes: null })
    for (const k of Object.keys(vals)) vals[k] = ''
    entering.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

// ----- Odznaki -----
const sessions = computed(() => (progress.logs[props.clientId] ?? []).length)
const myChallenges = computed(() =>
  challenges.value.map((c) => ({
    target: Number(c.team_target),
    team: (c.challenge_entries ?? []).reduce((s, e) => s + Number(e.value), 0),
    mine: (c.challenge_entries ?? []).find((e) => e.client_id === props.clientId)?.value ?? null,
  })),
)
const badges = computed(() => badgesFor({ sessions: sessions.value, tests: tests.value, challenges: myChallenges.value }))

// ----- Zgody -----
const active = computed(() => consents.value.filter((c) => !c.revoked_at))
const has = (k: Consent['kind']) => active.value.some((c) => c.kind === k)
const adding = ref(false)
const parent = ref('')
const kinds = ref<Consent['kind'][]>(['parent_data', 'results_sharing'])
async function addConsents() {
  if (parent.value.trim().length < 2) return
  for (const k of kinds.value.filter((k) => !has(k))) await sport.addConsent(props.clientId, k, parent.value)
  consents.value = await sport.consents(props.clientId)
  adding.value = false
}
async function revoke(c: Consent) {
  if (!confirm(`Wycofać zgodę „${CONSENT_LABEL[c.kind]}”?`)) return
  await sport.revokeConsent(c.id)
  consents.value = await sport.consents(props.clientId)
}
const pomiary = (n: number) => `${n} ${n === 1 ? "pomiar" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "pomiary" : "pomiarów"}`
const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',')
const date = (d: string) => new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })
</script>

<template>
  <div class="space-y-5">
    <!-- Testy sprawności -->
    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold">Testy sprawności</h3>
        <button class="btn-ghost !min-h-10 text-sm" @click="entering = !entering"><Icon name="plus" class="size-4" />Test</button>
      </div>
      <p class="text-sm" :class="due ? 'font-semibold text-warn-fg' : 'text-muted'">
        {{ lastTestDay ? `Ostatni test: ${date(lastTestDay)} (${daysSince} dni temu).` : 'Brak testów.' }}
        {{ due ? 'Czas na test kwartalny.' : `Następny za ok. ${TEST_EVERY_DAYS - daysSince!} dni.` }}
      </p>

      <form v-if="entering" class="card space-y-3 p-4" @submit.prevent="saveTests">
        <label class="block"><span class="label">Data testu</span><input v-model="day" type="date" class="input" required /></label>
        <div v-for="t in CHILD_TESTS" :key="t.kind" class="grid grid-cols-[1fr_6rem] items-center gap-3">
          <label :for="`t-${t.kind}`" class="text-sm">
            <span class="font-semibold">{{ t.label }}</span> <span class="text-muted">({{ t.unit }})</span>
            <span class="block text-xs text-muted">{{ t.how }}</span>
          </label>
          <input :id="`t-${t.kind}`" v-model="vals[t.kind]" inputmode="decimal" class="input text-center" />
        </div>
        <p class="text-xs text-muted">Puste pola zostaną pominięte.</p>
        <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="saving">{{ saving ? 'Zapisywanie…' : 'Zapisz wyniki' }}</button>
      </form>

      <ul class="space-y-2">
        <li v-for="t in CHILD_TESTS" :key="t.kind" class="card">
          <button type="button" class="flex w-full items-center gap-3 p-3 text-left" :aria-expanded="open === t.kind" @click="open = open === t.kind ? null : t.kind">
            <span class="min-w-0 flex-1">
              <span class="block font-semibold">{{ t.label }}</span>
              <span class="text-xs text-muted">{{ testProgress(tests, t) ? pomiary(testProgress(tests, t)!.count) : 'brak wyniku' }}</span>
            </span>
            <template v-if="testProgress(tests, t)">
              <span class="font-display text-2xl font-bold tabular-nums">{{ fmt(testProgress(tests, t)!.last) }}<span class="text-sm font-normal text-muted"> {{ t.unit }}</span></span>
              <span
                v-if="testProgress(tests, t)!.count > 1"
                class="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
                :class="testProgress(tests, t)!.change > 0 ? 'bg-success-soft text-success' : testProgress(tests, t)!.change < 0 ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted'"
              >
                {{ testProgress(tests, t)!.change > 0 ? '▲' : testProgress(tests, t)!.change < 0 ? '▼' : '=' }} {{ testProgress(tests, t)!.pct != null ? `${Math.abs(testProgress(tests, t)!.pct!)}%` : '' }}
              </span>
            </template>
          </button>
          <div v-if="open === t.kind && points(t.kind).length" class="px-3 pb-3">
            <LineChart :points="points(t.kind)" :unit="t.unit" :title="t.label" :higher-is-better="!t.lowerIsBetter" :height="150" />
          </div>
        </li>
      </ul>
    </section>

    <!-- Odznaki -->
    <section class="space-y-2">
      <h3 class="text-lg font-bold">Odznaki</h3>
      <ul class="grid grid-cols-3 gap-2">
        <li v-for="b in badges" :key="b.key" class="card flex flex-col items-center gap-1 p-3 text-center" :class="b.got ? '' : 'opacity-45'">
          <span class="text-3xl" :class="b.got ? '' : 'grayscale'" aria-hidden="true">{{ b.icon }}</span>
          <span class="text-xs font-semibold leading-tight">{{ b.title }}</span>
          <span v-if="!b.got" class="text-[10px] leading-tight text-muted">{{ b.hint }}</span>
        </li>
      </ul>
      <p class="text-xs text-muted">Odznaki nalicza się same: treningi, poprawa w testach i wyzwania drużyny. Bez rankingów – każde dziecko porównujemy tylko z nim samym.</p>
      <RouterLink to="/wyzwania" class="text-sm font-semibold text-primary-fg underline">Wyzwania drużynowe</RouterLink>
    </section>

    <!-- Zgody -->
    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold">Zgody rodzica</h3>
        <button class="btn-ghost !min-h-10 text-sm" @click="adding = !adding"><Icon name="plus" class="size-4" />Zgoda</button>
      </div>
      <p v-if="!has('parent_data')" class="warn-box text-sm"><Icon name="alert" class="size-5 shrink-0" />Brak zgody rodzica na przetwarzanie danych dziecka. Wyślij link do raportu – rodzic zaznaczy zgodę sam albo wpisz ją tutaj.</p>
      <form v-if="adding" class="card space-y-3 p-4" @submit.prevent="addConsents">
        <label class="block"><span class="label">Rodzic / opiekun (imię i nazwisko)</span><input v-model="parent" class="input" required minlength="2" /></label>
        <label v-for="(l, k) in CONSENT_LABEL" :key="k" class="flex items-start gap-3 text-sm">
          <input v-model="kinds" type="checkbox" :value="k" class="mt-0.5 size-5 accent-primary" :disabled="has(k)" />
          <span>{{ l }}<span v-if="has(k)" class="text-muted"> – już jest</span></span>
        </label>
        <p class="text-xs text-muted">Wpisz tylko zgody, które rodzic faktycznie wyraził (np. na papierze). Zapisujemy kto i kiedy.</p>
        <button class="btn-primary w-full">Zapisz zgody</button>
      </form>
      <ul v-if="consents.length" class="space-y-1.5 text-sm">
        <li v-for="c in consents" :key="c.id" class="flex flex-wrap items-center gap-x-2" :class="c.revoked_at ? 'text-muted line-through' : ''">
          <Icon :name="c.revoked_at ? 'x' : 'check'" class="size-4 shrink-0" :class="c.revoked_at ? '' : 'text-success'" />
          <span class="font-medium">{{ CONSENT_LABEL[c.kind] }}</span>
          <span class="text-xs text-muted">{{ c.granted_by }} · {{ date(c.granted_at) }} · {{ c.source === 'link' ? 'przez link' : 'wpisane' }}</span>
          <button v-if="!c.revoked_at" class="ml-auto text-xs font-semibold text-danger underline" @click="revoke(c)">wycofaj</button>
        </li>
      </ul>
    </section>

    <LinkBox
      :client-id="clientId"
      purpose="parent"
      title="Link dla rodzica"
      hint="Rodzic bez konta wyraża zgody i widzi raport: testy sprawności, frekwencję, odznaki, wyzwania drużyny i Twoje podsumowania. Wyniki pokazujemy dopiero po zgodzie na udostępnianie."
      :share-text="`Raport z zajęć – ${firstName}:`"
    />
  </div>
</template>
