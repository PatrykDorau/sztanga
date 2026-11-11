<script setup lang="ts">
// Usuwanie klienta z podwójnym potwierdzeniem: 1) „Usuń klienta” pokazuje, co zniknie, 2) wpisanie imienia i „Usuń na zawsze”.
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useClientsStore } from '@/stores/clients'
import Icon from './Icon.vue'

const props = defineProps<{ clientId: string; name: string; archived?: boolean }>()
const clients = useClientsStore()
const router = useRouter()

const step = ref<0 | 1>(0)
const typed = ref('')
const busy = ref(false)
const error = ref('')
const counts = ref<{ plans: number; sessions: number; future: number; analyses: number } | null>(null)
const input = ref<HTMLInputElement | null>(null)

const matches = computed(() => typed.value.trim().toLowerCase() === props.name.trim().toLowerCase())

async function start() {
  step.value = 1
  typed.value = ''
  error.value = ''
  const now = new Date().toISOString()
  const n = (r: { count: number | null }) => r.count ?? 0
  const [p, s, f, a] = await Promise.all([
    supabase.from('programs').select('id', { count: 'exact', head: true }).eq('client_id', props.clientId),
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('client_id', props.clientId),
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('client_id', props.clientId).gte('starts_at', now).in('status', ['pending', 'confirmed']),
    supabase.from('movement_analyses').select('id', { count: 'exact', head: true }).eq('client_id', props.clientId),
  ])
  counts.value = { plans: n(p), sessions: n(s), future: n(f), analyses: n(a) }
  await nextTick()
  input.value?.focus()
}

async function archive() {
  busy.value = true
  try {
    await supabase.from('clients').update({ archived: true }).eq('id', props.clientId)
    await clients.load(true)
    step.value = 0
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!matches.value) return
  busy.value = true
  error.value = ''
  try {
    await clients.remove(props.clientId)
    router.replace('/klienci')
  } catch (e) {
    error.value = (e as Error).message
    busy.value = false
  }
}
</script>

<template>
  <div>
    <button v-if="step === 0" type="button" class="btn-ghost w-full border border-line-strong text-danger" @click="start">
      <Icon name="trash" class="size-4" />Usuń klienta
    </button>

    <div v-else class="card space-y-3 border-2 border-danger p-4" role="alertdialog" aria-labelledby="del-title">
      <p id="del-title" class="font-bold text-danger">Usunąć {{ name }} na zawsze?</p>
      <ul class="space-y-0.5 text-sm">
        <li>Znikną: karta klienta, pomiary, historia treningów i postępy.</li>
        <li v-if="counts">
          Plany: {{ counts.plans }} · sesje: {{ counts.sessions }}<template v-if="counts.future"> (w tym {{ counts.future }} przyszłych)</template> · analizy ruchu: {{ counts.analyses }}
        </li>
        <li v-if="counts?.future" class="text-muted">Przyszłe sesje w Google Calendar dostaną „ODWOŁANE” – usuniesz je w panelu „Odwołane w kalendarzu”.</li>
        <li class="font-semibold">Tego nie da się cofnąć.</li>
      </ul>
      <p v-if="!archived" class="text-sm text-muted">
        Jeśli tylko kończycie współpracę, lepiej
        <button type="button" class="font-semibold text-primary-fg underline" :disabled="busy" @click="archive">przenieś do archiwum</button>
        – dane zostaną.
      </p>
      <label class="block">
        <span class="label">Wpisz „{{ name }}”, żeby potwierdzić</span>
        <input ref="input" v-model="typed" class="input" autocomplete="off" :placeholder="name" @keydown.enter.prevent="remove" />
      </label>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn-ghost border border-line-strong" :disabled="busy" @click="step = 0">Anuluj</button>
        <button type="button" class="btn-danger" :disabled="busy || !matches" @click="remove">{{ busy ? 'Usuwanie…' : 'Usuń na zawsze' }}</button>
      </div>
    </div>
  </div>
</template>
