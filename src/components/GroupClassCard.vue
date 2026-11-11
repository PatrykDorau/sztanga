<script setup lang="ts">
// Zajęcia grupowe w grafiku – wyróżnione ikoną grupy; liczba uczestników albo przypomnienie, żeby ją wpisać.
import { computed } from 'vue'
import { hm } from '@/lib/dates'
import type { GroupClass } from '@/stores/groupClasses'
import GymBadge from './GymBadge.vue'
import Icon from './Icon.vue'

const props = defineProps<{ item: GroupClass }>()
defineEmits<{ open: [] }>()
const past = computed(() => new Date(props.item.ends_at) < new Date())
</script>

<template>
  <button class="card pressable flex w-full items-stretch gap-3 border-l-4 !border-l-primary p-3 text-left hover:bg-surface-2" :class="item.cancelled ? 'opacity-70' : ''" @click="$emit('open')">
    <div class="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-primary-soft py-1 text-primary-fg">
      <span class="font-display text-xl leading-none font-bold tabular-nums" :class="item.cancelled ? 'line-through' : ''">{{ hm(item.starts_at) }}</span>
      <span class="text-[11px] tabular-nums opacity-80">{{ hm(item.ends_at) }}</span>
    </div>
    <div class="min-w-0 flex-1 py-0.5">
      <p class="truncate font-semibold">{{ item.kind }}</p>
      <div class="mt-1 flex flex-wrap items-center gap-1.5">
        <span class="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary-fg"><Icon name="users" class="size-3" />Zajęcia grupowe</span>
        <span v-if="item.cancelled" class="tag !bg-danger/10 !text-danger">odwołane</span>
        <span v-else-if="item.participants != null" class="tag">{{ item.participants }} os.</span>
        <span v-else-if="past" class="tag !bg-warn-soft !text-warn-fg">wpisz liczbę osób</span>
        <GymBadge :gym-id="item.gym_id" />
        <span v-if="item.repeat_id" class="tag">co tydzień</span>
      </div>
    </div>
    <Icon name="chevron" class="size-5 self-center text-subtle" />
  </button>
</template>
