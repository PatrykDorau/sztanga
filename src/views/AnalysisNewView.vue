<script setup lang="ts">
// Nowa analiza: klient + ćwiczenie → kamera na żywo albo nagranie (aparat / galeria) → szkielet klatka po klatce na telefonie
// → powtórzenia, pomiary, flagi → podgląd → zapis (szkielet zawsze, wideo tylko na życzenie, 90 dni).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useAnalysisStore, VIDEO_KEEP_DAYS } from '@/stores/analysis'
import { analyze, flagsFor, type AnalysisResult } from '@/lib/pose/analysis'
import { extractTrack, loadPose, loadVideo, MAX_SECONDS } from '@/lib/pose/extract'
import { packTrack, type Track } from '@/lib/pose/skeleton'
import { EXERCISE_KEYS, PROFILES, VIEW_LABEL, type ExerciseKey, type View } from '@/lib/pose/profiles'
import { compressVideo } from '@/lib/video'
import PosePlayer from '@/components/PosePlayer.vue'
import LiveCamera from '@/components/LiveCamera.vue'
import Icon from '@/components/Icon.vue'

const route = useRoute()
const router = useRouter()
const clients = useClientsStore()
const store = useAnalysisStore()

const clientId = ref(String(route.query.client ?? ''))
const ex = ref<ExerciseKey>((EXERCISE_KEYS as string[]).includes(String(route.query.ex)) ? (route.query.ex as ExerciseKey) : 'squat')
const viewChoice = ref<'auto' | View>('auto')
const profile = computed(() => PROFILES[ex.value])

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
const isRef = ref(false)
const keepVideo = ref(false)
const saving = ref(false)

onMounted(async () => {
  await clients.load()
  if (!store.loaded) store.load().catch(() => null)
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
    track.value = await extractTrack(video, (p) => (progress.value = p), abort.signal)
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
  track.value = tr
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = video ? URL.createObjectURL(video) : null
  file.value = video ? new File([video], `kamera.${video.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: video.type, lastModified: Date.now() }) : null
  rerun()
  stage.value = 'result'
}

function rerun() {
  if (!track.value) return
  result.value = analyze(track.value, ex.value, viewChoice.value === 'auto' ? undefined : viewChoice.value)
}

const flags = computed(() => (result.value ? flagsFor(ex.value, result.value.reps, store.thresholds) : []))
const flagged = computed(() => new Set(flags.value.flatMap((f) => f.reps)))
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
        exercise_id: null,
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
}
const signalLabel = computed(() => ({ knee: 'kolano', hip: 'biodro', elbow: 'łokieć' })[profile.value.signal])
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
        <div>
          <p class="label">Ćwiczenie</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="k in EXERCISE_KEYS"
              :key="k"
              type="button"
              class="chip"
              :class="ex === k ? 'border-primary bg-primary font-semibold text-on-primary' : 'border-line-strong bg-surface'"
              :disabled="stage !== 'pick'"
              @click="ex = k"
            >
              {{ PROFILES[k].name }}<span v-if="PROFILES[k].beta" class="ml-1 text-[10px] uppercase opacity-80">beta</span>
            </button>
          </div>
        </div>
        <p class="card flex gap-3 p-4 text-sm"><Icon name="video" class="size-5 shrink-0 text-primary-fg" />{{ profile.hint }}</p>

        <template v-if="stage === 'pick'">
          <button class="btn-primary w-full" @click="stage = 'live'"><Icon name="video" class="size-5" />Kamera na żywo</button>
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
        <PosePlayer :track="track" :video-url="url" :reps="result.reps" :flagged="flagged" :signal="result.signal" :signal-label="signalLabel" />

        <section class="grid grid-cols-2 gap-3">
          <div class="card p-4">
            <p class="font-display text-4xl leading-none font-bold tabular-nums">{{ result.reps.length }}</p>
            <p class="mt-1 text-sm text-muted">powtórzeń · {{ profile.name.toLowerCase() }}</p>
          </div>
          <div class="card p-4">
            <label class="text-sm text-muted" for="vw">Ujęcie</label>
            <select id="vw" v-model="viewChoice" class="input mt-1 !min-h-10" @change="rerun">
              <option value="auto">auto: {{ VIEW_LABEL[result.view] }}</option>
              <option value="front">z przodu</option>
              <option value="side">z boku</option>
              <option value="oblique">pod kątem</option>
            </select>
          </div>
        </section>
        <p v-if="coverage < 0.8" class="warn-box text-sm">
          <Icon name="alert" class="size-5 shrink-0" />Sylwetka widoczna tylko w {{ Math.round(coverage * 100) }}% klatek – lepiej nagrać z większej odległości, całą postać w kadrze.
        </p>
        <p v-if="!result.reps.length" class="warn-box text-sm">
          <Icon name="alert" class="size-5 shrink-0" />Nie wykryto powtórzeń. Sprawdź, czy wybrane ćwiczenie się zgadza i czy cała sylwetka jest w kadrze.
        </p>

        <section v-if="flags.length" class="space-y-2">
          <h2 class="text-lg font-bold">Do sprawdzenia</h2>
          <p v-for="f in flags" :key="f.key" class="flex items-start gap-2 text-sm"><Icon name="alert" class="mt-0.5 size-4 shrink-0 text-[var(--div-pos)]" />{{ f.text }}</p>
          <p class="text-xs text-muted">To wstępne wskazania na podstawie progów – decyzja należy do Ciebie.</p>
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
