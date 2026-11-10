<script setup lang="ts">
// Przypisanie szablonu klientowi: wybór szablonu (lub klienta, gdy otwarte z szablonu) i daty startu.
import { computed, onMounted, ref } from 'vue'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import Icon from './Icon.vue'

const props = defineProps<{ clientId?: string; templateId?: string }>()
const emit = defineEmits<{ done: [programId: string]; close: [] }>()

const clients = useClientsStore()
const programs = useProgramsStore()
const templateId = ref(props.templateId ?? '')
const clientId = ref(props.clientId ?? '')
const start = ref(nextMonday())
const busy = ref(false)
const error = ref('')

onMounted(() => Promise.all([clients.load(), programs.loadList()]))
const templates = computed(() => programs.list.filter((p) => p.is_template))
const activeClients = computed(() => clients.all.filter((c) => !c.archived))

function nextMonday() {
  const d = new Date()
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  return d.toISOString().slice(0, 10)
}

async function submit() {
  if (!templateId.value || !clientId.value) return
  busy.value = true
  error.value = ''
  try {
    const id = await programs.copy(templateId.value, { clientId: clientId.value, start: start.value || null })
    emit('done', id)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="sheet space-y-4 sm:max-w-md" @submit.prevent="submit">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Przypisz plan z szablonu</h2>
        <button type="button" class="icon-btn -m-2" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      </div>
      <div v-if="!props.templateId">
        <label class="label" for="t">Szablon</label>
        <select id="t" v-model="templateId" class="input" required>
          <option value="" disabled>Wybierz…</option>
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <p v-if="!templates.length" class="mt-1 text-xs text-muted">Nie masz jeszcze szablonów – utwórz go w zakładce Plany.</p>
      </div>
      <div v-if="!props.clientId">
        <label class="label" for="c">Klient</label>
        <select id="c" v-model="clientId" class="input" required>
          <option value="" disabled>Wybierz…</option>
          <option v-for="c in activeClients" :key="c.id" :value="c.id">{{ c.full_name }}</option>
        </select>
      </div>
      <div>
        <label class="label" for="s">Start</label>
        <input id="s" v-model="start" type="date" class="input" />
      </div>
      <p class="text-xs text-muted">Klient dostaje własną kopię – zmiany w jego planie nie ruszają szablonu.</p>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy || !templateId || !clientId">{{ busy ? 'Kopiowanie…' : 'Przypisz i otwórz' }}</button>
    </form>
  </div>
</template>
