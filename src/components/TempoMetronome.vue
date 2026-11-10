<script setup lang="ts">
// Metronom tempa: słupki faz powtórzenia (w dół → pauza → w górę → pauza na górze) wypełniają się w zadanym czasie.
// Dźwięk i wibracja na zmianę fazy, licznik powtórzeń, odliczanie 3 s przed startem. Tempo z planu (np. "3-1-1-0") albo ustawiane ręcznie.
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ tempo?: string | null; reps?: number | null; title?: string | null }>()
const emit = defineEmits<{ close: [] }>()

/** "3-1-1-0", "3/1/1/0", "3110", "31X0" (X = dynamicznie) → sekundy faz. */
function parseTempo(t?: string | null): [number, number, number, number] | null {
  if (!t) return null
  const parts = (/[-/. ]/.test(t.trim()) ? t.trim().split(/[-/. ]+/) : t.trim().split('')).slice(0, 4)
  if (parts.length < 3) return null
  const n = parts.map((p) => (/^x$/i.test(p) ? 1 : Number(p.replace(',', '.'))))
  if (n.some((v) => !Number.isFinite(v) || v < 0 || v > 30)) return null
  return [n[0], n[1], n[2], n[3] ?? 0]
}

const init = parseTempo(props.tempo) ?? [3, 1, 1, 0]
const PHASES = [
  { key: 'down', label: 'W dół', hz: 440 },
  { key: 'hold', label: 'Pauza', hz: 587 },
  { key: 'up', label: 'W górę', hz: 880 },
  { key: 'top', label: 'Góra', hz: 587 },
] as const
const secs = reactive<number[]>([...init])
const target = ref<number>(props.reps && props.reps > 0 ? props.reps : 0) // 0 = bez limitu
const sound = ref(true)
const vibrate = ref(true)

const state = ref<'idle' | 'countdown' | 'running' | 'paused' | 'done'>('idle')
const phase = ref(0) // indeks fazy
const progress = ref(0) // 0..1 w bieżącej fazie
const rep = ref(0) // ukończone powtórzenia
const countdown = ref(3)
const repTime = computed(() => secs.reduce((s, v) => s + v, 0))
const tempoText = computed(() => secs.map((v) => String(v).replace('.', ',')).join('-'))
const active = computed(() => PHASES.map((p, i) => ({ ...p, i, sec: secs[i] })).filter((p) => p.sec > 0 || p.i !== 3))
const left = computed(() => Math.max(0, secs[phase.value] * (1 - progress.value)))

// ---------- Dźwięk (Web Audio – bez plików) ----------
let ctx: AudioContext | null = null
function beep(hz: number, ms = 110, gain = 0.25) {
  if (!sound.value) return
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = hz
    o.type = 'sine'
    g.gain.setValueAtTime(gain, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + ms / 1000)
  } catch {
    // brak dźwięku nie blokuje metronomu
  }
}
const buzz = (ms: number | number[]) =>
  vibrate.value && (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive !== false && navigator.vibrate?.(ms)

// ---------- Zegar ----------
let raf = 0
let phaseStart = 0 // performance.now() początku bieżącej fazy
let pausedAt = 0
let timer = 0
let wake: { release: () => Promise<void> } | null = null

function enter(i: number, at: number) {
  // pomijamy fazy o czasie 0
  let k = i
  for (let guard = 0; guard < 4 && secs[k % 4] <= 0; guard++) k++
  if (k >= 4) {
    rep.value++
    if (target.value && rep.value >= target.value) return finish()
    k = k % 4
    for (let guard = 0; guard < 4 && secs[k] <= 0; guard++) k = (k + 1) % 4
  }
  phase.value = k
  phaseStart = at
  progress.value = 0
  beep(PHASES[k].hz, k === 0 ? 160 : 110)
  buzz(k === 0 ? 60 : 30)
}
function tick(now: number) {
  if (state.value !== 'running') return
  const dur = secs[phase.value] * 1000
  if (now - phaseStart >= dur) enter(phase.value + 1, phaseStart + dur)
  if (state.value !== 'running') return
  progress.value = Math.min(1, (now - phaseStart) / (secs[phase.value] * 1000 || 1))
  raf = requestAnimationFrame(tick)
}
function start() {
  if (repTime.value <= 0) return
  rep.value = 0
  state.value = 'countdown'
  countdown.value = 3
  beep(330, 80)
  timer = window.setInterval(() => {
    countdown.value--
    if (countdown.value > 0) return beep(330, 80)
    clearInterval(timer)
    state.value = 'running'
    enter(0, performance.now())
    raf = requestAnimationFrame(tick)
  }, 1000)
  ;(navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    ?.request('screen')
    .then((w) => (wake = w))
    .catch(() => null)
}
function pause() {
  if (state.value === 'running') {
    state.value = 'paused'
    pausedAt = performance.now()
    cancelAnimationFrame(raf)
  } else if (state.value === 'paused') {
    phaseStart += performance.now() - pausedAt
    state.value = 'running'
    raf = requestAnimationFrame(tick)
  }
}
function finish() {
  state.value = 'done'
  progress.value = 1
  beep(880, 120)
  setTimeout(() => beep(1175, 260), 160)
  buzz([80, 60, 160])
  release()
}
function stop() {
  cancelAnimationFrame(raf)
  clearInterval(timer)
  state.value = 'idle'
  phase.value = 0
  progress.value = 0
  rep.value = 0
  release()
}
function release() {
  wake?.release().catch(() => null)
  wake = null
}
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearInterval(timer)
  release()
  ctx?.close().catch(() => null)
})
// Zmiana czasu fazy w trakcie nie może cofnąć słupka poza zakres.
watch(secs, () => state.value === 'idle' || (progress.value = Math.min(progress.value, 1)))

const busy = computed(() => state.value === 'running' || state.value === 'countdown' || state.value === 'paused')
const step = (i: number, d: number) => (secs[i] = Math.max(i === 1 || i === 3 ? 0 : 0.5, Math.min(15, Math.round((secs[i] + d) * 2) / 2)))
/** Wypełnienie słupka: fazy minione = pełne, bieżąca = postęp, przyszłe = puste. */
const fill = (i: number) => (state.value === 'done' ? 1 : state.value === 'idle' || state.value === 'countdown' ? 0 : i < phase.value ? 1 : i === phase.value ? progress.value : 0)
const fmt = (v: number) => String(v).replace('.', ',')
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[60] flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="mt-h" @click.self="!busy && emit('close')">
      <div class="sheet space-y-4 sm:max-w-md">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 id="mt-h" class="text-lg font-semibold">Metronom tempa</h2>
            <p class="truncate text-sm text-muted">{{ title ? `${title} · ` : '' }}tempo {{ tempoText }} · {{ fmt(repTime) }} s na powtórzenie</p>
          </div>
          <button type="button" class="icon-btn -m-2" aria-label="Zamknij metronom" @click="(stop(), emit('close'))"><Icon name="x" class="size-5" /></button>
        </div>

        <!-- Słupki faz -->
        <div class="relative">
          <div class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${active.length}, minmax(0, 1fr))` }" aria-hidden="true">
            <div v-for="p in active" :key="p.key" class="flex flex-col items-center gap-1.5">
              <div
                class="relative h-52 w-full overflow-hidden rounded-2xl border-2 bg-surface-2 transition-colors"
                :class="state === 'running' || state === 'paused' ? (p.i === phase ? 'border-primary' : 'border-transparent') : 'border-transparent'"
              >
                <!-- "W dół" wypełnia się od góry do dołu, pozostałe od dołu do góry – słupek idzie tak jak ciężar -->
                <div
                  class="absolute inset-x-0"
                  :class="[p.i === 0 ? 'top-0' : 'bottom-0', p.i === 1 || p.i === 3 ? 'bg-[var(--ref-ink)]' : 'bg-primary']"
                  :style="{ height: `${fill(p.i) * 100}%` }"
                />
                <span v-if="(state === 'running' || state === 'paused') && p.i === phase" class="absolute inset-0 flex items-center justify-center font-display text-5xl font-bold tabular-nums mix-blend-difference text-white">
                  {{ Math.ceil(left - 0.001) || 1 }}
                </span>
              </div>
              <p class="text-sm font-semibold" :class="(state === 'running' || state === 'paused') && p.i === phase ? 'text-primary-fg' : 'text-muted'">{{ p.label }}</p>
            </div>
          </div>
          <div v-if="state === 'countdown'" class="absolute inset-0 flex items-center justify-center rounded-2xl bg-scrim">
            <span class="font-display text-8xl font-bold text-white tabular-nums">{{ countdown }}</span>
          </div>
        </div>

        <p class="text-center" aria-live="polite">
          <span class="font-display text-5xl leading-none font-bold tabular-nums">{{ rep }}</span>
          <span v-if="target" class="font-display text-2xl text-muted tabular-nums"> / {{ target }}</span>
          <span class="block text-xs text-muted">
            {{ state === 'done' ? 'seria skończona' : state === 'paused' ? 'pauza' : state === 'running' ? PHASES[phase].label.toLowerCase() : 'powtórzeń' }}
          </span>
        </p>

        <!-- Ustawienia (zablokowane w trakcie) -->
        <div v-if="!busy" class="grid grid-cols-4 gap-2 text-center text-xs">
          <div v-for="(p, i) in PHASES" :key="p.key">
            <p class="text-muted">{{ p.label }}</p>
            <div class="mt-1 flex items-center justify-center gap-0.5">
              <button type="button" class="size-9 rounded-lg bg-surface-2 text-lg font-bold" :aria-label="`${p.label}: krócej`" @click="step(i, -0.5)">−</button>
              <span class="w-8 text-sm font-semibold tabular-nums">{{ fmt(secs[i]) }}</span>
              <button type="button" class="size-9 rounded-lg bg-surface-2 text-lg font-bold" :aria-label="`${p.label}: dłużej`" @click="step(i, 0.5)">+</button>
            </div>
          </div>
        </div>
        <div v-if="!busy" class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label class="flex items-center gap-2">
            Powtórzeń
            <input v-model.number="target" type="number" min="0" max="100" inputmode="numeric" class="input !min-h-10 w-16 text-center" aria-describedby="mt-rep" />
          </label>
          <span id="mt-rep" class="text-xs text-muted">0 = bez limitu</span>
          <label class="ml-auto flex min-h-10 cursor-pointer items-center gap-2"><input v-model="sound" type="checkbox" class="size-5 accent-primary" />Dźwięk</label>
          <label class="flex min-h-10 cursor-pointer items-center gap-2"><input v-model="vibrate" type="checkbox" class="size-5 accent-primary" />Wibracja</label>
        </div>

        <div class="grid gap-2" :class="busy ? 'grid-cols-2' : ''">
          <template v-if="busy">
            <button type="button" class="btn-ghost border border-line-strong" @click="stop">Stop</button>
            <button type="button" class="btn-primary" :disabled="state === 'countdown'" @click="pause">{{ state === 'paused' ? 'Wznów' : 'Pauza' }}</button>
          </template>
          <button v-else type="button" class="btn-primary w-full" :disabled="repTime <= 0" @click="start">{{ state === 'done' ? 'Jeszcze raz' : 'Start' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
