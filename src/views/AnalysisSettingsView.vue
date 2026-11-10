<script setup lang="ts">
// Kalibracja: progi flagowania (z trenerką, na 20–30 nagraniach) + dokładność licznika powtórzeń
// liczona z poprawek "Zgadza się? / było N" w analizach. Cel z planu: mniej niż 1 błąd na 20 powtórzeń.
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAnalysisStore } from '@/stores/analysis'
import { EXERCISE_KEYS, PROFILES, thresholdFor, type ExerciseKey, type Thresholds } from '@/lib/pose/profiles'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const store = useAnalysisStore()
const form = reactive<Record<string, Record<string, number>>>({})
const saving = ref(false)
const saved = ref(false)

onMounted(async () => {
  await store.load()
  for (const k of EXERCISE_KEYS) form[k] = Object.fromEntries(PROFILES[k].flags.map((f) => [f.key, thresholdFor(store.thresholds, k, f)]))
})

async function save() {
  saving.value = true
  // Zapisujemy tylko to, co różni się od wartości domyślnych.
  const th: Thresholds = {}
  for (const k of EXERCISE_KEYS) {
    const diff = Object.fromEntries(PROFILES[k].flags.filter((f) => form[k]?.[f.key] !== f.value).map((f) => [f.key, Number(form[k][f.key])]))
    if (Object.keys(diff).length) th[k] = diff
  }
  await store.saveThresholds(th)
  saving.value = false
  saved.value = true
  setTimeout(() => (saved.value = false), 2000)
}
function resetEx(k: ExerciseKey) {
  form[k] = Object.fromEntries(PROFILES[k].flags.map((f) => [f.key, f.value]))
}

const accuracy = computed(() =>
  EXERCISE_KEYS.map((k) => {
    const checked = store.list.filter((a) => a.exercise_key === k && a.reps_actual != null)
    const actual = checked.reduce((s, a) => s + (a.reps_actual ?? 0), 0)
    const errors = checked.reduce((s, a) => s + Math.abs(a.reps.length - (a.reps_actual ?? 0)), 0)
    return { k, n: checked.length, actual, errors, ok: actual >= 20 && errors / actual < 1 / 20 }
  }).filter((r) => r.n),
)
const unit = (k: ExerciseKey, metric: string) => PROFILES[k].metrics.find((m) => m.key === metric)?.unit ?? ''
</script>

<template>
  <main class="pb-10">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-2xl font-bold">Progi i dokładność</h1>
    </header>

    <div class="space-y-6 px-4">
      <section class="space-y-2">
        <h2 class="text-xl font-bold">Licznik powtórzeń</h2>
        <p v-if="!accuracy.length" class="card p-4 text-sm text-muted">
          W każdej analizie odpowiedz „Zgadza się?” – tu pojawi się, jak często licznik się myli. Cel: mniej niż 1 błąd na 20 powtórzeń.
        </p>
        <div v-for="r in accuracy" :key="r.k" class="card flex items-center gap-3 p-4">
          <Icon :name="r.ok ? 'check' : 'clock'" class="size-6 shrink-0" :class="r.ok ? 'text-success' : 'text-muted'" />
          <div class="flex-1">
            <p class="font-semibold">{{ PROFILES[r.k].name }}</p>
            <p class="text-sm text-muted tabular-nums">
              {{ r.errors }} {{ r.errors === 1 ? 'błąd' : 'błędów' }} na {{ r.actual }} powtórzeń z {{ r.n }} {{ r.n === 1 ? 'nagrania' : 'nagrań' }}
              <template v-if="r.actual < 20"> · sprawdź jeszcze {{ 20 - r.actual }}+ powtórzeń</template>
            </p>
          </div>
        </div>
      </section>

      <section class="space-y-4">
        <div>
          <h2 class="text-xl font-bold">Progi flagowania</h2>
          <p class="text-sm text-muted">Od jakiej wartości powtórzenie trafia do „Do sprawdzenia”. Dopasuj je po obejrzeniu kilkunastu nagrań.</p>
        </div>
        <fieldset v-for="k in EXERCISE_KEYS" :key="k" class="card space-y-3 p-4">
          <legend class="sr-only">{{ PROFILES[k].name }}</legend>
          <div class="flex items-center justify-between">
            <p class="font-display text-lg font-bold">{{ PROFILES[k].name }}<span v-if="PROFILES[k].beta" class="ml-1.5 text-xs font-normal text-muted uppercase">beta</span></p>
            <button type="button" class="text-sm font-semibold text-primary-fg" @click="resetEx(k)">Domyślne</button>
          </div>
          <label v-for="f in PROFILES[k].flags" :key="f.key" class="flex items-center gap-3 text-sm">
            <span class="flex-1 first-letter:uppercase">{{ f.label }}, gdy {{ f.op === '<' ? 'poniżej' : 'powyżej' }}</span>
            <input v-if="form[k]" v-model.number="form[k][f.key]" type="number" step="any" inputmode="decimal" class="input !min-h-10 w-20 text-right" :aria-label="`${f.label} – próg`" />
            <span class="w-6 text-muted">{{ unit(k, f.metric) === 's' ? 's' : unit(k, f.metric) }}</span>
          </label>
        </fieldset>
        <button class="btn-primary w-full" :disabled="saving" @click="save">{{ saved ? 'Zapisano' : saving ? 'Zapisywanie…' : 'Zapisz progi' }}</button>
      </section>
    </div>
  </main>
</template>
