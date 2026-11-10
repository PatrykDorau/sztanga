<script setup lang="ts">
// Publiczny formularz pierwszej konsultacji – link dla nowych klientów, bez zakładania konta.
import { reactive, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import Icon from '@/components/Icon.vue'

const f = reactive({ full_name: '', email: '', phone: '', preferred: '', message: '', consent: false })
const busy = ref(false)
const sent = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (!f.email.trim() && !f.phone.trim()) {
    error.value = 'Podaj e-mail albo telefon, żeby trenerka mogła się odezwać.'
    return
  }
  busy.value = true
  try {
    const { error: e } = await supabase.from('consultation_requests').insert({
      full_name: f.full_name.trim(),
      email: f.email.trim() || null,
      phone: f.phone.trim() || null,
      preferred_at: f.preferred ? new Date(f.preferred).toISOString() : null,
      message: f.message.trim() || null,
    })
    if (e) throw e
    sent.value = true
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="mx-auto max-w-md px-5 py-10">
    <div class="mb-6 flex items-center gap-3">
      <img src="/icon.svg" alt="" class="size-12 rounded-xl" />
      <div>
        <h1 class="page-title">Pierwsza konsultacja</h1>
        <p class="text-muted">Zostaw kontakt – trenerka odezwie się i ustalicie termin.</p>
      </div>
    </div>

    <div v-if="sent" class="card space-y-2 p-6 text-center" role="status">
      <Icon name="check" class="mx-auto size-10 text-success" />
      <p class="text-xl font-bold">Dziękujemy!</p>
      <p class="text-muted">Zgłoszenie dotarło. Odezwiemy się najszybciej, jak to możliwe.</p>
    </div>

    <form v-else class="card space-y-4 p-5" @submit.prevent="submit">
      <label class="block"><span class="label">Imię i nazwisko</span><input v-model="f.full_name" class="input" required minlength="2" maxlength="120" autocomplete="name" /></label>
      <label class="block"><span class="label">E-mail</span><input v-model="f.email" type="email" class="input" maxlength="200" autocomplete="email" /></label>
      <label class="block"><span class="label">Telefon</span><input v-model="f.phone" type="tel" class="input" maxlength="40" autocomplete="tel" /></label>
      <p class="-mt-2 text-xs text-muted">Wystarczy jedno z dwóch: e-mail albo telefon.</p>
      <label class="block"><span class="label">Preferowany termin (opcjonalnie)</span><input v-model="f.preferred" type="datetime-local" class="input" /></label>
      <label class="block"><span class="label">Cel, kontuzje, pytania (opcjonalnie)</span><textarea v-model="f.message" rows="3" maxlength="2000" class="input py-2" /></label>
      <label class="flex items-start gap-3 text-sm">
        <input v-model="f.consent" type="checkbox" required class="mt-0.5 size-5 shrink-0 accent-primary" />
        <span>Zgadzam się na kontakt w sprawie konsultacji i przetwarzanie podanych danych w tym celu.</span>
      </label>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Wysyłanie…' : 'Wyślij zgłoszenie' }}</button>
    </form>
  </main>
</template>
