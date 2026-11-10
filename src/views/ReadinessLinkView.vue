<script setup lang="ts">
// Ankieta gotowości pod linkiem (bez konta): sportowiec wypełnia rano albo przed treningiem; można poprawić tego samego dnia.
import { onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import ReadinessForm from '@/components/ReadinessForm.vue'
import Icon from '@/components/Icon.vue'
import type { ReadinessKey } from '@/lib/sport'

const props = defineProps<{ token: string }>()
const state = ref<'loading' | 'form' | 'done' | 'missing'>('loading')
const name = ref('')
const today = ref('')
const initial = ref<(Partial<Record<ReadinessKey, number>> & { notes?: string | null }) | undefined>()
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  const { data, error: e } = await supabase.rpc('readiness_link', { link_token: props.token })
  if (e || !data) {
    state.value = 'missing'
    return
  }
  name.value = data.first_name
  today.value = data.today
  initial.value = data.entry ?? undefined
  state.value = data.entry ? 'done' : 'form'
})

async function submit(v: Record<ReadinessKey, number> & { notes: string | null }) {
  busy.value = true
  error.value = ''
  const { data, error: e } = await supabase.rpc('submit_readiness', {
    link_token: props.token,
    p_sleep: v.sleep,
    p_fatigue: v.fatigue,
    p_soreness: v.soreness,
    p_stress: v.stress,
    p_mood: v.mood,
    p_notes: v.notes,
  })
  busy.value = false
  if (e || !data) {
    error.value = 'Nie udało się zapisać. Sprawdź połączenie i spróbuj jeszcze raz.'
    return
  }
  initial.value = v
  state.value = 'done'
}
const dayLabel = (d: string) => new Date(d).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <main class="mx-auto max-w-md px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
    <p v-if="state === 'loading'" class="pt-10 text-center text-muted">Ładowanie…</p>
    <div v-else-if="state === 'missing'" class="card mt-10 p-6 text-center">
      <h1 class="text-xl font-bold">Link jest nieaktywny</h1>
      <p class="mt-2 text-sm text-muted">Poproś trenerkę o nowy link do ankiety.</p>
    </div>
    <template v-else>
      <header class="mb-5">
        <p class="text-sm text-muted first-letter:uppercase">{{ dayLabel(today) }}</p>
        <h1 class="font-display text-3xl font-bold">Cześć {{ name }}! Jak się dziś czujesz?</h1>
        <p class="mt-1 text-sm text-muted">5 pytań, 20 sekund. Odpowiadaj szczerze – trenerka dopasuje do tego trening.</p>
      </header>
      <div v-if="state === 'done'" class="card space-y-3 p-5 text-center">
        <Icon name="check" class="mx-auto size-10 text-success" />
        <p class="text-lg font-semibold">Dzięki, zapisane!</p>
        <p class="text-sm text-muted">Możesz poprawić odpowiedzi do końca dnia.</p>
        <button class="btn-ghost w-full border border-line-strong" @click="state = 'form'">Popraw odpowiedzi</button>
      </div>
      <template v-else>
        <ReadinessForm :initial="initial" :busy="busy" submit-label="Wyślij" @submit="submit" />
        <p v-if="error" class="mt-3 text-sm text-danger" role="alert">{{ error }}</p>
      </template>
    </template>
  </main>
</template>
