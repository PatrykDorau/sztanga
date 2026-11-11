<script setup lang="ts">
// Ostrzeżenie: w wybranym czasie coś już jest (Google Calendar, sesja, zajęcia). Sprawdzane na bieżąco przy zmianie terminu.
import { ref, watch } from 'vue'
import { conflictText, findConflicts, type Conflict, type Window } from '@/lib/conflicts'
import Icon from './Icon.vue'

const props = defineProps<{ windows: Window[]; ignoreId?: string | null }>()
const list = ref<Conflict[]>([])
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => JSON.stringify(props.windows),
  () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const s = ++seq
      const r = await findConflicts(props.windows, props.ignoreId).catch(() => [])
      if (s === seq) list.value = r
    }, 250)
  },
  { immediate: true },
)
defineExpose({ list })
</script>

<template>
  <div v-if="list.length" class="warn-box text-sm" role="alert">
    <Icon name="alert" class="size-5 shrink-0" />
    <div class="min-w-0">
      <p class="font-semibold">W tym czasie coś już jest:</p>
      <ul class="mt-1 space-y-0.5">
        <li v-for="c in list.slice(0, 5)" :key="c.starts_at + c.title">{{ conflictText(c) }}</li>
      </ul>
      <p v-if="list.length > 5" class="mt-1">…i jeszcze {{ list.length - 5 }}.</p>
      <p class="mt-1 text-xs">Możesz dodać mimo to.</p>
    </div>
  </div>
</template>
