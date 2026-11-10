<script setup lang="ts">
// Odtwarzacz analizy: wideo (jeśli jest) z nałożonym szkieletem albo sam szkielet,
// klatka po klatce, zwolnienie, oś z powtórzeniami, rysowanie linii i kątów na stopklatce.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BONES, LEFT, type Track } from '@/lib/pose/skeleton'
import type { StoredRep } from '@/stores/analysis'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ track: Track; videoUrl?: string | null; reps: StoredRep[]; flagged?: Set<number>; signal?: number[]; signalLabel?: string }>()

const wrap = ref<HTMLDivElement>()
const video = ref<HTMLVideoElement>()
const canvas = ref<HTMLCanvasElement>()
const time = ref(0)
const playing = ref(false)
const speed = ref(0.5)
const duration = computed(() => props.track.t.at(-1) ?? 0)
const dt = computed(() => 1 / (props.track.fps || 30))
const frame = computed(() => Math.max(0, Math.min(props.track.t.length - 1, Math.round(time.value / dt.value))))
const aspect = computed(() => `${props.track.width || 9} / ${props.track.height || 16}`)
const curRep = computed(() => props.reps.findIndex((r) => frame.value >= r.start && frame.value <= r.end))
const curAngle = computed(() => {
  const v = props.signal?.[frame.value]
  return v != null && Number.isFinite(v) ? Math.round(v) : null
})

// ---------- Rysowanie ----------
type Tool = 'none' | 'line' | 'angle'
const tool = ref<Tool>('none')
const shapes = ref<{ kind: 'line' | 'angle'; pts: [number, number][] }[]>([])
const pending = ref<[number, number][]>([])

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#f97316'
}

function draw() {
  const c = canvas.value
  const w = wrap.value
  if (!c || !w) return
  const dpr = window.devicePixelRatio || 1
  const W = w.clientWidth
  const H = w.clientHeight
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
  }
  const g = c.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, W, H)
  const p = props.track.poses[frame.value]
  const lc = css('--chart-1')
  const rc = css('--div-neg')
  if (p) {
    g.lineCap = 'round'
    g.lineWidth = Math.max(3, W / 120)
    for (const [i, k] of BONES) {
      if (p[i].v < 0.3 || p[k].v < 0.3) continue
      g.strokeStyle = LEFT.has(i) && LEFT.has(k) ? lc : !LEFT.has(i) && !LEFT.has(k) ? rc : '#ffffff'
      g.globalAlpha = Math.min(p[i].v, p[k].v) < 0.5 ? 0.45 : 0.95
      g.beginPath()
      g.moveTo(p[i].x * W, p[i].y * H)
      g.lineTo(p[k].x * W, p[k].y * H)
      g.stroke()
    }
    g.globalAlpha = 1
    for (let i = 1; i < p.length; i++) {
      if (p[i].v < 0.3) continue
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.arc(p[i].x * W, p[i].y * H, Math.max(3, W / 110), 0, Math.PI * 2)
      g.fill()
      g.fillStyle = LEFT.has(i) ? lc : rc
      g.beginPath()
      g.arc(p[i].x * W, p[i].y * H, Math.max(2, W / 180), 0, Math.PI * 2)
      g.fill()
    }
  }
  // Rysunki trenerki
  g.strokeStyle = '#facc15'
  g.fillStyle = '#facc15'
  g.lineWidth = 3
  g.font = `600 ${Math.max(14, W / 28)}px Barlow, system-ui, sans-serif`
  for (const s of [...shapes.value, ...(pending.value.length ? [{ kind: tool.value as 'line' | 'angle', pts: pending.value }] : [])]) {
    const pts = s.pts.map(([x, y]) => [x * W, y * H] as [number, number])
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.stroke()
    for (const [x, y] of pts) {
      g.beginPath()
      g.arc(x, y, 5, 0, Math.PI * 2)
      g.fill()
    }
    if (s.kind === 'angle' && pts.length === 3) {
      const a = Math.atan2(pts[0][1] - pts[1][1], pts[0][0] - pts[1][0])
      const b = Math.atan2(pts[2][1] - pts[1][1], pts[2][0] - pts[1][0])
      let deg = Math.abs(((b - a) * 180) / Math.PI)
      if (deg > 180) deg = 360 - deg
      g.fillStyle = 'rgba(0,0,0,0.65)'
      g.fillRect(pts[1][0] + 10, pts[1][1] - 26, 64, 28)
      g.fillStyle = '#facc15'
      g.fillText(`${Math.round(deg)}°`, pts[1][0] + 16, pts[1][1] - 6)
    }
  }
}

function onCanvasClick(e: MouseEvent) {
  if (tool.value === 'none' || !wrap.value) return
  const r = wrap.value.getBoundingClientRect()
  pending.value.push([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height])
  const need = tool.value === 'line' ? 2 : 3
  if (pending.value.length === need) {
    shapes.value.push({ kind: tool.value, pts: pending.value })
    pending.value = []
  }
  draw()
}

// ---------- Odtwarzanie ----------
let raf = 0
let last = 0
function loop(now: number) {
  if (video.value && props.videoUrl) {
    time.value = video.value.currentTime
    if (video.value.ended) playing.value = false
  } else if (playing.value) {
    time.value += ((now - (last || now)) / 1000) * speed.value
    if (time.value >= duration.value) {
      time.value = duration.value
      playing.value = false
    }
  }
  last = now
  draw()
  raf = requestAnimationFrame(loop)
}

function setTime(t: number) {
  time.value = Math.max(0, Math.min(duration.value, t))
  if (video.value && props.videoUrl) video.value.currentTime = time.value
  draw()
}
function toggle() {
  if (playing.value) {
    playing.value = false
    video.value?.pause()
    return
  }
  shapes.value = []
  pending.value = []
  tool.value = 'none'
  if (time.value >= duration.value - dt.value) setTime(0)
  playing.value = true
  if (video.value && props.videoUrl) {
    video.value.playbackRate = speed.value
    video.value.play().catch(() => (playing.value = false))
  }
}
function step(n: number) {
  playing.value = false
  video.value?.pause()
  setTime((frame.value + n) * dt.value)
}
watch(speed, (s) => video.value && (video.value.playbackRate = s))
watch(tool, (t) => {
  pending.value = []
  if (t !== 'none' && playing.value) toggle()
})

function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
  if (e.key === 'ArrowLeft') step(-1)
  else if (e.key === 'ArrowRight') step(1)
  else if (e.key === ' ') {
    e.preventDefault()
    toggle()
  } else return
}
onMounted(() => {
  raf = requestAnimationFrame(loop)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', draw)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', draw)
})

const pct = (i: number) => `${(props.track.t[i] / (duration.value || 1)) * 100}%`
const fmt = (s: number) => s.toFixed(2).replace('.', ',')
defineExpose({ setTime, step })
</script>

<template>
  <div class="space-y-3">
    <div ref="wrap" class="relative mx-auto max-h-[62vh] w-full overflow-hidden rounded-2xl bg-black" :style="{ aspectRatio: aspect, maxWidth: `calc(62vh * ${track.width || 9} / ${track.height || 16})` }">
      <video v-if="videoUrl" ref="video" :src="videoUrl" class="absolute inset-0 size-full object-fill" playsinline muted preload="auto" @loadeddata="setTime(time)" />
      <div v-else class="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#2a2f37,#0b0d10)]" />
      <canvas ref="canvas" class="absolute inset-0 size-full" :class="tool !== 'none' ? 'cursor-crosshair' : ''" @click="onCanvasClick" />
      <div class="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5 text-xs font-semibold text-white">
        <span class="rounded-full bg-black/60 px-2 py-1 tabular-nums">{{ fmt(time) }} s · kl. {{ frame + 1 }}</span>
        <span v-if="curRep >= 0" class="rounded-full px-2 py-1" :class="flagged?.has(curRep + 1) ? 'bg-[var(--div-pos)]' : 'bg-black/60'">powt. {{ curRep + 1 }}</span>
        <span v-if="curAngle != null" class="rounded-full bg-black/60 px-2 py-1 tabular-nums">{{ signalLabel }} {{ curAngle }}°</span>
      </div>
      <p v-if="!videoUrl" class="pointer-events-none absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-1 text-[11px] text-white/80">sam szkielet – nagranie nie zostało zapisane</p>
    </div>

    <!-- Oś czasu z powtórzeniami -->
    <div class="relative h-9">
      <div class="absolute inset-x-0 top-3.5 h-2 rounded-full bg-surface-2" />
      <button
        v-for="(r, i) in reps"
        :key="i"
        type="button"
        class="absolute top-2 flex h-5 items-center justify-center rounded-md text-[10px] font-bold text-white"
        :class="flagged?.has(i + 1) ? 'bg-[var(--div-pos)]' : 'bg-[var(--ref-ink)]'"
        :style="{ left: pct(r.start), width: `calc(${pct(r.end)} - ${pct(r.start)})` }"
        :aria-label="`Powtórzenie ${i + 1}${flagged?.has(i + 1) ? ' (oznaczone)' : ''}`"
        @click="setTime(track.t[r.start])"
      >
        {{ i + 1 }}
      </button>
      <input
        type="range"
        class="absolute inset-x-0 top-0 h-9 w-full cursor-pointer opacity-0"
        :min="0"
        :max="duration"
        :step="dt"
        :value="time"
        aria-label="Pozycja w nagraniu"
        @input="(playing = false), video?.pause(), setTime(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="pointer-events-none absolute top-1 h-7 w-0.5 rounded-full bg-fg" :style="{ left: `${(time / (duration || 1)) * 100}%` }" />
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button class="icon-btn" aria-label="Klatka wstecz" @click="step(-1)"><Icon name="back" class="size-5" /></button>
      <button class="btn-primary !min-h-11 px-5" :aria-label="playing ? 'Pauza' : 'Odtwórz'" @click="toggle">{{ playing ? 'Pauza' : 'Odtwórz' }}</button>
      <button class="icon-btn" aria-label="Klatka dalej" @click="step(1)"><Icon name="chevron" class="size-5" /></button>
      <div class="ml-auto flex rounded-xl bg-surface-2 p-1" role="group" aria-label="Prędkość">
        <button v-for="s in [0.25, 0.5, 1]" :key="s" class="min-h-9 rounded-lg px-2.5 text-sm font-semibold" :class="speed === s ? 'bg-surface shadow' : 'text-muted'" @click="speed = s">
          {{ String(s).replace('.', ',') }}×
        </button>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-muted">Rysuj na stopklatce:</span>
      <button class="chip" :class="tool === 'line' ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface'" @click="tool = tool === 'line' ? 'none' : 'line'">Linia</button>
      <button class="chip" :class="tool === 'angle' ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface'" @click="tool = tool === 'angle' ? 'none' : 'angle'">Kąt</button>
      <button v-if="shapes.length" class="chip border-line-strong bg-surface" @click="(shapes = []), draw()">Wyczyść</button>
      <span v-if="tool !== 'none'" class="text-xs text-muted">{{ tool === 'line' ? 'Dotknij 2 punktów.' : 'Dotknij 3 punktów: ramię, wierzchołek, ramię.' }}</span>
    </div>
  </div>
</template>
