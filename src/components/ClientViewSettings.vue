<script setup lang="ts">
// Trenerka wybiera, co klient widzi w swojej aplikacji (zapis od razu po kliknięciu).
import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useClientsStore } from '@/stores/clients'
import { shows, VIEW_SECTIONS, type ClientView, type ViewKey } from '@/lib/clientView'

const props = defineProps<{ clientId: string }>()
const clients = useClientsStore()
const c = computed(() => clients.byId(props.clientId))
const cv = computed<ClientView>(() => (c.value?.client_view ?? {}) as ClientView)
const saving = ref(false)
const error = ref('')
async function toggle(k: ViewKey, on: boolean) {
  if (!c.value) return
  const next = { ...cv.value, [k]: on }
  saving.value = true
  error.value = ''
  const { error: e } = await supabase.from('clients').update({ client_view: next }).eq('id', props.clientId)
  saving.value = false
  if (e) error.value = e.message
  else c.value.client_view = next
}
</script>

<template>
  <section class="card space-y-3 p-4">
    <div>
      <h2 class="text-lg font-bold">Widok klienta</h2>
      <p class="text-sm text-muted">Co {{ c?.full_name.split(' ')[0] ?? 'klient' }} widzi w swojej aplikacji.<span v-if="!c?.user_id"> Klient nie ma jeszcze konta – ustawienia zadziałają po zalogowaniu.</span></p>
    </div>
    <ul class="divide-y divide-line">
      <li v-for="s in VIEW_SECTIONS" :key="s.key">
        <label class="flex min-h-12 cursor-pointer items-center gap-3 py-1.5">
          <span class="min-w-0 flex-1">
            <span class="block font-semibold">{{ s.label }}</span>
            <span class="text-xs text-muted">{{ s.hint }}</span>
          </span>
          <input type="checkbox" role="switch" class="size-5 accent-primary" :checked="shows(cv, s.key)" :disabled="saving" @change="toggle(s.key, ($event.target as HTMLInputElement).checked)" />
        </label>
      </li>
    </ul>
    <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    <p class="text-xs text-muted">To wybór tego, co pokazać w aplikacji – klient zawsze ma prawo do swoich danych i może o nie poprosić.</p>
  </section>
</template>
