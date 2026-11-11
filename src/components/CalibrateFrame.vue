<script setup lang="ts">
// Tryb kalibracji: jedna klatka nagrania z proponowanymi punktami – trenerka przeciąga je na właściwe miejsca
// (koniec sztangi, bark, łokieć, nadgarstek, biodro, kolano, kostka, pięta, palce) i wybiera stronę bliżej kamery.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Track } from '@/lib/pose/skeleton'
import type { Profile } from '@/lib/pose/profiles'
import { calibKeys, proposeCalib, type Calib, type CalibKey } from '@/lib/pose/calib'
import { fitCanvas } from '@/lib/pose/draw'

const props = defineProps<{ videoUrl: string; track: Track; profile: Profile; frame: number; side: 'L' | 'R' | null }>()
const emit = defineEmits<{ confirm: [Calib]; cancel: [] }>()

const NAMES: Record<CalibKey, string> = {
  bar: 'Sztanga',
  shoulder: 'Bark',
  elbow: 'Łokieć',
  wrist: 'Nadgarstek',
  hip: 'Biodro',
  knee: 'Kolano',
  ankle: 'Kostka',
  heel: 'Pięta',
  toe: 'Palce',
}
const CHAIN: [CalibKey, CalibKey][] = [
  ['shoulder', 'elbow'],
  ['elbow', 'wrist'],
  ['shoulder', 'hip'],
  ['hip', 'knee'],
  ['knee', 'ankle'],
  ['ankle', 'heel'],
  ['heel', 'toe'],
  ['ankle', 'toe'],
]

const frame = ref(props.frame)
const side = ref<'L' | 'R' | null>(props.side)
const calib = ref<Calib>(proposeCalib(props.track, props.profile, frame.value, side.value))
const keys = computed(() => calibKeys(props.profile, side.value))
const active = ref<CalibKey | null>(null)
const moved = ref(new Set<CalibKey>())

// Nowa klatka albo strona → nowa propozycja (punkty już przesunięte przez trenerkę zostają).
watch([frame, side], () => {
  const fresh = proposeCalib(props.track, props.profile, frame.value, side.value)
  for (const k of moved.value) if (calib.value.pts[k]) fresh.pts[k] = calib.value.pts[k]
  calib.value = fresh
  seekTo()
})

const wrap = ref<HTMLDivElement>()
const video = ref<HTMLVideoElement>()
const canvas = ref<HTMLCanvasElement>()
const aspect = computed(() => `${props.track.width || 9} / ${props.track.height || 16}`)
const nFrames = computed(() => props.track.t.length)

function seekTo() {
  const v = video.value
  if (v) v.currentTime = props.track.t[frame.value] ?? 0
}

function draw() {
  const c = canvas.value
  const w = wrap.value
  if (!c || !w) return
  const W = w.clientWidth
  const H = w.clientHeight
  const g = fitCanvas(c, W, H)
  const P = (k: CalibKey) => calib.value.pts[k]
  g.lineCap = 'round'
  g.lineWidth = Math.max(3, W / 120)
  g.strokeStyle = 'rgba(255,255,255,0.85)'
  for (const [a, b] of CHAIN) {
    const pa = P(a)
    const pb = P(b)
    if (!pa || !pb || !keys.value.includes(a) || !keys.value.includes(b)) continue
    g.beginPath()
    g.moveTo(pa[0] * W, pa[1] * H)
    g.lineTo(pb[0] * W, pb[1] * H)
    g.stroke()
  }
  for (const k of keys.value) {
    const p = P(k)
    if (!p) continue
    const r = k === 'bar' ? Math.max(11, W / 30) : Math.max(8, W / 45)
    g.beginPath()
    g.arc(p[0] * W, p[1] * H, r, 0, Math.PI * 2)
    g.fillStyle = k === 'bar' ? 'rgba(34,211,238,0.35)' : active.value === k ? '#facc15' : 'rgba(250,204,21,0.25)'
    g.fill()
    g.lineWidth = 3
    g.strokeStyle = k === 'bar' ? '#22d3ee' : '#facc15'
    g.stroke()
    if (k === 'bar') {
      g.beginPath()
      g.moveTo(p[0] * W - r * 1.6, p[1] * H)
      g.lineTo(p[0] * W + r * 1.6, p[1] * H)
      g.moveTo(p[0] * W, p[1] * H - r * 1.6)
      g.lineTo(p[0] * W, p[1] * H + r * 1.6)
      g.stroke()
    }
    // podpis
    const fs = Math.max(11, W / 34)
    g.font = `600 ${fs}px Barlow, system-ui, sans-serif`
    const t = NAMES[k]
    const tw = g.measureText(t).width
    const tx = Math.min(W - tw - 6, p[0] * W + r + 4)
    const ty = p[1] * H + fs * 0.35
    g.fillStyle = 'rgba(0,0,0,0.65)'
    g.fillRect(tx - 3, ty - fs, tw + 6, fs * 1.3)
    g.fillStyle = k === 'bar' ? '#22d3ee' : '#facc15'
    g.fillText(t, tx, ty)
  }
}

// ---------- Przeciąganie ----------
const at = (e: PointerEvent): [number, number] => {
  const r = wrap.value!.getBoundingClientRect()
  return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]
}
function nearest(q: [number, number]): CalibKey | null {
  const r = wrap.value!.getBoundingClientRect()
  let best: CalibKey | null = null
  let d = 36 // px – zasięg palca
  for (const k of keys.value) {
    const p = calib.value.pts[k]
    if (!p) continue
    const dd = Math.hypot((p[0] - q[0]) * r.width, (p[1] - q[1]) * r.height)
    if (dd < d) {
      d = dd
      best = k
    }
  }
  return best
}
let dragging = false
function onDown(e: PointerEvent) {
  const q = at(e)
  const k = nearest(q)
  if (!k) return
  e.preventDefault()
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  active.value = k
  dragging = true
}
function onMove(e: PointerEvent) {
  if (!dragging || !active.value) return
  calib.value.pts[active.value] = at(e)
  moved.value.add(active.value)
}
function onUp() {
  dragging = false
}
/** Klawiatura: wybrany punkt przesuwany strzałkami (dostępność, precyzja). */
function onKey(e: KeyboardEvent) {
  const k = active.value
  const p = k ? calib.value.pts[k] : null
  if (!k || !p) return
  const step = e.shiftKey ? 0.01 : 0.002
  const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  const m = d[e.key]
  if (!m) return
  e.preventDefault()
  calib.value.pts[k] = [p[0] + m[0], p[1] + m[1]]
  moved.value.add(k)
}

let raf = 0
const loop = () => {
  draw()
  raf = requestAnimationFrame(loop)
}
onMounted(() => {
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const SIDES: { v: 'L' | 'R' | null; label: string }[] = [
  { v: 'L', label: 'Lewa strona bliżej' },
  { v: 'R', label: 'Prawa strona bliżej' },
  { v: null, label: 'Z przodu / z tyłu' },
]
function confirm() {
  emit('confirm', { ...calib.value, frame: frame.value, side: side.value, pts: { ...calib.value.pts } })
}
</script>

<template>
  <section class="space-y-3">
    <div>
      <h2 class="text-xl font-bold">Kalibracja punktów</h2>
      <p v-if="!side" class="text-sm text-muted">
        Z przodu / z tyłu zaznaczasz tylko <strong class="text-[#0891b2] dark:text-[#22d3ee]">sztangę</strong> (jej charakterystyczny punkt – np. środek gryfu albo talerz) – stopy i długości
        kończyn poprawiamy tylko z boku.<template v-if="!profile.bar"> To ćwiczenie nie ma sztangi – kalibracja z przodu nic nie zmieni.</template>
      </p>
      <p v-else class="text-sm text-muted">
        Przeciągnij punkty na właściwe miejsca na tej klatce<template v-if="profile.bar"> – <strong class="text-[#0891b2] dark:text-[#22d3ee]">sztangę</strong> na środek końca sztangi (talerz, z boku)</template>. Potem
        stopy zostają w tym miejscu, a klatki, w których model „rozciągnie” kończynę, są poprawiane.
      </p>
    </div>
    <div class="flex flex-wrap gap-2" role="group" aria-label="Strona bliżej kamery">
      <button
        v-for="s in SIDES"
        :key="String(s.v)"
        type="button"
        class="chip"
        :class="side === s.v ? 'border-primary bg-primary font-semibold text-on-primary' : 'border-line-strong bg-surface'"
        :aria-pressed="side === s.v"
        @click="side = s.v"
      >
        {{ s.label }}
      </button>
    </div>
    <div
      ref="wrap"
      class="relative mx-auto max-h-[62vh] w-full touch-none overflow-hidden rounded-2xl bg-black outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :style="{ aspectRatio: aspect, maxWidth: `calc(62vh * ${track.width || 9} / ${track.height || 16})` }"
      tabindex="0"
      aria-label="Klatka do kalibracji – przeciągnij punkty; wybrany punkt przesuwasz strzałkami"
      @keydown="onKey"
    >
      <video ref="video" :src="videoUrl" class="absolute inset-0 size-full object-fill" playsinline muted preload="auto" @loadeddata="seekTo" />
      <canvas ref="canvas" class="absolute inset-0 size-full cursor-grab" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" />
    </div>
    <label class="block">
      <span class="label">Klatka (najlepiej stojąc, wszystko dobrze widać): {{ frame + 1 }} / {{ nFrames }}</span>
      <input v-model.number="frame" type="range" :min="0" :max="nFrames - 1" step="1" class="w-full accent-primary" />
    </label>
    <div class="flex flex-wrap gap-1.5 text-xs">
      <button
        v-for="k in keys"
        :key="k"
        type="button"
        class="rounded-full border px-2 py-1"
        :class="active === k ? 'border-primary bg-primary-soft font-semibold' : 'border-line-strong'"
        @click="(active = k), wrap?.focus()"
      >
        {{ NAMES[k] }}{{ moved.has(k) ? ' ✓' : '' }}
      </button>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <button class="btn-ghost border border-line-strong" @click="emit('cancel')">Bez kalibracji</button>
      <button class="btn-primary" @click="confirm">Zatwierdź punkty</button>
    </div>
  </section>
</template>
