<script setup lang="ts">
import { computed } from 'vue'
import { hm } from '@/lib/dates'
import { SESSION_STATUSES, label } from '@/lib/vocab'
import type { Session } from '@/types'
import Icon from './Icon.vue'
import GymBadge from './GymBadge.vue'

const props = defineProps<{ session: Session; title: string; subtitle?: string }>()
defineEmits<{ open: [] }>()

const muted = computed(() => ['cancelled', 'no_show'].includes(props.session.status))
// Status pokazany tekstem i ikoną, nie tylko kolorem.
const badge = computed(
  () =>
    ({
      pending: 'bg-warn-soft text-warn-fg',
      confirmed: 'bg-surface-2 text-muted',
      completed: 'bg-success-soft text-success',
      cancelled: 'bg-danger-soft text-danger',
      no_show: 'bg-danger-soft text-danger',
    })[props.session.status],
)
</script>

<template>
  <button class="card pressable flex w-full items-stretch gap-3 p-3 text-left hover:bg-surface-2" :class="muted ? 'opacity-70' : ''" @click="$emit('open')">
    <div class="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 py-1">
      <span class="font-display text-xl leading-none font-bold tabular-nums" :class="muted ? 'line-through' : ''">{{ hm(session.starts_at) }}</span>
      <span class="text-[11px] text-muted tabular-nums">{{ hm(session.ends_at) }}</span>
    </div>
    <div class="min-w-0 flex-1 py-0.5">
      <p class="truncate font-semibold">{{ title }}</p>
      <p v-if="subtitle" class="truncate text-sm text-muted">{{ subtitle }}</p>
      <div class="mt-1 flex flex-wrap items-center gap-1.5">
        <span class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold" :class="badge">
          <Icon v-if="session.status === 'pending'" name="clock" class="size-3" />
          <Icon v-else-if="session.status === 'completed'" name="check" class="size-3" />
          <Icon v-else-if="muted" name="x" class="size-3" />
          {{ label(SESSION_STATUSES, session.status) }}
        </span>
        <GymBadge :gym-id="session.gym_id" />
        <span v-if="session.series_id" class="tag">co tydzień</span>
        <span v-if="session.moved_from" class="tag !bg-warn-soft !text-warn-fg">prośba o przełożenie</span>
        <span v-else-if="session.booked_by_client" class="tag">prośba klienta</span>
      </div>
    </div>
    <Icon name="chevron" class="size-5 self-center text-subtle" />
  </button>
</template>
