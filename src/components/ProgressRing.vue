<script setup lang="ts">
// Pierścień postępu (ui-ux-pro-max, Fitness/Gym: "progress ring animations"). Wartość podana też tekstem – nie tylko kolorem.
import { computed } from 'vue'

const props = withDefaults(defineProps<{ value: number; max: number; size?: number; label?: string }>(), { size: 88 })
const R = 40
const C = 2 * Math.PI * R
const ratio = computed(() => Math.max(0, Math.min(1, props.max ? props.value / props.max : 0)))
</script>

<template>
  <div class="relative shrink-0" :style="{ width: size + 'px', height: size + 'px' }" role="img" :aria-label="label ?? `${value} z ${max}`">
    <svg viewBox="0 0 100 100" class="size-full -rotate-90" aria-hidden="true">
      <circle cx="50" cy="50" :r="R" fill="none" stroke-width="10" class="stroke-surface-2" />
      <circle
        cx="50"
        cy="50"
        :r="R"
        fill="none"
        stroke-width="10"
        stroke-linecap="round"
        :class="ratio >= 1 ? 'stroke-success' : 'stroke-primary'"
        :stroke-dasharray="C"
        :stroke-dashoffset="C * (1 - ratio)"
        style="transition: stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)"
      />
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center leading-none">
      <span class="font-display text-2xl font-bold tabular-nums">{{ value }}</span>
      <span class="text-[11px] text-muted">/ {{ max }}</span>
    </div>
  </div>
</template>
