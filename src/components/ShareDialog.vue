<script setup lang="ts">
// Link do planu dla klienta (bez konta) z możliwością cofnięcia dostępu.
import { onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import Icon from './Icon.vue'

const props = defineProps<{ programId: string; isDraft: boolean }>()
const emit = defineEmits<{ close: [] }>()
const share = ref<{ id: string; token: string } | null>(null)
const busy = ref(false)
const error = ref('')
const copied = ref(false)
const url = (t: string) => `${window.location.origin}/p/${t}`

onMounted(async () => {
  const { data, error: e } = await supabase.from('plan_shares').select('id, token').eq('program_id', props.programId).is('revoked_at', null).maybeSingle()
  if (e) error.value = e.message
  share.value = data
})

async function create() {
  busy.value = true
  const { data, error: e } = await supabase.from('plan_shares').insert({ program_id: props.programId }).select('id, token').single()
  busy.value = false
  if (e) error.value = e.message
  else share.value = data
}

async function revoke() {
  if (!share.value) return
  busy.value = true
  const { error: e } = await supabase.from('plan_shares').update({ revoked_at: new Date().toISOString() }).eq('id', share.value.id)
  busy.value = false
  if (e) error.value = e.message
  else share.value = null
}

async function copy() {
  try {
    await navigator.clipboard.writeText(url(share.value!.token))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    error.value = 'Nie udało się skopiować – zaznacz link ręcznie.'
  }
}
</script>

<template>
  <div class="fixed inset-0 z-30 flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Udostępnij plan" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="sheet space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold">Udostępnij plan</h2>
        <button class="icon-btn -m-2" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      </div>
      <p class="text-sm text-muted">Klient otworzy plan z filmikami pod linkiem – bez zakładania konta. Możesz w każdej chwili cofnąć dostęp.</p>
      <p v-if="isDraft" class="warn-box"><Icon name="alert" class="size-5 shrink-0" />Plan jest szkicem – link zadziała po ustawieniu statusu „Aktywny”.</p>

      <template v-if="share">
        <div class="flex gap-2">
          <input :value="url(share.token)" readonly class="input flex-1 text-sm" aria-label="Link do planu" @focus="($event.target as HTMLInputElement).select()" />
          <button class="btn-primary" @click="copy">{{ copied ? 'Skopiowano' : 'Kopiuj' }}</button>
        </div>
        <a :href="url(share.token)" target="_blank" rel="noopener" class="btn-ghost w-full">Podgląd jak klient</a>
        <button class="btn-danger w-full" :disabled="busy" @click="revoke">Cofnij dostęp (link przestanie działać)</button>
      </template>
      <button v-else class="btn-primary w-full" :disabled="busy" @click="create">Utwórz link</button>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    </div>
  </div>
</template>
