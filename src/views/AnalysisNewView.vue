<script setup lang="ts">
// Nowa analiza: klient + ćwiczenie → kamera na żywo albo nagranie (aparat / galeria) → szkielet klatka po klatce na telefonie
// → powtórzenia, pomiary, flagi → podgląd → zapis (szkielet zawsze, wideo tylko na życzenie, 90 dni).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useAnalysisStore, VIDEO_KEEP_DAYS } from '@/stores/analysis'
import { analyze, type AnalysisResult } from '@/lib/pose/analysis'
import { coach, storedFindings, type Finding } from '@/lib/pose/coaching'
import { smoothTrack } from '@/lib/pose/filter'
import { extractTrack, loadPose, loadVideo, MAX_SECONDS } from '@/lib/pose/extract'
import { packTrack, type Track } from '@/lib/pose/skeleton'
import { EXERCISE_KEYS, PROFILES, SIGNAL_LABEL, VIEW_CHOICES, VIEW_LABEL, type ExerciseKey, type View } from '@/lib/pose/profiles'
import { detectFamily, FAMILIES, FAMILY_KEYS, familyForProfile, familyOf, isFamily, type FamilyKey, type Guess } from '@/lib/pose/families'
import { searchExercises } from '@/lib/exerciseSearch'
import { useExercisesStore } from '@/stores/exercises'
import { compressVideo } from '@/lib/video'
import PosePlayer from '@/components/PosePlayer.vue'
import LiveCamera from '@/components/LiveCamera.vue'
import CoachingPanel from '@/components/CoachingPanel.vue'
import TempoPower from '@/components/TempoPower.vue'
import PatternCard from '@/components/PatternCard.vue'
import Icon from '@/components/Icon.vue'

const route = useRoute()
const router = useRouter()
const clients = useClientsStore()
const store = useAnalysisStore()
const exStore = useExercisesStore()

const clientId = ref(String(route.query.client ?? ''))
// Rodzina ruchu: „auto” = rozpoznanie z nagrania. Stare linki (?ex=deadlift) mapujemy na rodzinę.
const qEx = String(route.query.ex ?? '')
const famChoice = ref<'auto' | FamilyKey>(isFamily(qEx) ? qEx : (EXERCISE_KEYS as string[]).includes(qEx) ? familyForProfile(qEx as ExerciseKey) : 'auto')
const guesses = ref<Guess[]>([])
/** Rodzina użyta w analizie: wybrana albo rozpoznana. */
const family = computed<FamilyKey>(() => (famChoice.value === 'auto' ? (guesses.value[0]?.family ?? 'squat') : famChoice.value))
const ex = computed<ExerciseKey>(() => FAMILIES[family.value].profile)
const viewChoice = ref<'auto' | View>('auto')
const profile = computed(() => PROFILES[ex.value])

// Konkretne ćwiczenie z bazy (opcjonalnie) – ustawia rodzinę i sprzęt do wzorca, zapisuje się w analizie.
const exerciseId = ref<string | null>(route.query.exercise ? String(route.query.exercise) : null)
const exQuery = ref('')
const exercise = computed(() => (exerciseId.value ? exStore.byId(exerciseId.value) : null))
const exResults = computed(() => (exQuery.value.trim().length >= 2 ? searchExercises(exQuery.value, exStore.all).slice(0, 6) : []))
function pickExercise(id: string) {
  exerciseId.value = id
  exQuery.value = ''
  const f = exercise.value ? familyOf(exercise.value) : null
  if (f) famChoice.value = f
}
const recommendedView = computed(() => (famChoice.value === 'auto' ? null : FAMILIES[famChoice.value].view))

type Stage = 'pick' | 'live' | 'loading' | 'processing' | 'result'
const stage = ref<Stage>('pick')
const progress = ref(0)
const error = ref('')
const file = ref<File | null>(null)
const url = ref<string | null>(null)
const track = ref<Track | null>(null)
const result = ref<AnalysisResult | null>(null)
let abort: AbortController | null = null

const label = ref('')
const loadKg = ref<number | null>(null)
// Inne nagrania tej osoby z tym ćwiczeniem: ciężar i najszybsze powtórzenie (profil obciążenie–prędkość).
const lvHistory = computed(() =>
  store.list
    .filter((a) => a.exercise_key === ex.value && (a.client_id ?? '') === clientId.value && a.load_kg != null)
    .map((a) => ({ load: Number(a.load_kg), v: Math.max(0, ...a.reps.map((r) => r.metrics.mcv ?? 0)) }))
    .filter((p) => p.v > 0),
)
const isRef = ref(false)
const keepVideo = ref(false)
const saving = ref(false)

onMounted(async () => {
  await clients.load()
  if (!store.loaded) store.load().catch(() => null)
  exStore.load().then(() => exerciseId.value && pickExercise(exerciseId.value)).catch(() => null)
  isRef.value = !clientId.value
  // Model ładuje się w tle, zanim trenerka nagra.
  loadPose().catch(() => null)
})
onBeforeUnmount(() => {
  abort?.abort()
  if (url.value) URL.revokeObjectURL(url.value)
})

async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  error.value = ''
  file.value = f
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = URL.createObjectURL(f)
  stage.value = 'loading'
  progress.value = 0
  abort = new AbortController()
  try {
    const video = await loadVideo(url.value)
    await loadPose()
    stage.value = 'processing'
    track.value = smoothTrack(await extractTrack(video, (p) => (progress.value = p), abort.signal))
    rerun()
    stage.value = 'result'
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      stage.value = 'pick'
      return
    }
    error.value = (err as Error).message || 'Nie udało się przeanalizować nagrania.'
    stage.value = 'pick'
  }
}

/** Koniec nagrania z kamery na żywo – ta sama analiza co dla filmu. */
function onLive(tr: Track, video: Blob | null) {
  if (import.meta.env.DEV) Object.assign(window, { __live: { tr, video } })
  track.value = smoothTrack(tr)
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = video ? URL.createObjectURL(video) : null
  file.value = video ? new File([video], `kamera.${video.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: video.type, lastModified: Date.now() }) : null
  rerun()
  stage.value = 'result'
}

function rerun() {
  if (!track.value) return
  const forced = viewChoice.value === 'auto' ? undefined : viewChoice.value
  // Rozpoznanie ruchu: cechy z całego nagrania (serie kątów nie zależą od profilu), potem zawężone do powtórzeń.
  const base = analyze(track.value, 'squat', forced)
  guesses.value = detectFamily(base.series)
  let r = analyze(track.value, ex.value, forced)
  if (r.reps.length) {
    guesses.value = detectFamily(r.series, r.reps)
    if (famChoice.value === 'auto') r = analyze(track.value, ex.value, forced)
  }
  result.value = r
}
/** Ręczna zmiana rodziny po rozpoznaniu. */
function setFamily(f: FamilyKey) {
  famChoice.value = f
  rerun()
}
const guessPct = (f: FamilyKey) => Math.round((guesses.value.find((g) => g.family === f)?.score ?? 0) * 100)
// Wybrana rodzina wyraźnie nie pasuje do nagrania – ostrzeżenie z podpowiedzią.
const mismatch = computed(() => {
  if (famChoice.value === 'auto' || !guesses.value.length) return null
  const top = guesses.value[0]
  return top.family !== famChoice.value && top.score > 0.45 && guessPct(famChoice.value) < 15 ? top.family : null
})

const coaching = computed(() => (result.value && track.value ? coach(track.value, ex.value, result.value, store.thresholds) : null))
const flagged = computed(() => new Set(coaching.value?.findings.flatMap((f) => f.reps) ?? []))
// "Pokaż na nagraniu": klatka, na której błąd jest najwyraźniejszy, z podświetlonymi punktami.
const player = ref<InstanceType<typeof PosePlayer>>()
const shownFinding = ref<Finding | null>(null)
function showFinding(f: Finding) {
  shownFinding.value = f
  player.value?.showFrame(f.frame)
}
const detected = computed(() => track.value?.poses.filter(Boolean).length ?? 0)
const coverage = computed(() => (track.value?.poses.length ? detected.value / track.value.poses.length : 0))

async function save() {
  if (!track.value || !result.value) return
  saving.value = true
  error.value = ''
  try {
    const video = keepVideo.value && file.value ? await compressVideo(file.value).catch(() => file.value!) : undefined
    const row = await store.create(
      {
        client_id: clientId.value || null,
        exercise_key: ex.value,
        exercise_id: exerciseId.value,
        session_id: route.query.session ? String(route.query.session) : null,
        label: label.value.trim() || null,
        recorded_at: new Date(file.value?.lastModified || Date.now()).toISOString(),
        view: result.value.view,
        fps: track.value.fps,
        duration: track.value.t.at(-1) ?? 0,
        width: track.value.width,
        height: track.value.height,
        frames: await packTrack(track.value),
        reps: result.value.reps.map(({ start, bottom, end, view, metrics }) => ({ start, bottom, end, view, metrics })),
        is_reference: isRef.value,
        load_kg: loadKg.value,
        findings: coaching.value ? storedFindings(coaching.value) : [],
        notes: null,
      } as Parameters<typeof store.create>[0],
      video,
    )
    router.replace(`/analiza/${row.id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

function reset() {
  stage.value = 'pick'
  track.value = null
  result.value = null
  shownFinding.value = null
}
const signalLabel = computed(() => SIGNAL_LABEL[profile.value.signal])
</script>

<template>
  <main class="pb-10">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-2xl font-bold">Nowa analiza ruchu</h1>
    </header>

    <div class="space-y-5 px-4">
      <LiveCamera v-if="stage === 'live'" :exercise="ex" @done="onLive" @cancel="stage = 'pick'" />

      <template v-else-if="stage === 'pick' || stage === 'loading' || stage === 'processing'">
        <div>
          <label class="label" for="cl">Kto ćwiczy</label>
          <select id="cl" v-model="clientId" class="input" :disabled="stage !== 'pick'" @change="isRef = !clientId">
            <option value="">Ja (trenerka) – np. wzorzec</option>
            <option v-for="c in clients.all.filter((x) => !x.archived)" :key="c.id" :value="c.id">{{ c.full_name }}</option>
          </select>
        </div>
        <div class="space-y-2">
          <label class="label" for="exq">Ćwiczenie z bazy <span class="font-normal text-muted">(opcjonalnie)</span></label>
          <div v-if="exercise" class="flex items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm">
            <span class="min-w-0 flex-1 truncate font-semibold">{{ exercise.name_pl }}</span>
            <button type="button" class="icon-btn !size-8" aria-label="Usuń wybór ćwiczenia" :disabled="stage !== 'pick'" @click="exerciseId = null"><Icon name="x" class="size-4" /></button>
          </div>
          <template v-else>
            <input id="exq" v-model="exQuery" type="search" class="input" placeholder="np. bench press, przysiad, wiosłowanie…" :disabled="stage !== 'pick'" />
            <ul v-if="exResults.length" class="divide-y divide-line overflow-hidden rounded-xl border border-line">
              <li v-for="r in exResults" :key="r.id">
                <button type="button" class="w-full px-3 py-2 text-left text-sm hover:bg-surface-2" @click="pickExercise(r.id)">{{ r.name_pl }}</button>
              </li>
            </ul>
          </template>
        </div>
        <div>
          <label class="label" for="fam">Wzorzec ruchu</label>
          <select id="fam" v-model="famChoice" class="input" :disabled="stage !== 'pick'">
            <option value="auto">Rozpoznaj automatycznie z nagrania</option>
            <option v-for="k in FAMILY_KEYS" :key="k" :value="k">{{ FAMILIES[k].name }}</option>
          </select>
        </div>
        <div>
          <p class="label">Skąd nagrywasz</p>
          <div class="flex flex-wrap gap-2" role="group" aria-label="Ujęcie kamery">
            <button
              v-for="vw in ['auto', ...VIEW_CHOICES] as ('auto' | View)[]"
              :key="vw"
              type="button"
              class="chip"
              :class="viewChoice === vw ? 'border-primary bg-primary font-semibold text-on-primary' : 'border-line-strong bg-surface'"
              :aria-pressed="viewChoice === vw"
              :disabled="stage !== 'pick'"
              @click="viewChoice = vw"
            >
              {{ vw === 'auto' ? 'wykryj sama' : VIEW_LABEL[vw] }}<span v-if="vw === recommendedView" class="ml-1 text-[10px] uppercase opacity-80">zalecane</span>
            </button>
          </div>
          <p class="mt-1 text-xs text-muted">„Z tyłu” trzeba wskazać – z sylwetki nie da się odróżnić przodu od tyłu. Z tyłu mierzymy to samo co z przodu.</p>
        </div>
        <p class="card flex gap-3 p-4 text-sm">
          <Icon name="video" class="size-5 shrink-0 text-primary-fg" />{{ famChoice === 'auto' ? 'Cała sylwetka w kadrze, telefon nieruchomo, 2–3 m od ćwiczącego. Najczęściej najwięcej widać z boku.' : profile.hint }}
        </p>

        <template v-if="stage === 'pick'">
          <button class="btn-primary w-full" :disabled="famChoice === 'auto'" @click="stage = 'live'"><Icon name="video" class="size-5" />Kamera na żywo</button>
          <p v-if="famChoice === 'auto'" class="-mt-3 text-xs text-muted">Kamera na żywo liczy powtórzenia na bieżąco – wybierz wzorzec ruchu albo ćwiczenie. Nagranie filmu rozpozna ruch samo.</p>
          <div class="grid grid-cols-2 gap-3">
            <label class="btn-ghost cursor-pointer border border-line-strong">
              <Icon name="video" class="size-5" />Nagraj film
              <input type="file" accept="video/*" capture="environment" class="sr-only" @change="onFile" />
            </label>
            <label class="btn-ghost cursor-pointer border border-line-strong">
              <Icon name="download" class="size-5" />Z galerii
              <input type="file" accept="video/*" class="sr-only" @change="onFile" />
            </label>
          </div>
        </template>
        <p v-if="stage === 'pick'" class="text-xs text-muted">
          Nagranie analizuje telefon – nie jest wysyłane, dopóki sama nie zdecydujesz. Maks. {{ MAX_SECONDS }} s.
        </p>

        <div v-else class="card space-y-3 p-4" role="status">
          <p class="font-semibold">{{ stage === 'loading' ? 'Przygotowanie modelu…' : 'Rozpoznawanie sylwetki klatka po klatce…' }}</p>
          <div class="h-2 overflow-hidden rounded-full bg-surface-2">
            <div class="h-full rounded-full bg-primary transition-[width]" :style="{ width: `${Math.round(progress * 100)}%` }" />
          </div>
          <p class="text-sm text-muted tabular-nums">{{ Math.round(progress * 100) }}%<span v-if="stage === 'loading'"> · pierwsze uruchomienie pobiera model (ok. 9 MB)</span></p>
          <button class="btn-ghost w-full" @click="abort?.abort()">Przerwij</button>
        </div>
        <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      </template>

      <template v-else-if="result && track">
        <section class="grid grid-cols-2 gap-3">
          <div class="card p-4">
            <p class="font-display text-4xl leading-none font-bold tabular-nums">{{ result.reps.length }}</p>
            <p class="mt-1 text-sm text-muted">powtórzeń · {{ profile.name.toLowerCase() }}</p>
          </div>
          <div class="card p-4">
            <label class="text-sm text-muted" for="vw">Ujęcie</label>
            <select id="vw" v-model="viewChoice" class="input mt-1 !min-h-10" @change="rerun">
              <option value="auto">auto: {{ VIEW_LABEL[result.view] }}</option>
              <option v-for="vw in VIEW_CHOICES" :key="vw" :value="vw">{{ VIEW_LABEL[vw] }}</option>
            </select>
          </div>
        </section>

        <section v-if="guesses.length" class="card space-y-2 p-4">
          <p class="text-sm text-muted">{{ famChoice === 'auto' ? 'Rozpoznany ruch' : 'Analizowany ruch' }}</p>
          <p class="text-lg font-bold">
            {{ FAMILIES[family].name }}<span class="ml-2 text-sm font-normal text-muted">pewność {{ guessPct(family) }}%</span>
          </p>
          <p v-if="mismatch" class="warn-box text-sm">
            <Icon name="alert" class="size-5 shrink-0" />Ruch na nagraniu wygląda bardziej na: {{ FAMILIES[mismatch].name.toLowerCase() }}. Sprawdź wybrane ćwiczenie.
          </p>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-muted">To jednak:</span>
            <button v-for="g in guesses.filter((x) => x.family !== family).slice(0, 3)" :key="g.family" type="button" class="chip border-line-strong bg-surface" @click="setFamily(g.family)">
              {{ FAMILIES[g.family].name }} <span class="ml-1 text-muted tabular-nums">{{ Math.round(g.score * 100) }}%</span>
            </button>
            <select class="input !min-h-9 w-auto py-1 text-sm" aria-label="Wybierz inny wzorzec ruchu" :value="''" @change="setFamily(($event.target as HTMLSelectElement).value as FamilyKey)">
              <option value="" disabled>inny…</option>
              <option v-for="k in FAMILY_KEYS" :key="k" :value="k">{{ FAMILIES[k].name }}</option>
            </select>
          </div>
        </section>
        <p v-if="coverage < 0.8" class="warn-box text-sm">
          <Icon name="alert" class="size-5 shrink-0" />Sylwetka widoczna tylko w {{ Math.round(coverage * 100) }}% klatek – lepiej nagrać z większej odległości, całą postać w kadrze.
        </p>
        <p v-if="!result.reps.length" class="warn-box text-sm">
          <Icon name="alert" class="size-5 shrink-0" />Nie wykryto powtórzeń. Sprawdź, czy wybrane ćwiczenie się zgadza i czy cała sylwetka jest w kadrze.
        </p>

        <CoachingPanel v-if="coaching && result.reps.length" :coaching="coaching" :active="shownFinding?.key" @show="showFinding" />

        <PatternCard v-if="result.reps.length" :family="family" :series="result.series" :reps="result.reps" :equipment="exercise?.equipment" />

        <TempoPower v-if="result.reps.length" v-model:load-kg="loadKg" :exercise="ex" :reps="result.reps" :phases="profile.phases" :history="lvHistory" />

        <section class="space-y-2">
          <h2 class="text-xl font-bold">Nagranie</h2>
          <PosePlayer ref="player" :track="track" :video-url="url" :reps="result.reps" :flagged="flagged" :signal="result.signal" :signal-label="signalLabel" :highlight="shownFinding?.joints" />
        </section>

        <section class="card space-y-4 p-4">
          <div>
            <label class="label" for="lb">Opis (opcjonalnie)</label>
            <input id="lb" v-model="label" class="input" placeholder="np. 60 kg, po rozgrzewce" />
          </div>
          <label class="flex items-start gap-3 text-sm">
            <input v-model="isRef" type="checkbox" class="mt-0.5 size-5 accent-primary" />
            <span><strong>Wzorzec</strong> – z tym nagraniem będą porównywani klienci ({{ profile.name.toLowerCase() }}).</span>
          </label>
          <label class="flex items-start gap-3 text-sm">
            <input v-model="keepVideo" type="checkbox" class="mt-0.5 size-5 accent-primary" />
            <span><strong>Zachowaj też wideo</strong> na {{ VIDEO_KEEP_DAYS }} dni (prywatnie, tylko dla Ciebie). Domyślnie zapisuje się samo nagranie kresek i kropek z pomiarami – ok. {{ Math.max(1, Math.round(((track?.t.at(-1) ?? 0) / 60) * 220)) }} KB zamiast kilku MB wideo – i da się je odtwarzać, rysować po nim i porównywać.</span>
          </label>
          <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
          <div class="grid grid-cols-2 gap-3">
            <button class="btn-ghost border border-line-strong" :disabled="saving" @click="reset">Inne nagranie</button>
            <button class="btn-primary" :disabled="saving" @click="save">{{ saving ? 'Zapisywanie…' : 'Zapisz analizę' }}</button>
          </div>
        </section>
      </template>
    </div>
  </main>
</template>
