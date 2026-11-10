<script setup lang="ts">
// Kamera na żywo: szkielet nakładany na obraz w czasie rzeczywistym, licznik powtórzeń i kąt na bieżąco.
// "Start" → odliczanie 3 s (czas, żeby odejść od telefonu) → zapis szkieletu (+ wideo, jeśli przeglądarka umie)
// → "Stop" oddaje ścieżkę do tej samej analizy co film z galerii. Obraz nie wychodzi z telefonu.
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { liveDetector, loadPose, MAX_SECONDS } from '@/lib/pose/extract'
import { drawSkeleton, fitCanvas } from '@/lib/pose/draw'
import { analyze } from '@/lib/pose/analysis'
import { coach, repCue } from '@/lib/pose/coaching'
import { liveSmoother } from '@/lib/pose/filter'
import { useAnalysisStore } from '@/stores/analysis'
import { PROFILES, type ExerciseKey } from '@/lib/pose/profiles'
import type { Pose, Track } from '@/lib/pose/skeleton'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ exercise: ExerciseKey }>()
const emit = defineEmits<{ done: [track: Track, video: Blob | null]; cancel: [] }>()

const video = ref<HTMLVideoElement>()
const canvas = ref<HTMLCanvasElement>()
const facing = ref<'environment' | 'user'>('environment')
const state = ref<'starting' | 'ready' | 'countdown' | 'recording' | 'finishing'>('starting')
const error = ref('')
const countdown = ref(3)
const reps = ref(0)
const angle = ref<number | null>(null)
const elapsed = ref(0)
const fps = ref(0)
const bump = ref(false)
const seen = ref(false) // czy sylwetka jest w kadrze
const showVideo = ref(true) // wyłączony = same kreski i kropki na ciemnym tle
const store = useAnalysisStore()
// Uwaga do ostatniego powtórzenia (znika po kilku sekundach).
const cue = ref<{ text: string; ok: boolean } | null>(null)
let cueTimer = 0
// Okno obrazu: największy prostokąt w proporcjach kamery, który mieści się na ekranie.
const stage = ref<HTMLDivElement>()
const size = reactive({ sw: 0, sh: 0, vw: 9, vh: 16 })
const box = computed(() => {
  const a = size.vw / size.vh
  const w = Math.min(size.sw, size.sh * a)
  const h = w / a
  return { width: `${w}px`, height: `${h}px`, left: `${(size.sw - w) / 2}px`, top: `${(size.sh - h) / 2}px` }
})
let ro: ResizeObserver | null = null
let smoother = liveSmoother()

let stream: MediaStream | null = null
let detect: ((v: HTMLVideoElement) => Pose | null) | null = null
let raf = 0
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let recStart = 0
const track = shallowRef<{ t: number[]; poses: (Pose | null)[] }>({ t: [], poses: [] })
let lastAnalyze = 0
let lastProc = 0
let gen = 0 // numer otwarcia kamery – obiegi z poprzedniego otwarcia same się kończą
let frames = 0
let fpsT0 = 0

const profile = computed(() => PROFILES[props.exercise])
const signalName = computed(() => ({ knee: 'kolano', hip: 'biodro', elbow: 'łokieć' })[profile.value.signal])
const mirror = computed(() => facing.value === 'user')

async function openCamera() {
  stop()
  state.value = 'starting'
  error.value = ''
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'Insecure' })
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing.value, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    })
    const v = video.value!
    v.srcObject = stream
    await v.play()
    if (v.videoWidth && v.videoHeight) Object.assign(size, { vw: v.videoWidth, vh: v.videoHeight })
    smoother = liveSmoother()
    detect = liveDetector(await loadPose())
    state.value = 'ready'
    loop()
  } catch (e) {
    const name = (e as Error).name
    error.value =
      name === 'NotAllowedError'
        ? 'Brak zgody na kamerę. Zezwól w ustawieniach przeglądarki (ikona kłódki obok adresu).'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'Nie znaleziono kamery w tym urządzeniu.'
          : name === 'Insecure'
            ? 'Kamera działa tylko na bezpiecznym połączeniu (https).'
            : `Nie udało się uruchomić kamery: ${(e as Error).message}`
  }
}

function loop(g = gen) {
  if (g !== gen) return
  const v = video.value
  const c = canvas.value
  if (!v || !c || !detect) return
  // Maks. ~30 klatek na sekundę (ekran może odświeżać się 120–144 Hz; przy requestVideoFrameCallback
  // pętla i tak budzi się tylko na nowe klatki kamery).
  const nowT = performance.now()
  if (v.readyState >= 2 && nowT - lastProc >= 30) {
    lastProc = nowT
    const raw = detect(v)
    // Na ekranie: punkty ustabilizowane filtrem (nie skaczą); do analizy idzie surowy zapis, wygładzany po nagraniu bez opóźnienia.
    const pose = smoother(raw, nowT / 1000)
    seen.value = !!pose
    if (v.videoWidth && v.videoHeight && (v.videoWidth !== size.vw || v.videoHeight !== size.vh)) Object.assign(size, { vw: v.videoWidth, vh: v.videoHeight }) // obrót telefonu
    const W = c.clientWidth
    const H = c.clientHeight
    const g = fitCanvas(c, W, H)
    if (pose) drawSkeleton(g, pose, W, H, mirror.value)
    const now = performance.now()
    frames++
    if (now - fpsT0 > 1000) {
      fps.value = Math.round((frames * 1000) / (now - fpsT0))
      frames = 0
      fpsT0 = now
    }
    if (state.value === 'recording') {
      const tt = (now - recStart) / 1000
      track.value.t.push(tt)
      track.value.poses.push(raw)
      elapsed.value = tt
      // Licznik powtórzeń na bieżąco (analiza całej dotychczasowej ścieżki co ~0,4 s – kilka ms).
      if (now - lastAnalyze > 400) {
        lastAnalyze = now
        const r = analyze(asTrack(), props.exercise)
        if (r.reps.length > reps.value) {
          bump.value = true
          setTimeout(() => (bump.value = false), 350)
          if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) navigator.vibrate?.(60)
          // Krótka uwaga do właśnie skończonego powtórzenia.
          const n = r.reps.length
          const f = repCue(coach(asTrack(), props.exercise, r, store.thresholds), n)
          cue.value = f ? { text: `Powt. ${n}: ${f.short}`, ok: false } : { text: `Powt. ${n}: dobrze`, ok: true }
          clearTimeout(cueTimer)
          cueTimer = window.setTimeout(() => (cue.value = null), 4000)
        }
        reps.value = Math.max(reps.value, r.reps.length) // licznik nigdy się nie cofa
        const a = r.signal.at(-1)
        angle.value = a != null && Number.isFinite(a) ? Math.round(a) : null
      }
      if (tt >= MAX_SECONDS) finish()
    }
  }
  schedule(g)
}

/** Następny obieg: na nową klatkę kamery (Chrome, Safari 15.4+), a gdy przeglądarka tego nie umie – na odświeżenie ekranu. */
function schedule(g: number) {
  const v = video.value as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }) | undefined
  if (!stream) return
  if (v?.requestVideoFrameCallback) v.requestVideoFrameCallback(() => loop(g))
  else raf = requestAnimationFrame(() => loop(g))
}

function asTrack(): Track {
  const t = track.value.t
  const dur = t.at(-1) ?? 0
  return {
    fps: dur > 0 ? Math.max(5, Math.round(t.length / dur)) : 30,
    width: video.value?.videoWidth ?? 720,
    height: video.value?.videoHeight ?? 1280,
    t,
    poses: track.value.poses,
  }
}

/** Nagrywanie samego obrazu (bez dźwięku); kolejne formaty, aż któryś zadziała. Brak nagrania nie blokuje analizy. */
function startRecorder(): MediaRecorder | null {
  if (!stream || typeof MediaRecorder === 'undefined') return null
  const onlyVideo = new MediaStream(stream.getVideoTracks())
  for (const mimeType of ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm', '']) {
    if (mimeType && !MediaRecorder.isTypeSupported(mimeType)) continue
    try {
      const r = new MediaRecorder(onlyVideo, mimeType ? { mimeType, videoBitsPerSecond: 2_000_000 } : undefined)
      r.addEventListener('dataavailable', (e) => e.data.size && chunks.push(e.data))
      r.start(1000)
      return r
    } catch {
      // następny format
    }
  }
  return null
}

function start() {
  state.value = 'countdown'
  countdown.value = 3
  const id = setInterval(() => {
    countdown.value--
    if (countdown.value > 0) return
    clearInterval(id)
    track.value = { t: [], poses: [] }
    reps.value = 0
    cue.value = null
    chunks = []
    recorder = startRecorder()
    recStart = performance.now()
    state.value = 'recording'
  }, 1000)
}

async function finish() {
  if (state.value !== 'recording') return
  state.value = 'finishing'
  let blob: Blob | null = null
  if (recorder && recorder.state !== 'inactive') {
    blob = await new Promise<Blob | null>((res) => {
      recorder!.addEventListener('stop', () => res(chunks.length ? new Blob(chunks, { type: recorder!.mimeType }) : null), { once: true })
      recorder!.stop()
    })
  }
  const tr = asTrack()
  stop()
  emit('done', tr, blob)
}

function stop() {
  cancelAnimationFrame(raf)
  gen++
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

function flip() {
  facing.value = facing.value === 'user' ? 'environment' : 'user'
  openCamera()
}

onMounted(() => {
  fpsT0 = performance.now()
  if (!store.loaded) store.load().catch(() => null)
  ro = new ResizeObserver(([e]) => Object.assign(size, { sw: e.contentRect.width, sh: e.contentRect.height }))
  if (stage.value) ro.observe(stage.value)
  openCamera()
})
onBeforeUnmount(() => {
  stop()
  ro?.disconnect()
  clearTimeout(cueTimer)
})
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
</script>

<template>
  <!-- Pełny ekran: obraz z kamery tak duży, jak pozwala ekran (w całości, bez przycinania – szkielet leży dokładnie na obrazie) -->
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex flex-col bg-black text-white" role="dialog" aria-label="Kamera na żywo">
      <div ref="stage" class="relative min-h-0 flex-1">
        <div class="absolute overflow-hidden" :style="box">
          <video ref="video" class="absolute inset-0 size-full object-fill" :class="[mirror ? '-scale-x-100' : '', showVideo ? '' : 'opacity-0']" playsinline muted />
          <div v-if="!showVideo" class="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#2a2f37,#0b0d10)]" />
          <canvas ref="canvas" class="absolute inset-0 size-full" />
        </div>

        <div class="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 flex flex-wrap gap-1.5 pr-20 text-sm font-semibold">
          <span v-if="state === 'recording'" class="flex items-center gap-1.5 rounded-full bg-[var(--div-pos)] px-2.5 py-1 tabular-nums">
            <span class="size-2 animate-pulse rounded-full bg-white" />{{ mmss(elapsed) }}
          </span>
          <span class="rounded-full bg-black/60 px-2.5 py-1">{{ profile.name }}</span>
          <span v-if="angle != null && state === 'recording'" class="rounded-full bg-black/60 px-2.5 py-1 tabular-nums">{{ signalName }} {{ angle }}°</span>
          <span v-if="state !== 'starting' && !seen" class="rounded-full bg-amber-300 px-2.5 py-1 text-black">ustaw całą sylwetkę w kadrze</span>
        </div>
        <span v-if="fps && state !== 'starting'" class="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 rounded-full bg-black/50 px-2 py-1 text-[11px] text-white/80 tabular-nums">{{ fps }} kl./s</span>

        <!-- Uwaga do ostatniego powtórzenia -->
        <div v-if="state === 'recording' || state === 'finishing'" class="absolute inset-x-3 bottom-3 flex flex-col items-center gap-2">
          <p
            v-if="cue"
            class="max-w-md rounded-2xl px-4 py-2 text-center text-base leading-snug font-semibold text-white shadow-lg"
            :class="cue.ok ? 'bg-green-700' : 'bg-[var(--div-pos)]'"
            aria-live="assertive"
          >
            {{ cue.text }}
          </p>
        </div>
        <!-- Licznik w rogu, żeby nie zasłaniał stóp ani kolan -->
        <div
          v-if="state === 'recording' || state === 'finishing'"
          class="absolute top-[max(3.25rem,calc(env(safe-area-inset-top)+2.5rem))] right-3 origin-top-right rounded-2xl bg-black/65 px-4 py-2 text-center transition-transform"
          :class="bump ? 'scale-125' : ''"
          aria-live="polite"
        >
          <p class="font-display text-6xl leading-none font-bold tabular-nums">{{ reps }}</p>
          <p class="text-xs">powtórzeń</p>
        </div>
        <div v-if="state === 'countdown'" class="absolute inset-0 flex items-center justify-center bg-black/40">
          <span class="font-display text-[10rem] leading-none font-bold tabular-nums">{{ countdown }}</span>
        </div>
        <div v-if="state === 'starting' && !error" class="absolute inset-0 flex items-center justify-center text-sm text-white/80">Uruchamianie kamery i modelu…</div>
        <div v-if="error" class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm">{{ error }}</div>
      </div>

      <div class="space-y-2 bg-black px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div class="mx-auto grid max-w-md grid-cols-[auto_1fr_auto_auto] items-center gap-3">
          <button class="flex size-12 items-center justify-center rounded-full bg-white/15" aria-label="Zamknij kamerę" @click="(stop(), emit('cancel'))"><Icon name="x" class="size-6" /></button>
          <button v-if="state === 'recording' || state === 'finishing'" class="btn-danger" :disabled="state === 'finishing'" @click="finish">
            {{ state === 'finishing' ? 'Kończenie…' : 'Stop i analiza' }}
          </button>
          <button v-else class="btn-primary" :disabled="state !== 'ready'" @click="start">{{ state === 'countdown' ? 'Za chwilę…' : 'Start' }}</button>
          <button
            class="flex size-12 items-center justify-center rounded-full"
            :class="showVideo ? 'bg-white/15' : 'bg-white text-black'"
            :aria-label="showVideo ? 'Ukryj obraz – zostaw sam szkielet' : 'Pokaż obraz z kamery'"
            :aria-pressed="!showVideo"
            @click="showVideo = !showVideo"
          >
            <Icon name="user" class="size-6" />
          </button>
          <button class="flex size-12 items-center justify-center rounded-full bg-white/15 disabled:opacity-40" aria-label="Przełącz kamerę (przód / tył)" :disabled="state === 'recording'" @click="flip"><Icon name="swap" class="size-6" /></button>
        </div>
        <p class="text-center text-xs text-white/60">
          {{ state === 'recording' ? 'Po każdym powtórzeniu zobaczysz krótką uwagę. Pełne wnioski po „Stop”.' : 'Po „Start” masz 3 s, żeby odejść. Obraz analizuje to urządzenie – nic nie jest wysyłane, dopóki nie zapiszesz.' }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
