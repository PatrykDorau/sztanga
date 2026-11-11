<script setup lang="ts">
// Admin: konta z dostępem trenera. Trenerzy pracują na wspólnych danych (klienci, grafik, kalendarz).
import { onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import Icon from '@/components/Icon.vue'

interface Account {
  id: string
  email: string
  full_name: string | null
  role: 'trainer' | 'client' | 'parent'
  is_admin: boolean
  last_sign_in_at: string | null
}
const auth = useAuthStore()
const list = ref<Account[]>([])
const email = ref('')
const busy = ref(false)
const msg = ref('')
const error = ref('')

async function load() {
  const { data, error: e } = await supabase.rpc('admin_accounts')
  if (e) error.value = e.message
  else list.value = (data ?? []) as Account[]
}
onMounted(load)

const RESULT: Record<string, string> = {
  missing: 'Nie ma konta z tym adresem. Poproś tę osobę, żeby raz zalogowała się w aplikacji (link z e-maila), i spróbuj ponownie.',
  self: 'Nie możesz odebrać roli trenera samemu sobie.',
  client: 'To konto jest połączone z kartą klienta – najpierw odłącz je w karcie klienta albo użyj innego adresu.',
}
async function setTrainer(addr: string, on: boolean) {
  if (!addr.trim()) return
  if (!on && !confirm(`Odebrać rolę trenera kontu ${addr}? Straci dostęp do klientów i grafiku.`)) return
  busy.value = true
  msg.value = ''
  error.value = ''
  const { data, error: e } = await supabase.rpc('admin_set_trainer', { p_email: addr.trim(), p_trainer: on })
  busy.value = false
  if (e) return void (error.value = e.message)
  if (data !== 'ok') return void (error.value = RESULT[String(data)] ?? 'Nie udało się.')
  msg.value = on ? `${addr.trim()} jest teraz trenerem. Zobaczy panel trenera po ponownym otwarciu aplikacji.` : `${addr} nie jest już trenerem.`
  email.value = ''
  await load()
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }) : 'nigdy')
</script>

<template>
  <main class="pb-28">
    <header class="page-header flex items-center gap-2 px-4 pb-3">
      <RouterLink to="/profil" class="icon-btn -ml-2" aria-label="Wróć"><Icon name="back" class="size-6" /></RouterLink>
      <div>
        <p class="eyebrow">Admin</p>
        <h1 class="page-title">Konta trenerów</h1>
      </div>
    </header>

    <div class="space-y-5 px-4">
      <p v-if="!auth.isAdmin" class="text-muted">Ten ekran jest tylko dla admina.</p>
      <template v-else>
        <p class="text-sm text-muted">Trenerzy pracują na wspólnych danych: widzą wszystkich klientów, grafik, analizy, raporty i podłączony kalendarz Google.</p>

        <form class="card space-y-3 p-4" @submit.prevent="setTrainer(email, true)">
          <label class="block">
            <span class="label">Dodaj trenera (e-mail)</span>
            <input v-model="email" type="email" class="input" placeholder="adres@gmail.com" autocomplete="off" required />
          </label>
          <p class="text-xs text-muted">Osoba musi najpierw raz zalogować się w aplikacji (link z e-maila) – wtedy jej konto istnieje.</p>
          <button class="btn-primary w-full" :disabled="busy || !email.trim()">{{ busy ? 'Chwila…' : 'Nadaj rolę trenera' }}</button>
        </form>

        <p v-if="msg" class="text-sm font-semibold text-success" role="status">{{ msg }}</p>
        <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>

        <section class="space-y-2">
          <h2 class="text-xl font-bold">Z dostępem trenera</h2>
          <ul class="space-y-2">
            <li v-for="a in list" :key="a.id" class="card flex items-center gap-3 p-3">
              <div class="min-w-0 flex-1">
                <p class="truncate font-semibold">{{ a.full_name && a.full_name !== a.email ? a.full_name : a.email }}</p>
                <p class="truncate text-xs text-muted">
                  {{ a.email }} · {{ a.role === 'trainer' ? 'trener' : 'bez roli trenera' }}{{ a.is_admin ? ' · admin' : '' }} · ostatnio {{ when(a.last_sign_in_at) }}
                </p>
              </div>
              <button v-if="a.role === 'trainer' && a.id !== auth.profile?.id" type="button" class="btn-ghost shrink-0 text-sm text-danger" :disabled="busy" @click="setTrainer(a.email, false)">Odbierz</button>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </main>
</template>
