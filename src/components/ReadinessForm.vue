<script setup lang="ts">
// Ankieta gotowości: 5 pytań w skali 1–5 (duże przyciski, jedna ręka na telefonie) + uwagi.
// Używana pod linkiem (sportowiec sam) i w sesji (trenerka pyta na starcie).
import { computed, reactive } from 'vue'
import { READINESS_ITEMS, readinessScore, type ReadinessKey } from '@/lib/sport'

const props = defineProps<{ initial?: Partial<Record<ReadinessKey, number>> & { notes?: string | null }; busy?: boolean; submitLabel?: string }>()
const emit = defineEmits<{ submit: [v: Record<ReadinessKey, number> & { notes: string | null }] }>()

const v = reactive<Record<ReadinessKey, number | null>>({
  sleep: props.initial?.sleep ?? null,
  fatigue: props.initial?.fatigue ?? null,
  soreness: props.initial?.soreness ?? null,
  stress: props.initial?.stress ?? null,
  mood: props.initial?.mood ?? null,
})
const f = reactive({ notes: props.initial?.notes ?? '' })
const complete = computed(() => READINESS_ITEMS.every((i) => v[i.key] != null))
const score = computed(() => (complete.value ? readinessScore(v as Record<ReadinessKey, number>) : null))
function submit() {
  if (!complete.value) return
  emit('submit', { ...(v as Record<ReadinessKey, number>), notes: f.notes.trim() || null })
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="submit">
    <fieldset v-for="it in READINESS_ITEMS" :key="it.key" class="space-y-2">
      <legend class="font-semibold">{{ it.label }}</legend>
      <div class="grid grid-cols-5 gap-1.5">
        <button
          v-for="n in 5"
          :key="n"
          type="button"
          class="min-h-12 rounded-xl border text-lg font-bold tabular-nums transition-colors"
          :class="v[it.key] === n ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface'"
          :aria-pressed="v[it.key] === n"
          :aria-label="`${it.label}: ${n} z 5`"
          @click="v[it.key] = n"
        >
          {{ n }}
        </button>
      </div>
      <div class="flex justify-between text-xs text-muted"><span>1 – {{ it.low }}</span><span>5 – {{ it.high }}</span></div>
    </fieldset>
    <label class="block">
      <span class="label">Coś jeszcze? (opcjonalnie)</span>
      <textarea v-model="f.notes" rows="2" maxlength="500" class="input py-2" placeholder="np. boli lewe kolano, mało snu przez podróż" />
    </label>
    <button class="btn-primary w-full" :disabled="!complete || busy">
      {{ busy ? 'Zapisywanie…' : (submitLabel ?? 'Zapisz') }}<span v-if="score != null" class="ml-1 opacity-80">· {{ score }}/100</span>
    </button>
  </form>
</template>
