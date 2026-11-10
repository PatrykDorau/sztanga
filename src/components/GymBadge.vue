<script setup lang="ts">
// Siłownia: kolorowa kropka (kolor z Google Calendar) + skrót tekstem – identyfikacja nie tylko kolorem.
import { computed } from 'vue'
import { useCalendarStore } from '@/stores/calendar'
import { GCAL_COLORS } from '@/lib/vocab'

const props = defineProps<{ gymId: string | null | undefined }>()
const cal = useCalendarStore()
const gym = computed(() => cal.gymById(props.gymId) ?? (props.gymId === undefined ? null : null))
</script>

<template>
  <span v-if="gym" class="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-semibold" :title="gym.name">
    <span class="size-2.5 rounded-full" :style="{ background: GCAL_COLORS[gym.color_id]?.hex }" aria-hidden="true" />
    {{ gym.code }}
  </span>
</template>
