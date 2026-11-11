<script setup lang="ts">
// Duplikat klienta (np. literówka w kalendarzu): przenieś wszystko z tej karty na właściwą i usuń tę.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useClientsStore } from '@/stores/clients'
import Icon from './Icon.vue'

const props = defineProps<{ clientId: string; name: string }>()
const clients = useClientsStore()
const router = useRouter()
const open = ref(false)
const target = ref('')
const busy = ref(false)
const error = ref('')
const others = computed(() => clients.all.filter((c) => c.id !== props.clientId))
const targetName = computed(() => clients.byId(target.value)?.full_name ?? '')

async function merge() {
  if (!target.value) return
  if (!confirm(`Połączyć „${props.name}” z „${targetName.value}”? Sesje, plany i historia przejdą na „${targetName.value}”, a ta karta zniknie.`)) return
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.rpc('merge_clients', { keep: target.value, drop_id: props.clientId })
  busy.value = false
  if (e) return void (error.value = e.message)
  await clients.load(true)
  router.replace(`/klienci/${target.value}`)
}
</script>

<template>
  <div>
    <button v-if="!open" type="button" class="btn-ghost w-full border border-line-strong" @click="open = true">
      <Icon name="users" class="size-4" />To duplikat – połącz z innym klientem
    </button>
    <div v-else class="card space-y-3 p-4">
      <p class="font-semibold">Połącz z właściwą kartą</p>
      <p class="text-sm text-muted">Sesje, plany, historia i analizy z „{{ name }}” przejdą na wybraną kartę, a wydarzenia z kalendarza z tą pisownią będą odtąd do niej trafiać. Ta karta zniknie.</p>
      <select v-model="target" class="input" aria-label="Właściwa karta klienta">
        <option value="" disabled>Wybierz klienta…</option>
        <option v-for="c in others" :key="c.id" :value="c.id">{{ c.full_name }}</option>
      </select>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn-ghost border border-line-strong" :disabled="busy" @click="open = false">Anuluj</button>
        <button type="button" class="btn-primary" :disabled="busy || !target" @click="merge">{{ busy ? 'Łączenie…' : 'Połącz' }}</button>
      </div>
    </div>
  </div>
</template>
