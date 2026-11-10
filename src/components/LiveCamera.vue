<script setup lang="ts">
// Kamera na żywo: szkielet nakładany na obraz w czasie rzeczywistym, licznik powtórzeń i kąt na bieżąco.
// "Start" → odliczanie 3 s (czas, żeby odejść od telefonu) → zapis szkieletu (+ wideo, jeśli przeglądarka umie)
// → "Stop" oddaje ścieżkę do tej samej analizy co film z galerii. Obraz nie wychodzi z telefonu.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { liveDetector, loadPose, MAX_SECONDS } from '@/lib/pose/extract'
import { drawSkeleton, fitCanvas } from '@/lib/pose/draw'
import { analyze } from '@/lib/pose/analysis'
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
const ar = ref('9 / 16') // proporcje obrazu z kamery – okno dopasowane, żeby szkielet leżał dokładnie na obrazie

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
      video: { facingMode: facing.value, width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30 } },
      audio: false,
    })
    const v = video.value!
    v.srcObject = stream
    await v.play()
    if (v.videoWidth && v.videoHeight) ar.value = `${v.videoWidth} / ${v.videoHeight}`
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
    const pose = detect(v)
    seen.value = !!pose
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
      track.value.poses.push(pose)
      elapsed.value = tt
      // Licznik powtórzeń na bieżąco (analiza całej dotychczasowej ścieżki co ~0,4 s – kilka ms).
      if (now - lastAnalyze > 400) {
        lastAnalyze = now
        const r = analyze(asTrack(), props.exercise)
        if (r.reps.length > reps.value) {
          bump.value = true
          setTimeout(() => (bump.value = false), 350)
          navigator.vibrate?.(60)
        }
        reps.value = r.reps.length
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
  openCamera()
})
onBeforeUnmount(stop)
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
</script>

<template>
  <div class="space-y-3">
    <div class="relative mx-auto w-full overflow-hidden rounded-2xl bg-black" :style="{ aspectRatio: ar, maxWidth: `min(28rem, calc(70vh * ${ar.replace(' / ', ' / ')}))` }">
      <video ref="video" class="absolute inset-0 size-full object-fill" :class="[mirror ? '-scale-x-100' : '', showVideo ? '' : 'opacity-0']" playsinline muted />
      <div v-if="!showVideo" class="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#2a2f37,#0b0d10)]" />
      <!-- Płótno w tych samych proporcjach co obraz kamery -->
      <canvas ref="canvas" class="absolute inset-0 size-full" />

      <div class="absolute top-2 left-2 flex flex-wrap gap-1.5 text-xs font-semibold text-white">
        <span v-if="state === 'recording'" class="flex items-center gap-1.5 rounded-full bg-[var(--div-pos)] px-2 py-1 tabular-nums">
          <span class="size-2 animate-pulse rounded-full bg-white" />{{ mmss(elapsed) }}
        </span>
        <span v-if="angle != null && state === 'recording'" class="rounded-full bg-black/60 px-2 py-1 tabular-nums">{{ signalName }} {{ angle }}°</span>
        <span v-if="state !== 'starting' && !seen" class="rounded-full bg-black/60 px-2 py-1">ustaw całą sylwetkę w kadrze</span>
      </div>
      <span v-if="fps && state !== 'starting'" class="absolute top-2 right-2 rounded-full bg-black/50 px-2 py-1 text-[10px] text-white/80 tabular-nums">{{ fps }} kl./s</span>

      <!-- Licznik powtórzeń -->
      <div v-if="state === 'recording' || state === 'finishing'" class="absolute right-0 bottom-3 left-0 flex justify-center">
        <div class="rounded-2xl bg-black/65 px-5 py-2 text-center text-white transition-transform" :class="bump ? 'scale-125' : ''" aria-live="polite">
          <p class="font-display text-6xl leading-none font-bold tabular-nums">{{ reps }}</p>
          <p class="text-xs">powtórzeń · {{ profile.name.toLowerCase() }}</p>
        </div>
      </div>
      <div v-if="state === 'countdown'" class="absolute inset-0 flex items-center justify-center bg-black/40">
        <span class="font-display text-8xl font-bold text-white tabular-nums">{{ countdown }}</span>
      </div>
      <div v-if="state === 'starting' && !error" class="absolute inset-0 flex items-center justify-center text-sm text-white/80">Uruchamianie kamery i modelu…</div>
      <div v-if="error" class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">{{ error }}</div>
    </div>

    <div class="grid grid-cols-[auto_1fr_auto] items-center gap-3">
      <button class="icon-btn border border-line-strong" aria-label="Zamknij kamerę" @click="(stop(), emit('cancel'))"><Icon name="x" class="size-5" /></button>
      <button v-if="state === 'recording' || state === 'finishing'" class="btn-danger" :disabled="state === 'finishing'" @click="finish">
        {{ state === 'finishing' ? 'Kończenie…' : 'Stop i analiza' }}
      </button>
      <button v-else class="btn-primary" :disabled="state !== 'ready'" @click="start">{{ state === 'countdown' ? 'Za chwilę…' : 'Start' }}</button>
      <button class="icon-btn border border-line-strong" aria-label="Przełącz kamerę (przód / tył)" :disabled="state === 'recording'" @click="flip"><Icon name="swap" class="size-5" /></button>
    </div>
    <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
      <input v-model="showVideo" type="checkbox" class="size-5 accent-primary" />Pokazuj obraz z kamery (wyłącz, żeby widzieć same kreski i kropki)
    </label>
    <p class="text-xs text-muted">Po „Start” masz 3 s, żeby odejść od telefonu. Obraz analizuje telefon – nic nie jest wysyłane, dopóki nie zapiszesz.</p>
  </div>
</template>
