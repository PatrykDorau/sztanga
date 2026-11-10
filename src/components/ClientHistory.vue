<script setup lang="ts">
// Oś czasu treningów: każda sesja z seriami, notatkami, rekordami i podsumowaniem do zatwierdzenia.
import { computed, ref } from 'vue'
import { useExercisesStore } from '@/stores/exercises'
import { useProgressStore } from '@/stores/progress'
import { prsInLog } from '@/lib/analytics'

import type { SessionLog } from '@/types'
import Icon from './Icon.vue'

const props = defineProps<{ clientId: string }>()
const progress = useProgressStore()
const ex = useExercisesStore()
const logs = computed(() => progress.logs[props.clientId] ?? [])
const editing = ref<string | null>(null)
const text = ref('')
const busy = ref(false)

function grouped(log: SessionLog) {
  const m = new Map<string, NonNullable<SessionLog['set_logs']>>()
  for (const s of [...(log.set_logs ?? [])].sort((a, b) => a.position - b.position || a.set_index - b.set_index)) m.set(s.exercise_id, [...(m.get(s.exercise_id) ?? []), s])
  return [...m.entries()]
}
const fmt = (n: number | null) => (n == null ? '–' : String(Number(n)).replace('.', ','))

function edit(log: SessionLog) {
  editing.value = log.id
  text.value = log.summary ?? ''
}
async function save(log: SessionLog, approve: boolean) {
  busy.value = true
  await progress.updateLog(props.clientId, log.id, { summary: text.value.trim() || null, summary_status: approve ? 'approved' : text.value.trim() ? 'draft' : 'none' })
  busy.value = false
  editing.value = null
}
const approve = (log: SessionLog) => progress.updateLog(props.clientId, log.id, { summary_status: 'approved' })
</script>

<template>
  <div class="space-y-3">
    <p v-if="!logs.length" class="card p-4 text-sm text-muted">Brak zapisanych sesji.</p>
    <article v-for="log in logs" :key="log.id" class="card p-4">
      <header class="mb-2 flex items-baseline justify-between gap-2">
        <h3 class="text-lg font-bold first-letter:uppercase">{{ new Date(log.started_at).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }) }}</h3>
        <span class="text-xs text-muted">{{ log.finished_at ? Math.round((new Date(log.finished_at).getTime() - new Date(log.started_at).getTime()) / 60000) + ' min' : '' }}</span>
      </header>

      <ul class="space-y-1 text-sm">
        <li v-for="[exId, sets] in grouped(log)" :key="exId" class="flex gap-2">
          <span class="min-w-0 flex-1 truncate">
            {{ ex.byId(exId)?.name_pl }}
            <span v-if="prsInLog(log, logs).has(exId)" class="ml-1 inline-flex items-center gap-0.5 rounded bg-primary-soft px-1.5 text-xs font-semibold text-primary-fg">
              <Icon name="trophy" class="size-3" />rekord
            </span>
          </span>
          <span class="shrink-0 text-muted tabular-nums">
            {{ sets.filter((s) => s.done).map((s) => `${fmt(s.reps)}${s.load_kg ? '×' + fmt(s.load_kg) : ''}`).join(' · ') }}
          </span>
        </li>
      </ul>
      <p v-if="log.notes" class="mt-2 rounded-lg bg-surface-2 p-2 text-sm"><span class="font-semibold">Notatki:</span> {{ log.notes }}</p>

      <div class="mt-3 border-t border-line pt-3">
        <template v-if="editing === log.id">
          <label class="label" :for="`sum-${log.id}`">Podsumowanie dla klienta</label>
          <textarea :id="`sum-${log.id}`" v-model="text" rows="6" class="input py-2 text-sm" />
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button class="btn-ghost" :disabled="busy" @click="save(log, false)">Zapisz szkic</button>
            <button class="btn-primary" :disabled="busy || !text.trim()" @click="save(log, true)"><Icon name="check" class="size-5" />Akceptuj</button>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold" :class="log.summary_status === 'approved' ? 'text-success' : log.summary_status === 'draft' ? 'text-warn-fg' : 'text-muted'">
              {{ log.summary_status === 'approved' ? '✓ Podsumowanie widoczne dla klienta' : log.summary_status === 'draft' ? 'Szkic podsumowania – czeka na akceptację' : 'Bez podsumowania' }}
            </span>
            <div class="flex gap-1">
              <button class="btn-ghost !min-h-9 text-sm" @click="edit(log)">{{ log.summary ? 'Edytuj' : 'Napisz' }}</button>
              <button v-if="log.summary_status === 'draft'" class="btn-primary !min-h-9 text-sm" @click="approve(log)">Akceptuj</button>
            </div>
          </div>
          <p v-if="log.summary" class="mt-2 text-sm whitespace-pre-line text-muted">{{ log.summary }}</p>
        </template>
      </div>
    </article>
  </div>
</template>
