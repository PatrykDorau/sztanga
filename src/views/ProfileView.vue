<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { themePref, type ThemePref } from '@/lib/theme'
import { loadAppSettings, parentConsent, setParentConsent } from '@/lib/appSettings'
import { pendingCount, translateAll, type TranslateModel } from '@/lib/translateCues'

const auth = useAuthStore()
const router = useRouter()
const name = ref(auth.profile?.full_name ?? '')
const saved = ref(false)
watch(() => auth.profile, (p) => (name.value = p?.full_name ?? ''))

const ROLE = { trainer: 'Trenerka', client: 'Klient', parent: 'Rodzic' } as const
const THEMES: { key: ThemePref; label: string }[] = [
  { key: 'system', label: 'Jak system' },
  { key: 'light', label: 'Jasny' },
  { key: 'dark', label: 'Ciemny' },
]

async function saveName() {
  if (!auth.profile) return
  await supabase.from('profiles').update({ full_name: name.value.trim() }).eq('id', auth.profile.id)
  await auth.loadProfile()
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}

if (auth.isTrainer) loadAppSettings()
const settingError = ref('')
async function toggleConsent(e: Event) {
  settingError.value = ''
  const v = (e.target as HTMLInputElement).checked
  await setParentConsent(v).catch((err) => {
    settingError.value = (err as Error).message
    ;(e.target as HTMLInputElement).checked = !v
  })
}

// ----- Tłumaczenie technik ćwiczeń (AI, koszt z klucza Anthropic) -----
const pending = ref<number | null>(null)
if (auth.isTrainer) pendingCount().then((n) => (pending.value = n)).catch(() => null)
const trModel = ref<TranslateModel>('claude-opus-5-5')
const trBusy = ref(false)
const trProgress = ref({ done: 0, total: 0, usd: 0 })
const trError = ref('')
const trSignal = { stop: false }
async function runTranslate() {
  if (!confirm(`Przetłumaczyć ${pending.value} instrukcji? Koszt pokrywa Twój klucz Anthropic (szacunek poniżej). Możesz przerwać w każdej chwili.`)) return
  trBusy.value = true
  trError.value = ''
  trSignal.stop = false
  try {
    await translateAll(trModel.value, (done, total, usd) => (trProgress.value = { done, total, usd }), trSignal)
  } catch (e) {
    trError.value = (e as Error).message
  } finally {
    trBusy.value = false
    pending.value = await pendingCount().catch(() => pending.value)
  }
}

async function logout() {
  await auth.signOut()
  router.replace('/login')
}
</script>

<template>
  <main class="space-y-4 px-4 pt-6">
    <h1 class="page-title">Profil</h1>

    <section class="card space-y-3 p-4">
      <p class="text-sm text-muted">
        {{ auth.session?.user.email }} · <span class="tag">{{ auth.profile ? ROLE[auth.profile.role] : '—' }}</span>
      </p>
      <div>
        <label class="label" for="name">Imię i nazwisko</label>
        <div class="flex gap-2">
          <input id="name" v-model="name" class="input" />
          <button class="btn-ghost" @click="saveName">{{ saved ? 'Zapisano' : 'Zapisz' }}</button>
        </div>
      </div>
    </section>

    <section class="card p-4">
      <p class="label">Wygląd</p>
      <div class="flex gap-2">
        <button v-for="t in THEMES" :key="t.key" :class="themePref === t.key ? 'chip-on' : 'chip-off'" @click="themePref = t.key">
          {{ t.label }}
        </button>
      </div>
    </section>

    <section v-if="auth.isTrainer" class="card space-y-2 p-4">
      <p class="label">Funkcje</p>
      <label class="flex items-start gap-3 text-sm">
        <input type="checkbox" class="mt-0.5 size-5 accent-primary" :checked="parentConsent" @change="toggleConsent" />
        <span>
          <strong>Zgody rodzica w aplikacji</strong> – formularz zgód w raporcie dla rodzica i sekcja „Zgody rodzica” na karcie dziecka.
          Wyłączone: raport pokazuje wyniki od razu, a zgody zbierasz poza aplikacją.
        </span>
      </label>
      <p v-if="settingError" class="text-sm text-danger" role="alert">{{ settingError }}</p>
    </section>

    <section v-if="auth.isTrainer && pending" class="card space-y-3 p-4 text-sm">
      <p class="label">Techniki ćwiczeń po polsku</p>
      <p>{{ pending }} ćwiczeń z importu ma instrukcję „krok po kroku” po angielsku. Tłumaczenie robi Claude przez Twój klucz Anthropic.</p>
      <div class="space-y-1.5">
        <label class="flex items-start gap-2"><input v-model="trModel" type="radio" value="claude-opus-5-5" class="mt-0.5 size-5 accent-primary" :disabled="trBusy" /><span><strong>Claude Opus 5.5</strong> – najlepsza jakość, ok. 4–6 USD za całość</span></label>
        <label class="flex items-start gap-2"><input v-model="trModel" type="radio" value="claude-haiku-5-5" class="mt-0.5 size-5 accent-primary" :disabled="trBusy" /><span><strong>Claude Haiku 5.5</strong> – tańszy, ok. 0,1–0,2 USD, nieco prostszy język</span></label>
      </div>
      <div v-if="trBusy || trProgress.total" class="space-y-1">
        <div class="h-2 overflow-hidden rounded-full bg-surface-2"><div class="h-full bg-primary" :style="{ width: `${trProgress.total ? (trProgress.done / trProgress.total) * 100 : 0}%` }" /></div>
        <p class="text-xs text-muted tabular-nums">{{ trProgress.done }} / {{ trProgress.total }} · koszt dotąd ok. {{ trProgress.usd.toFixed(2) }} USD</p>
      </div>
      <p v-if="trError" class="text-danger" role="alert">{{ trError }}</p>
      <button v-if="!trBusy" class="btn-primary w-full" @click="runTranslate">Przetłumacz ({{ pending }})</button>
      <button v-else class="btn-ghost w-full border border-line-strong" @click="trSignal.stop = true">Przerwij po bieżącej partii</button>
    </section>

    <button class="btn-ghost w-full" @click="logout">Wyloguj</button>
  </main>
</template>
