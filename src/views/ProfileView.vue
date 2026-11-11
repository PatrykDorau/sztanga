<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { themePref, type ThemePref } from '@/lib/theme'
import { AI_MODELS, loadAppSettings, modelAssistant, modelPlan, parentConsent, setModel, setParentConsent, type AiModel } from '@/lib/appSettings'
import { pendingCount, translateAll, type TranslateModel } from '@/lib/translateCues'
import InstallApp from '@/components/InstallApp.vue'
import CreditsPanel from '@/components/CreditsPanel.vue'
import { useCalendarStore } from '@/stores/calendar'
import { EQUIPMENT } from '@/lib/vocab'
import { disablePush, enablePush, pushState, refreshPushState } from '@/lib/push'

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

// ----- Powiadomienia push (trenerka): odwołania, prośby o termin, przełożenia, wybory z linków -----
if (auth.isTrainer) refreshPushState().catch(() => null)
const pushBusy = ref(false)
const pushError = ref('')
async function togglePush() {
  pushBusy.value = true
  pushError.value = ''
  try {
    if (pushState.value === 'on') await disablePush()
    else await enablePush()
  } catch (e) {
    pushError.value = (e as Error).message
  } finally {
    pushBusy.value = false
  }
}

// ----- Modele AI -----
const modelError = ref('')
const changeModel = (kind: 'assistant' | 'plan', m: string) => setModel(kind, m as AiModel).catch((e) => (modelError.value = (e as Error).message))

// ----- Siłownie i ich sprzęt (skrót do stron „Sprzęt”) -----
const cal = useCalendarStore()
if (auth.isTrainer && !cal.gyms.length) cal.loadGyms().catch(() => null)
const gymSummary = (g: { equipment?: string[] | null; machines?: string[] | null }) =>
  !g.equipment && !g.machines
    ? 'sprzęt nieustawiony – planer bierze wszystko'
    : `${(g.equipment ?? []).length} rodzajów sprzętu${g.machines ? ` · ${g.machines.length} maszyn` : ''}: ${(g.equipment ?? []).slice(0, 5).map((k) => EQUIPMENT[k] ?? k).join(', ')}${(g.equipment ?? []).length > 5 ? '…' : ''}`

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

    <CreditsPanel v-if="auth.isTrainer" />

    <section v-if="auth.isTrainer" class="card space-y-3 p-4 text-sm">
      <p class="label">Modele AI (Claude)</p>
      <p class="text-muted">Koszt idzie z Twojego klucza Anthropic. Ceny za milion tokenów: wejście / wyjście. Jedno pytanie do asystenta to zwykle kilka–kilkanaście tysięcy tokenów.</p>
      <label v-for="[kind, title, current] in ([['assistant', 'Asystent (czat)', modelAssistant], ['plan', 'Plany „Z AI” i import treningu', modelPlan]] as const)" :key="kind" class="block space-y-1">
        <span class="block font-semibold">{{ title }}</span>
        <select class="input" :value="current" @change="changeModel(kind, ($event.target as HTMLSelectElement).value)">
          <option v-for="m in AI_MODELS" :key="m.id" :value="m.id">{{ m.name }} · {{ m.price }}</option>
        </select>
        <span class="block text-xs text-muted">{{ AI_MODELS.find((m) => m.id === current)?.hint }}</span>
      </label>
      <p v-if="modelError" class="text-danger" role="alert">{{ modelError }}</p>
    </section>

    <section v-if="auth.isTrainer && cal.gyms.length" class="card space-y-2 p-4 text-sm">
      <p class="label">Siłownie i sprzęt</p>
      <p class="text-muted">Co jest w każdej siłowni – generator planu i dobór ćwiczeń biorą tylko to, co da się tam zrobić.</p>
      <RouterLink v-for="g in cal.gyms" :key="g.id" :to="`/silownie/${g.id}`" class="flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-surface-2">
        <span class="min-w-0 flex-1">
          <span class="block font-semibold">{{ g.name }}</span>
          <span class="block truncate text-xs text-muted">{{ gymSummary(g) }}</span>
        </span>
        <span class="shrink-0 text-sm font-semibold text-primary-fg">Sprzęt →</span>
      </RouterLink>
    </section>

    <section v-if="auth.isTrainer" class="card space-y-3 p-4 text-sm">
      <p class="label">Powiadomienia na tym urządzeniu</p>
      <p class="text-muted">Dostaniesz powiadomienie, gdy klient poprosi o termin (jeśli pokazujesz wolne godziny) albo gdy ktoś wybierze terminy z linku.</p>
      <button class="w-full" :class="pushState === 'on' ? 'btn-ghost border border-line-strong' : 'btn-primary'" :disabled="pushBusy || pushState === 'unsupported' || pushState === 'denied'" @click="togglePush">
        {{ pushBusy ? 'Chwila…' : pushState === 'on' ? 'Wyłącz powiadomienia' : 'Włącz powiadomienia' }}
      </button>
      <p v-if="pushState === 'on'" class="font-semibold text-success">Włączone na tym urządzeniu.</p>
      <p v-else-if="pushState === 'unsupported'" class="text-muted">Ta przeglądarka nie obsługuje powiadomień. Na iPhonie: najpierw dodaj aplikację do ekranu początkowego (poniżej) i otwórz ją z ikony.</p>
      <p v-else-if="pushState === 'denied'" class="text-muted">Powiadomienia są zablokowane w ustawieniach przeglądarki dla tej strony – odblokuj je tam.</p>
      <p v-if="pushError" class="text-danger" role="alert">{{ pushError }}</p>
    </section>

    <InstallApp />

    <button class="btn-ghost w-full" @click="logout">Wyloguj</button>
  </main>
</template>
