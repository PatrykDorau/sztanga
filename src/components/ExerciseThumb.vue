<script setup lang="ts">
// Miniatura ćwiczenia: zdjęcie z bazy, a gdy go brak – nieruchoma klatka wzorca ruchu (ludzik w punkcie zwrotnym).
import { computed } from 'vue'
import type { Exercise } from '@/types'
import { FAMILIES, familyOf, variantOf, type Fig, type P } from '@/lib/pose/families'
import Icon from './Icon.vue'

const props = defineProps<{ exercise: Exercise }>()
const fig = computed<Fig | null>(() => {
  if (props.exercise.image_url) return null
  const f = familyOf(props.exercise)
  return f ? FAMILIES[f].pose(0.7, variantOf(props.exercise.equipment)) : null
})
const box = computed(() => {
  if (!fig.value) return ''
  const pts = Object.values(fig.value).filter((v): v is P => Array.isArray(v))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs) - 0.15
  const x1 = Math.max(...xs) + 0.15
  const y0 = Math.min(0, ...ys) - 0.05
  const y1 = Math.max(...ys) + 0.2
  const w = Math.max(x1 - x0, y1 - y0)
  const cx = (x0 + x1) / 2
  return `${cx - w / 2} ${-y1} ${w} ${y1 - y0}`
})
const pl = (...ps: (P | undefined)[]) => ps.filter(Boolean).map((p) => `${p![0]},${-p![1]}`).join(' ')
</script>

<template>
  <div class="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-subtle">
    <img v-if="exercise.image_url" :src="exercise.image_url" alt="" loading="lazy" class="size-full object-cover" />
    <svg v-else-if="fig" :viewBox="box" class="size-full p-1" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="0.07" stroke-linecap="round" stroke-linejoin="round">
      <polyline v-if="fig.knee2" :points="pl(fig.hip2 ?? fig.hip, fig.knee2, fig.ankle2)" stroke-opacity="0.45" />
      <polyline v-if="fig.elbow2" :points="pl(fig.shoulder2 ?? fig.shoulder, fig.elbow2, fig.wrist2)" stroke-opacity="0.45" />
      <polyline :points="pl(fig.ankle, fig.knee, fig.hip, fig.shoulder)" class="text-fg" />
      <polyline :points="pl(fig.shoulder, fig.elbow, fig.wrist)" class="text-fg" />
      <circle :cx="fig.head[0]" :cy="-fig.head[1]" r="0.11" class="text-fg" />
    </svg>
    <Icon v-else name="dumbbell" class="size-6" />
    <span v-if="exercise.video_path" class="absolute right-1 bottom-1 rounded bg-black/60 p-0.5 text-white">
      <Icon name="video" class="size-3" />
    </span>
  </div>
</template>
