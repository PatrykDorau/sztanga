<script setup lang="ts">
// Sesja na żywo: odhaczanie serii, ciężar i powtórzenia, timer przerw, podmiana na regresję/progresję.
// Działa bez zasięgu – wszystko zapisuje się na telefonie i wysyła po zakończeniu.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useExercisesStore } from '@/stores/exercises'
import { useLiveStore, type LiveExercise } from '@/stores/live'
import { CONTRAINDICATIONS, label } from '@/lib/vocab'
import { fmtKg } from '@/lib/strength'
import ExercisePicker from '@/components/ExercisePicker.vue'
import ExerciseThumb from '@/components/ExerciseThumb.vue'
import Icon from '@/components/Icon.vue'
import TempoMetronome from '@/components/TempoMetronome.vue'
import ReadinessForm from '@/components/ReadinessForm.vue'
import { CR10, LIGHT_LABEL, readinessStatus, type Readiness } from '@/lib/sport'
import { useSportStore } from '@/stores/sport'

const props = defineProps<{ id: string }>()
const router = useRouter()
const live = useLiveStore()
const ex = useExercisesStore()
const clients = useClientsStore()

const d = computed(() => live.drafts[props.id])
// Po zakończeniu szkic znika z magazynu – id klienta zapamiętujemy, żeby ekran wyniku miał link do karty.
const finishedClientId = ref<string | null>(null)
const client = computed(() => clients.byId(d.value?.client_id ?? finishedClientId.value))
const picking = ref(false)
// ===== Sportowiec: ankieta gotowości na starcie =====
const sport = useSportStore()
const plToday = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' })
const isAthlete = computed(() => client.value?.client_group === 'athlete')
const ready = ref<Readiness | null>(null)
const readyHistory = ref<Readiness[]>([])
const askingReady = ref(false)
const savingReady = ref(false)
watch(
  isAthlete,
  async (a) => {
    if (!a || !d.value) return
    const rows = await sport.loadReadiness(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), d.value.client_id).catch(() => [])
    readyHistory.value = rows
    ready.value = rows.find((r) => r.day === plToday) ?? null
  },
  { immediate: true },
)
const readyStatus = computed(() => (ready.value ? readinessStatus(ready.value, readyHistory.value) : null))
async function saveReady(v: Omit<Readiness, 'client_id' | 'day'>) {
  savingReady.value = true
  try {
    ready.value = await sport.saveReadiness({ ...v, client_id: d.value!.client_id, day: plToday })
    askingReady.value = false
  } finally {
    savingReady.value = false
  }
}
const LIGHT_CLS = { green: 'bg-success-soft text-success', yellow: 'bg-warn-soft text-warn-fg', red: 'bg-danger-soft text-danger' } as const
// Metronom tempa dla wybranego ćwiczenia (tempo i liczba powtórzeń z planu).
const metro = ref<{ tempo: string | null; reps: number | null; title: string } | null>(null)
function openMetro(e: NonNullable<typeof d.value>['exercises'][number]) {
  const reps = Number(String(e.target.reps ?? '').match(/\d+/)?.[0]) || null
  metro.value = { tempo: e.target.tempo ?? null, reps, title: ex.byId(e.exercise_id)?.name_pl ?? '' }
}
const finishing = ref(false)
const saving = ref(false)
const result = ref<'' | 'synced' | 'queued'>('')
const armedDiscard = ref(false)

onMounted(() => Promise.all([ex.load().catch(() => null), clients.load().catch(() => null)]))

// ===== Zegar sesji i timer przerwy =====
const now = ref(Date.now())
const tick = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(tick))
const elapsed = computed(() => {
  if (!d.value) return '0:00'
  const s = Math.floor((now.value - new Date(d.value.started_at).getTime()) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
const restUntil = ref<number | null>(null)
const restLeft = computed(() => (restUntil.value ? Math.max(0, Math.ceil((restUntil.value - now.value) / 1000)) : 0))
watch(restLeft, (v, old) => {
  if (old > 0 && v === 0) {
    restUntil.value = null
    navigator.vibrate?.([200, 100, 200])
  }
})
const fmtRest = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// ===== Serie =====
function toggleSet(e: LiveExercise, i: number) {
  const s = e.sets[i]
  s.done = !s.done
  // Superseria: przerwa dopiero po ostatnim ćwiczeniu z grupy.
  const list = d.value!.exercises
  const idx = list.indexOf(e)
  const nextInGroup = e.group_label && list[idx + 1]?.group_label === e.group_label
  if (s.done && !nextInGroup && e.target.rest_sec) restUntil.value = Date.now() + e.target.rest_sec * 1000
}
function addSet(e: LiveExercise) {
  const last = e.sets.at(-1)
  e.sets.push({ reps: last?.reps ?? null, load_kg: last?.load_kg ?? null, rpe: null, done: false })
}
const removeSet = (e: LiveExercise) => e.sets.length > 1 && e.sets.pop()
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

function swap(e: LiveExercise, exerciseId: string) {
  e.exercise_id = exerciseId
}
function addExercise(id: string) {
  picking.value = false
  d.value!.exercises.push(live.newExercise(id))
}
const removeExercise = (e: LiveExercise) => (d.value!.exercises = d.value!.exercises.filter((x) => x !== e))

const doneSets = computed(() => d.value?.exercises.reduce((t, e) => t + e.sets.filter((s) => s.done).length, 0) ?? 0)
const totalSets = computed(() => d.value?.exercises.reduce((t, e) => t + e.sets.length, 0) ?? 0)
const warn = (exerciseId: string) => (ex.byId(exerciseId)?.contraindications ?? []).filter((c) => client.value?.limitations.includes(c))

// ===== Zakończenie =====
function draftSummary() {
  const lines = d.value!.exercises
    .map((e) => {
      const done = e.sets.filter((s) => s.done)
      if (!done.length) return null
      const best = Math.max(...done.map((s) => s.load_kg ?? 0))
      return `• ${ex.byId(e.exercise_id)?.name_pl}: ${done.length} × ${done.map((s) => s.reps ?? '–').join('/')}${best ? ` (do ${fmtKg(best)})` : ''}`
    })
    .filter(Boolean)
  return `Dzisiaj zrobiliśmy:\n${lines.join('\n')}\n\nNa co uważać: `
}
function openFinish() {
  if (!d.value!.summary) d.value!.summary = draftSummary()
  d.value!.duration_min ??= Math.max(1, Math.round((Date.now() - new Date(d.value!.started_at).getTime()) / 60000))
  finishing.value = true
}
async function finish() {
  finishedClientId.value = d.value!.client_id
  saving.value = true
  const synced = await live.finish(props.id).catch(() => false)
  saving.value = false
  result.value = synced ? 'synced' : 'queued'
}
function discard() {
  if (!armedDiscard.value) return (armedDiscard.value = true)
  live.discard(props.id)
  router.replace('/grafik')
}
</script>

<template>
  <main v-if="result" class="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
    <Icon :name="result === 'synced' ? 'check' : 'clock'" class="size-14" :class="result === 'synced' ? 'text-success' : 'text-warn-fg'" />
    <h1 class="page-title">{{ result === 'synced' ? 'Sesja zapisana' : 'Zapisana na telefonie' }}</h1>
    <p class="max-w-xs text-muted">
      {{ result === 'synced' ? 'Log trafił do historii klienta. Podsumowanie zatwierdzisz na jego karcie.' : 'Brak zasięgu – wyślę ją automatycznie, gdy wróci internet. Możesz zamknąć ten ekran.' }}
    </p>
    <RouterLink v-if="client" :to="`/klienci/${client.id}`" class="btn-primary mt-2">Karta klienta</RouterLink>
    <RouterLink to="/grafik" class="btn-ghost">Grafik</RouterLink>
  </main>

  <main v-else-if="saving" class="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center" role="status">
    <Icon name="clock" class="size-12 text-muted" />
    <p class="page-title">Zapisywanie…</p>
    <p class="text-muted">Bez zasięgu sesja zostanie na telefonie i wyśle się później.</p>
  </main>

  <main v-else-if="d" class="pb-32">
    <header class="page-header flex items-center gap-2 border-b border-line px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć (sesja zostaje zapisana)" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <div class="min-w-0 flex-1">
        <p class="truncate font-display text-xl leading-tight font-bold">{{ client?.full_name ?? 'Sesja' }}</p>
        <p class="truncate text-xs text-muted">
          {{ d.workout_name ?? 'Trening bez planu' }} · <span class="tabular-nums">{{ elapsed }}</span> · {{ doneSets }}/{{ totalSets }} serii
        </p>
      </div>
      <span v-if="!live.online" class="tag !bg-warn-soft !text-warn-fg">offline</span>
    </header>

    <div class="space-y-3 px-3 pt-3">
      <p v-if="client?.limitations.length" class="warn-box">
        <Icon name="alert" class="size-5 shrink-0" />
        <span>Ograniczenia: {{ client.limitations.map((l) => label(CONTRAINDICATIONS, l)).join(', ') }}</span>
      </p>

      <section v-if="isAthlete" class="card p-3">
        <div class="flex flex-wrap items-center gap-2">
          <p class="font-semibold">Gotowość</p>
          <template v-if="readyStatus">
            <span class="rounded-full px-2.5 py-0.5 text-sm font-bold" :class="LIGHT_CLS[readyStatus.light]">{{ readyStatus.score }}/100 · {{ LIGHT_LABEL[readyStatus.light] }}</span>
            <span v-if="readyStatus.reasons.length" class="text-sm text-muted">{{ readyStatus.reasons.join(' · ') }}</span>
          </template>
          <span v-else class="text-sm text-muted">brak ankiety na dziś</span>
          <button class="ml-auto text-sm font-semibold text-primary-fg underline" @click="askingReady = !askingReady">{{ ready ? 'Popraw' : 'Wypełnij teraz' }}</button>
        </div>
        <ReadinessForm v-if="askingReady" class="mt-3" :initial="ready ?? undefined" :busy="savingReady" @submit="saveReady" />
      </section>

      <section v-for="(e, ei) in d.exercises" :key="e.key" class="card p-3" :class="e.group_label ? 'border-l-4 !border-l-primary' : ''">
        <div class="mb-2 flex items-start gap-3">
          <ExerciseThumb v-if="ex.byId(e.exercise_id)" :exercise="ex.byId(e.exercise_id)!" />
          <div class="min-w-0 flex-1">
            <p class="font-semibold leading-tight">
              <span v-if="e.group_label" class="mr-1 rounded bg-primary px-1.5 text-xs font-semibold text-on-primary">{{ e.group_label }}</span>
              {{ ex.byId(e.exercise_id)?.name_pl ?? '…' }}
            </p>
            <p class="text-xs text-muted">
              Plan: {{ [e.target.sets && e.target.reps ? `${e.target.sets} × ${e.target.reps}` : e.target.reps, e.target.load, e.target.rpe ? `RPE ${e.target.rpe}` : null].filter(Boolean).join(' · ') || '—' }}
            </p>
            <p v-if="e.target.notes" class="text-xs text-muted italic">{{ e.target.notes }}</p>
            <button type="button" class="mt-1 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs font-semibold" @click="openMetro(e)">
              <Icon name="clock" class="size-3.5" />{{ e.target.tempo ? `Tempo ${e.target.tempo}` : 'Metronom' }}
            </button>
            <p v-if="warn(e.exercise_id).length" class="mt-1 flex items-center gap-1 text-xs font-semibold text-warn-fg">
              <Icon name="alert" class="size-3.5" />przeciwwskazanie: {{ warn(e.exercise_id).map((w) => label(CONTRAINDICATIONS, w)).join(', ') }}
            </p>
          </div>
          <button class="icon-btn -mt-1 -mr-1 text-subtle hover:text-danger" :aria-label="`Usuń ${ex.byId(e.exercise_id)?.name_pl ?? 'ćwiczenie'} z sesji`" @click="removeExercise(e)"><Icon name="x" class="size-4" /></button>
        </div>

        <div class="grid grid-cols-[2rem_1fr_1fr_3rem] items-center gap-2 text-xs text-muted">
          <span class="text-center">#</span><span>Powt.</span><span>kg</span><span />
        </div>
        <div v-for="(s, i) in e.sets" :key="i" class="mt-1 grid grid-cols-[2rem_1fr_1fr_3rem] items-center gap-2">
          <span class="text-center font-display text-lg font-bold text-muted">{{ i + 1 }}</span>
          <input
            :value="s.reps ?? ''"
            inputmode="decimal"
            class="input !min-h-12 text-center text-lg font-semibold tabular-nums"
            :aria-label="`Seria ${i + 1}: powtórzenia`"
            @input="s.reps = num(($event.target as HTMLInputElement).value)"
          />
          <input
            :value="s.load_kg ?? ''"
            inputmode="decimal"
            class="input !min-h-12 text-center text-lg font-semibold tabular-nums"
            :aria-label="`Seria ${i + 1}: ciężar w kg`"
            @input="s.load_kg = num(($event.target as HTMLInputElement).value)"
          />
          <button
            class="pressable flex size-12 items-center justify-center rounded-xl border-2"
            :class="s.done ? 'border-success bg-success text-white' : 'border-line-strong text-subtle'"
            :aria-pressed="s.done"
            :aria-label="`Seria ${i + 1} ${s.done ? 'zrobiona' : 'do zrobienia'}`"
            @click="toggleSet(e, i)"
          >
            <Icon name="check" class="size-6" />
          </button>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <button class="btn-ghost !min-h-10 flex-1 text-sm" @click="addSet(e)"><Icon name="plus" class="size-4" />Seria</button>
          <button class="btn-ghost !min-h-10 text-sm" :disabled="e.sets.length <= 1" aria-label="Usuń ostatnią serię" @click="removeSet(e)">−</button>
        </div>
        <div v-if="ex.regressionsOf(e.exercise_id).length || ex.progressionsOf(e.exercise_id).length" class="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none]">
          <button v-for="rid in ex.regressionsOf(e.exercise_id)" :key="'r' + rid" class="chip-off !min-h-10 text-sm" @click="swap(e, rid)">
            <Icon name="down" class="mr-1 size-4" />{{ ex.byId(rid)?.name_pl }}
          </button>
          <button v-for="pid in ex.progressionsOf(e.exercise_id)" :key="'p' + pid" class="chip-off !min-h-10 text-sm" @click="swap(e, pid)">
            <Icon name="up" class="mr-1 size-4" />{{ ex.byId(pid)?.name_pl }}
          </button>
        </div>
        <span class="sr-only">Ćwiczenie {{ ei + 1 }} z {{ d.exercises.length }}</span>
      </section>

      <button class="btn-ghost w-full" @click="picking = true"><Icon name="plus" class="size-5" />Dodaj ćwiczenie</button>

      <label class="block">
        <span class="label">Notatki z sesji (tylko dla Ciebie)</span>
        <textarea v-model="d.notes" rows="3" class="input py-2" placeholder="np. kolano lepiej, w przysiadzie skrócić zakres" />
      </label>

      <div class="grid grid-cols-2 gap-2 pt-2">
        <button :class="armedDiscard ? 'btn-danger' : 'btn-ghost'" @click="discard">{{ armedDiscard ? 'Na pewno odrzucić?' : 'Odrzuć sesję' }}</button>
        <button class="btn-primary" @click="openFinish"><Icon name="check" class="size-5" />Zakończ</button>
      </div>
    </div>

    <!-- Timer przerwy – nad dolnym paskiem, zawsze w zasięgu kciuka -->
    <div
      v-if="restLeft > 0"
      class="fixed inset-x-3 z-20 flex items-center gap-3 rounded-2xl bg-fg p-3 text-bg shadow-2xl"
      style="bottom: calc(1rem + env(safe-area-inset-bottom))"
      role="timer"
      aria-live="off"
    >
      <Icon name="clock" class="size-6" />
      <span class="font-display text-3xl font-bold tabular-nums">{{ fmtRest(restLeft) }}</span>
      <span class="flex-1 text-sm">przerwa</span>
      <button class="rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-current" @click="restUntil! += 30000">+30 s</button>
      <button class="rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-current" @click="restUntil = null">Pomiń</button>
    </div>

    <TempoMetronome v-if="metro" :tempo="metro.tempo" :reps="metro.reps" :title="metro.title" @close="metro = null" />
    <ExercisePicker v-if="picking" title="Dodaj ćwiczenie" :limitations="client?.limitations" @pick="addExercise" @close="picking = false" />

    <div v-if="finishing" class="fixed inset-0 z-30 flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Zakończ sesję" @click.self="finishing = false" @keydown.esc="finishing = false">
      <div class="sheet space-y-4">
        <h2 class="text-2xl font-bold">Zakończ sesję</h2>
        <p class="text-sm text-muted">{{ doneSets }} z {{ totalSets }} serii · {{ elapsed }}</p>
        <label class="block">
          <span class="label">Podsumowanie dla klienta (szkic)</span>
          <textarea v-model="d.summary" rows="8" class="input py-2 text-sm" />
          <span class="mt-1 block text-xs text-muted">Klient zobaczy je dopiero po Twojej akceptacji na karcie klienta.</span>
        </label>
        <fieldset class="space-y-2">
          <legend class="label">RPE całej sesji (0–10) – jak ciężki był cały trening?</legend>
          <div class="grid grid-cols-11 gap-1">
            <button
              v-for="n in 11"
              :key="n - 1"
              type="button"
              class="min-h-11 rounded-lg border text-sm font-bold tabular-nums"
              :class="d.srpe === n - 1 ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface'"
              :aria-pressed="d.srpe === n - 1"
              :aria-label="`RPE ${n - 1}: ${CR10[n - 1]}`"
              @click="d.srpe = d.srpe === n - 1 ? null : n - 1"
            >
              {{ n - 1 }}
            </button>
          </div>
          <p class="text-xs text-muted">{{ d.srpe != null ? CR10[d.srpe] : 'Opcjonalnie – dla sportowców liczy obciążenie i ACWR.' }}</p>
          <label class="flex items-center gap-2 text-sm">
            Czas treningu
            <input v-model.number="d.duration_min" type="number" min="1" max="600" inputmode="numeric" class="input !min-h-10 w-20 text-center" />
            min
            <span v-if="d.srpe != null && d.duration_min" class="ml-auto text-muted tabular-nums">obciążenie {{ Math.round(d.srpe * d.duration_min) }}</span>
          </label>
        </fieldset>
        <div class="grid grid-cols-2 gap-2">
          <button class="btn-ghost" @click="finishing = false">Wróć</button>
          <button class="btn-primary" :disabled="saving" @click="finish">{{ saving ? 'Zapisywanie…' : 'Zapisz sesję' }}</button>
        </div>
      </div>
    </div>
  </main>

  <main v-else class="px-4 pt-10 text-center text-muted">
    Nie ma takiej sesji na tym urządzeniu.
    <RouterLink to="/grafik" class="btn-ghost mt-4">Grafik</RouterLink>
</main>
</template>
