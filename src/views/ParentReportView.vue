<script setup lang="ts">
// Raport dla rodzica (link bez konta): najpierw zgody, potem rozwój dziecka – testy sprawności, frekwencja,
// odznaki, wyzwania drużyny (wkład dziecka + wspólny postęp, bez rankingów) i podsumowania trenerki. Do druku / PDF.
import { computed, onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { badgesFor, CHILD_TESTS, testProgress, type TestPoint } from '@/lib/sport'
import { CONSENT_LABEL, type Consent } from '@/stores/sport'
import LineChart from '@/components/LineChart.vue'
import Icon from '@/components/Icon.vue'

interface Report {
  first_name: string
  consents: { kind: Consent['kind']; by: string; at: string }[]
  shared: boolean
  tests: { kind: string; value: number; unit: string; on: string }[]
  attendance: { completed: number; missed: number; first: string | null; last: string | null } | null
  sessions_total: number
  challenges: { title: string; description: string | null; unit: string; target: number; starts_on: string; ends_on: string; team: number; mine: number | null }[]
  summaries: { date: string; summary: string }[]
}
const props = defineProps<{ token: string }>()
const r = ref<Report | null>(null)
const state = ref<'loading' | 'ok' | 'missing'>('loading')

async function load() {
  const { data, error } = await supabase.rpc('parent_report', { link_token: props.token })
  if (error || !data) {
    state.value = 'missing'
    return
  }
  r.value = data as Report
  state.value = 'ok'
}
onMounted(load)

// ----- Zgody -----
const has = (k: Consent['kind']) => !!r.value?.consents.some((c) => c.kind === k)
const parent = ref('')
const pick = ref<Consent['kind'][]>(['parent_data', 'results_sharing'])
const busy = ref(false)
const error = ref('')
async function consent() {
  if (parent.value.trim().length < 2 || !pick.value.length) return
  busy.value = true
  error.value = ''
  const { data, error: e } = await supabase.rpc('parent_consent', { link_token: props.token, parent_name: parent.value.trim(), kinds: pick.value })
  busy.value = false
  if (e || !data) {
    error.value = 'Nie udało się zapisać zgody. Spróbuj ponownie.'
    return
  }
  await load()
}

const tests = computed<TestPoint[]>(() => (r.value?.tests ?? []).map((t) => ({ kind: t.kind, value: Number(t.value), measured_on: t.on })))
const done = computed(() => CHILD_TESTS.filter((t) => tests.value.some((x) => x.kind === t.kind)))
const badges = computed(() =>
  r.value ? badgesFor({ sessions: r.value.sessions_total, tests: tests.value, challenges: r.value.challenges.map((c) => ({ target: Number(c.target), team: Number(c.team), mine: c.mine })) }) : [],
)
const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',')
const print = () => window.print()
const date = (d: string) => new Date(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
</script>

<template>
  <main class="mx-auto max-w-2xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-12 print:max-w-none print:pt-0">
    <p v-if="state === 'loading'" class="pt-10 text-center text-muted">Ładowanie…</p>
    <div v-else-if="state === 'missing'" class="card mt-10 p-6 text-center">
      <h1 class="text-xl font-bold">Link jest nieaktywny</h1>
      <p class="mt-2 text-sm text-muted">Poproś trenerkę o nowy link.</p>
    </div>

    <template v-else-if="r">
      <header class="mb-6 flex items-start justify-between gap-3">
        <div>
          <p class="text-sm text-muted">Raport z zajęć</p>
          <h1 class="font-display text-3xl font-bold">{{ r.first_name }}</h1>
          <p class="text-sm text-muted">stan na {{ date(new Date().toISOString()) }}</p>
        </div>
        <button v-if="r.shared" class="btn-ghost border border-line-strong print:hidden" @click="print"><Icon name="download" class="size-5" />PDF</button>
      </header>

      <!-- Zgody -->
      <section v-if="!r.shared || !has('parent_data')" class="card mb-6 space-y-3 p-5 print:hidden">
        <h2 class="text-lg font-bold">Zgody rodzica / opiekuna</h2>
        <p class="text-sm text-muted">Żeby prowadzić zajęcia i pokazać Ci wyniki, potrzebujemy Twojej zgody. Możesz ją w każdej chwili wycofać u trenerki.</p>
        <form class="space-y-3" @submit.prevent="consent">
          <label v-for="(l, k) in CONSENT_LABEL" :key="k" class="flex items-start gap-3 text-sm">
            <input v-model="pick" type="checkbox" :value="k" class="mt-0.5 size-5 accent-primary" :disabled="has(k)" />
            <span>{{ l }}<span v-if="has(k)" class="text-success"> – udzielona</span></span>
          </label>
          <label class="block"><span class="label">Imię i nazwisko rodzica / opiekuna</span><input v-model="parent" class="input" required minlength="2" autocomplete="name" /></label>
          <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
          <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Zapisywanie…' : 'Wyrażam zgodę' }}</button>
        </form>
      </section>

      <template v-if="r.shared">
        <section class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div class="card p-4">
            <p class="font-display text-4xl font-bold tabular-nums">{{ r.sessions_total }}</p>
            <p class="text-sm text-muted">treningów razem</p>
          </div>
          <div v-if="r.attendance && r.attendance.completed + r.attendance.missed > 0" class="card p-4">
            <p class="font-display text-4xl font-bold tabular-nums">{{ r.attendance.completed }}</p>
            <p class="text-sm text-muted">obecności (4 mies.)</p>
          </div>
          <div class="card p-4">
            <p class="font-display text-4xl font-bold tabular-nums">{{ badges.filter((b) => b.got).length }}</p>
            <p class="text-sm text-muted">zdobytych odznak</p>
          </div>
        </section>

        <section class="mb-6 space-y-3">
          <h2 class="text-xl font-bold">Testy sprawności</h2>
          <p v-if="!done.length" class="text-sm text-muted">Pierwszy test jeszcze przed nami.</p>
          <div v-for="t in done" :key="t.kind" class="card space-y-1 p-4 break-inside-avoid">
            <div class="flex items-baseline gap-2">
              <p class="flex-1 font-semibold">{{ t.label }}</p>
              <p class="font-display text-2xl font-bold tabular-nums">{{ fmt(testProgress(tests, t)!.last) }} <span class="text-sm font-normal text-muted">{{ t.unit }}</span></p>
            </div>
            <p v-if="testProgress(tests, t)!.count > 1" class="text-sm" :class="testProgress(tests, t)!.change > 0 ? 'text-success' : 'text-muted'">
              {{ testProgress(tests, t)!.change > 0 ? `Poprawa od pierwszego testu o ${fmt(Math.abs(testProgress(tests, t)!.change))} ${t.unit}` : testProgress(tests, t)!.change < 0 ? 'Wynik do poprawy – pracujemy nad tym' : 'Wynik bez zmian' }}
            </p>
            <LineChart v-if="testProgress(tests, t)!.count > 1" :points="tests.filter((x) => x.kind === t.kind).map((x) => ({ x: x.measured_on, y: x.value }))" :unit="t.unit" :title="t.label" :higher-is-better="!t.lowerIsBetter" :height="140" />
          </div>
          <p class="text-xs text-muted">Porównujemy dziecko tylko z nim samym – rozwój w czasie, nie z innymi dziećmi.</p>
        </section>

        <section class="mb-6 space-y-2 break-inside-avoid">
          <h2 class="text-xl font-bold">Odznaki</h2>
          <ul class="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <li v-for="b in badges" :key="b.key" class="card flex flex-col items-center gap-1 p-3 text-center" :class="b.got ? '' : 'opacity-40'">
              <span class="text-3xl" :class="b.got ? '' : 'grayscale'" aria-hidden="true">{{ b.icon }}</span>
              <span class="text-xs font-semibold">{{ b.title }}</span>
            </li>
          </ul>
        </section>

        <section v-if="r.summaries.length" class="mb-6 space-y-2">
          <h2 class="text-xl font-bold">Od trenerki</h2>
          <div v-for="s in r.summaries" :key="s.date" class="card p-4 break-inside-avoid">
            <p class="text-xs text-muted">{{ date(s.date) }}</p>
            <p class="whitespace-pre-line text-sm">{{ s.summary }}</p>
          </div>
        </section>
      </template>

      <section v-if="r.challenges.length" class="mb-6 space-y-2">
        <h2 class="text-xl font-bold">Wyzwania drużyny</h2>
        <div v-for="c in r.challenges" :key="c.title + c.starts_on" class="card space-y-2 p-4 break-inside-avoid">
          <p class="font-semibold">{{ c.title }}</p>
          <p v-if="c.description" class="text-sm text-muted">{{ c.description }}</p>
          <div class="h-3 overflow-hidden rounded-full bg-surface-2" role="img" :aria-label="`Drużyna: ${fmt(c.team)} z ${fmt(c.target)} ${c.unit}`">
            <div class="h-full rounded-full bg-primary" :style="{ width: `${Math.min(100, (c.team / c.target) * 100)}%` }" />
          </div>
          <p class="text-sm">Drużyna: <strong>{{ fmt(c.team) }}</strong> / {{ fmt(c.target) }} {{ c.unit }}<span v-if="c.mine"> · wkład {{ r.first_name }}: <strong>{{ fmt(c.mine) }}</strong></span></p>
        </div>
      </section>
    </template>
  </main>
</template>
