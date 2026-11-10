<script setup lang="ts">
// Wynik analizy: odtwarzacz ze szkieletem, powtórzenia i flagi, porównanie ze wzorcem albo wcześniejszym nagraniem
// (sylwetka, tempo, heatmapa powtórzeń), poprawka liczby powtórzeń (kalibracja), wzorzec / nagranie / usuwanie.
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAnalysisStore, type AnalysisFull, type AnalysisRow } from '@/stores/analysis'
import { useClientsStore } from '@/stores/clients'
import { averageRep, PHASES, refStats, remeasure, summarize, zScore, type AvgRep, type P2, type RefStats } from '@/lib/pose/analysis'
import { coach, type Finding } from '@/lib/pose/coaching'
import { smoothTrack } from '@/lib/pose/filter'
import CoachingPanel from '@/components/CoachingPanel.vue'
import { unpackTrack, type Track } from '@/lib/pose/skeleton'
import { fmtMetric, PROFILES, VIEW_LABEL } from '@/lib/pose/profiles'
import { refStatsByExercise, shortDate, type HeatRow } from '@/lib/pose/heat'
import PosePlayer from '@/components/PosePlayer.vue'
import SkeletonCompare from '@/components/SkeletonCompare.vue'
import TimingBars from '@/components/TimingBars.vue'
import MetricHeatmap from '@/components/MetricHeatmap.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const store = useAnalysisStore()
const clients = useClientsStore()

const a = ref<AnalysisFull | null>(null)
const track = ref<Track | null>(null)
const videoUrl = ref<string | null>(null)
const error = ref('')
const busy = ref(false)

async function load() {
  error.value = ''
  try {
    await Promise.all([store.loaded ? null : store.load(), clients.load()])
    a.value = await store.get(props.id)
    track.value = smoothTrack(await unpackTrack(a.value.frames))
    videoUrl.value = a.value.video_path ? await store.videoUrl(a.value.video_path) : null
  } catch (e) {
    error.value = (e as Error).message
  }
}
onMounted(load)
watch(() => props.id, load)

const row = computed(() => store.list.find((x) => x.id === props.id) ?? a.value)
const profile = computed(() => (a.value ? PROFILES[a.value.exercise_key] : PROFILES.squat))
const who = computed(() => (a.value?.client_id ? (clients.byId(a.value.client_id)?.full_name ?? 'Klient') : 'Trenerka'))
// Pomiary liczone od nowa na zapisanych granicach powtórzeń – starsze analizy dostają też nowsze pomiary i uwagi.
const measured = computed(() => (track.value && a.value ? remeasure(track.value, a.value.exercise_key, a.value.reps, a.value.view) : null))
const reps = computed(() => measured.value?.reps ?? a.value?.reps ?? [])
const signal = computed(() => measured.value?.signal ?? [])
const coaching = computed(() => (track.value && a.value && measured.value ? coach(track.value, a.value.exercise_key, measured.value, store.thresholds) : null))
const flagged = computed(() => new Set(coaching.value?.findings.flatMap((f) => f.reps) ?? []))
const player = ref<InstanceType<typeof PosePlayer>>()
const shownFinding = ref<Finding | null>(null)
function showFinding(f: Finding) {
  shownFinding.value = f
  player.value?.showFrame(f.frame)
}
const details = ref(false)
const signalLabel = computed(() => ({ knee: 'kolano', hip: 'biodro', elbow: 'łokieć' })[profile.value.signal])

// ---------- Poprawka liczby powtórzeń (kalibracja licznika) ----------
const actual = ref<number | null>(null)
watch(a, (v) => (actual.value = v?.reps_actual ?? null))
async function setActual(n: number | null) {
  if (!a.value) return
  await store.update(a.value.id, { reps_actual: n })
  a.value.reps_actual = n
  actual.value = n
}

// ---------- Porównanie ----------
/** Cel porównania: 'ref' = wzorce, albo id innej analizy tego klienta (przed/po). */
const target = ref<string>('ref')
const others = computed(() =>
  store.list.filter((x) => x.id !== props.id && x.exercise_key === a.value?.exercise_key && x.client_id === a.value?.client_id && !!a.value?.client_id),
)
const refs = computed(() => store.list.filter((x) => x.id !== props.id && x.is_reference && x.exercise_key === a.value?.exercise_key))
watch(refs, (r) => {
  if (!r.length && others.value.length && target.value === 'ref') target.value = others.value[0].id
})

const targetRows = computed<AnalysisRow[]>(() => (target.value === 'ref' ? refs.value : store.list.filter((x) => x.id === target.value)))
const targetLabel = computed(() => {
  if (target.value === 'ref') return refs.value.length === 1 ? (refs.value[0].label ?? 'Wzorzec') : 'Wzorzec'
  const t = targetRows.value[0]
  return t ? `Nagranie z ${shortDate(t.recorded_at)}` : ''
})
const stats = computed<Record<string, RefStats>>(() =>
  target.value === 'ref' ? (refStatsByExercise(store.list, props.id)[a.value?.exercise_key ?? 'squat'] ?? {}) : refStats(targetRows.value.flatMap((x) => x.reps)),
)

const myAvg = computed(() => (track.value && reps.value.length ? averageRep(track.value, reps.value, profile.value) : null))
// Sylwetkę i tempo porównujemy z nagraniami z tego samego ujęcia (przód z przodem, bok z bokiem).
const shapeRows = computed(() => {
  const same = targetRows.value.filter((r) => r.view === a.value?.view)
  return same.length ? same : targetRows.value
})
const viewMismatch = computed(() => !!shapeRows.value.length && shapeRows.value.every((r) => r.view !== a.value?.view))
const targetAvg = ref<AvgRep | null>(null)
let loadSeq = 0
watch(
  [shapeRows, () => a.value?.id],
  async () => {
    const seq = ++loadSeq
    targetAvg.value = null
    const rows = shapeRows.value.slice(0, 5)
    if (!rows.length || !a.value) return
    const avgs = (
      await Promise.all(
        rows.map(async (r) => {
          const full = await store.get(r.id)
          return full.reps.length ? averageRep(await unpackTrack(full.frames), full.reps, PROFILES[full.exercise_key]) : null
        }),
      )
    ).filter((x): x is AvgRep => !!x)
    if (seq === loadSeq) targetAvg.value = mergeAvg(avgs)
  },
  { immediate: true },
)

/** Średnia z kilku uśrednionych powtórzeń (kilka wzorców). */
function mergeAvg(list: AvgRep[]): AvgRep | null {
  if (!list.length) return null
  if (list.length === 1) return list[0]
  const avg = (f: (r: AvgRep) => number) => list.reduce((s, r) => s + f(r), 0) / list.length
  return {
    frames: Array.from({ length: PHASES }, (_, ph) => list[0].frames[ph].map((_, j) => [avg((r) => r.frames[ph][j][0]), avg((r) => r.frames[ph][j][1])] as P2)),
    bottomPhase: avg((r) => r.bottomPhase),
    duration: avg((r) => r.duration),
    phases: { ecc: avg((r) => r.phases.ecc), pause: avg((r) => r.phases.pause), con: avg((r) => r.phases.con) },
  }
}

// ---------- Heatmapa powtórzeń ----------
const summary = computed(() => summarize(reps.value))
const group = computed(() => [{ key: profile.value.key, name: profile.value.name, metrics: profile.value.metrics }])
const cell = (v: number | null | undefined, key: string) => {
  const def = profile.value.metrics.find((m) => m.key === key)!
  const st = stats.value[key]
  return { value: v ?? null, ref: st?.mean ?? null, z: zScore(v, st, def.tol) }
}
const heatSections = computed(() => {
  const k = profile.value.key
  const mk = (id: string, label: string, m: Record<string, number | null>, sub?: string): HeatRow => ({
    id,
    label,
    sub,
    cells: Object.fromEntries(profile.value.metrics.map((d) => [`${k}.${d.key}`, cell(m[d.key], d.key)])),
  })
  return [
    { title: 'Średnio', rows: reps.value.length ? [mk('avg', who.value, summary.value, `${reps.value.length} powt.`)] : [] },
    { title: 'Powtórzenia', rows: reps.value.map((r, i) => mk(`r${i}`, `Powt. ${i + 1}`, r.metrics, flagged.value.has(i + 1) ? 'do sprawdzenia' : undefined)) },
  ]
})

// ---------- Akcje ----------
async function toggleRef() {
  if (!a.value) return
  const v = !a.value.is_reference
  await store.update(a.value.id, { is_reference: v })
  a.value.is_reference = v
}
async function saveNotes(e: Event) {
  if (!a.value) return
  const notes = (e.target as HTMLTextAreaElement).value.trim() || null
  if (notes === a.value.notes) return
  await store.update(a.value.id, { notes })
  a.value.notes = notes
}
async function dropVideo() {
  if (!a.value || !confirm('Usunąć nagranie wideo? Szkielet i pomiary zostaną.')) return
  busy.value = true
  await store.deleteVideo(a.value.id)
  a.value.video_path = null
  videoUrl.value = null
  busy.value = false
}
async function removeAll() {
  if (!a.value || !confirm('Usunąć analizę razem z pomiarami? Tego nie da się cofnąć.')) return
  await store.remove(a.value.id)
  router.replace(a.value.client_id ? `/klienci/${a.value.client_id}` : '/analiza')
}
const expires = computed(() => (a.value?.video_expires_at ? new Date(a.value.video_expires_at).toLocaleDateString('pl-PL') : null))
</script>

<template>
  <main class="pb-10">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <div class="min-w-0 flex-1">
        <h1 class="truncate font-display text-2xl font-bold">{{ who }} · {{ profile.name }}</h1>
        <p v-if="a" class="text-sm text-muted">
          {{ new Date(a.recorded_at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) }} · {{ VIEW_LABEL[a.view] }}<template v-if="a.label"> · {{ a.label }}</template>
        </p>
      </div>
    </header>

    <p v-if="error" class="px-4 text-sm text-danger" role="alert">{{ error }}</p>
    <p v-else-if="!a || !track" class="px-4 text-muted">Ładowanie…</p>

    <div v-else class="space-y-6 px-4">
      <CoachingPanel v-if="coaching && reps.length" :coaching="coaching" :active="shownFinding?.key" @show="showFinding" />

      <section class="space-y-2">
        <h2 class="text-xl font-bold">Nagranie</h2>
        <PosePlayer ref="player" :track="track" :video-url="videoUrl" :reps="reps" :flagged="flagged" :signal="signal" :signal-label="signalLabel" :highlight="shownFinding?.joints" />
      </section>

      <section class="card flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <div>
          <p class="font-display text-4xl leading-none font-bold tabular-nums">{{ reps.length }}</p>
          <p class="text-sm text-muted">wykryte powtórzenia</p>
        </div>
        <div class="ml-auto text-sm">
          <p class="mb-1 font-semibold">Zgadza się?</p>
          <div class="flex items-center gap-2">
            <button class="chip" :class="actual === reps.length ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface'" @click="setActual(reps.length)">Tak</button>
            <label class="flex items-center gap-1.5">
              <span class="text-muted">było</span>
              <input
                type="number"
                min="0"
                inputmode="numeric"
                class="input !min-h-10 w-16 text-center"
                :value="actual ?? ''"
                aria-label="Faktyczna liczba powtórzeń"
                @change="setActual(($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value))"
              />
            </label>
          </div>
        </div>
      </section>

      <button v-if="reps.length" type="button" class="btn-ghost w-full border border-line-strong" :aria-expanded="details" @click="details = !details">
        <Icon name="trend" class="size-5" />{{ details ? 'Zwiń dokładną analizę' : 'Dokładna analiza: porównanie ze wzorcem i pomiary' }}
      </button>

      <section v-if="reps.length && details" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-xl font-bold">Porównanie</h2>
          <select v-model="target" class="input !min-h-10 w-auto max-w-full text-sm" aria-label="Porównaj z">
            <option value="ref" :disabled="!refs.length">{{ refs.length ? `Wzorzec (${refs.length})` : 'Wzorzec – brak nagrań' }}</option>
            <option v-for="o in others" :key="o.id" :value="o.id">Przed/po: {{ shortDate(o.recorded_at) }}{{ o.label ? ` · ${o.label}` : '' }}</option>
          </select>
        </div>
        <p v-if="target === 'ref' && !refs.length" class="card p-4 text-sm text-muted">
          Nagraj siebie lub dobrze wykonującą osobę i zaznacz „Wzorzec” – wtedy pojawi się porównanie sylwetki, tempa i pomiarów.
          <RouterLink :to="`/analiza/nowa?ex=${profile.key}`" class="font-semibold text-primary-fg underline">Nagraj wzorzec</RouterLink>
        </p>
        <p v-if="viewMismatch" class="warn-box text-sm">
          <Icon name="alert" class="size-5 shrink-0" />Porównanie sylwetki z nagraniem z innego ujęcia ({{ VIEW_LABEL[shapeRows[0].view] }}) – nagraj wzorzec {{ VIEW_LABEL[a.view] }}, żeby było miarodajne.
        </p>
        <div class="grid gap-3 md:grid-cols-2">
          <SkeletonCompare v-if="myAvg" :a="myAvg" :b="targetAvg" :profile="profile" :a-label="`${who} – średnie powtórzenie`" :b-label="targetLabel" />
          <TimingBars v-if="myAvg" :a="myAvg.phases" :b="targetAvg?.phases" :a-label="who" :b-label="targetLabel" :phase-names="profile.phases" />
        </div>
        <MetricHeatmap :groups="group" :sections="heatSections" />
        <!-- Widok tabeli (dostępność + liczby wprost) -->
        <details class="card p-4 text-sm">
          <summary class="cursor-pointer font-semibold">Tabela pomiarów</summary>
          <table class="mt-3 w-full">
            <thead>
              <tr class="border-b border-line text-left text-xs text-muted">
                <th class="py-2 font-semibold">Pomiar</th>
                <th class="py-2 text-right font-semibold">{{ who }}</th>
                <th class="py-2 text-right font-semibold">{{ targetLabel || 'Wzorzec' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in profile.metrics" :key="m.key" class="border-b border-line last:border-0">
                <td class="py-2" :title="m.help">{{ m.label }}</td>
                <td class="py-2 text-right tabular-nums">{{ fmtMetric(m, summary[m.key]) }}</td>
                <td class="py-2 text-right text-muted tabular-nums">{{ fmtMetric(m, stats[m.key]?.mean) }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </section>

      <section class="card space-y-4 p-4">
        <label class="flex items-start gap-3 text-sm">
          <input type="checkbox" class="mt-0.5 size-5 accent-primary" :checked="row?.is_reference" @change="toggleRef" />
          <span><strong>Wzorzec</strong> – porównuj z tym nagraniem innych ({{ profile.name.toLowerCase() }}).</span>
        </label>
        <div>
          <label class="label" for="nt">Notatka</label>
          <textarea id="nt" rows="2" class="input py-2" :value="a.notes ?? ''" placeholder="np. poprawić ustawienie stóp" @blur="saveNotes" />
        </div>
        <p v-if="a.video_path" class="flex flex-wrap items-center gap-2 text-sm text-muted">
          Nagranie zapisane do {{ expires }}.
          <button class="font-semibold text-danger underline" :disabled="busy" @click="dropVideo">Usuń nagranie</button>
        </p>
        <button class="btn-danger w-full" @click="removeAll"><Icon name="trash" class="size-4" />Usuń analizę</button>
      </section>
    </div>
  </main>
</template>
