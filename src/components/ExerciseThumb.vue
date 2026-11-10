<script setup lang="ts">
import type { Exercise } from '@/types'
import Icon from './Icon.vue'
defineProps<{ exercise: Exercise }>()
</script>

<template>
  <div class="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-subtle">
    <img v-if="exercise.image_url" :src="exercise.image_url" alt="" loading="lazy" class="size-full object-cover" />
    <Icon v-else name="dumbbell" class="size-6" />
    <span v-if="exercise.video_path" class="absolute right-1 bottom-1 rounded bg-black/60 p-0.5 text-white">
      <Icon name="video" class="size-3" />
    </span>
  </div>
</template>
