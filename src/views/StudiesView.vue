<script setup lang="ts">
// Badania: lista i tworzenie – dla jednego klienta, kilku klientów albo drużyny (osoby spoza bazy).
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { createStudy, listStudies, TEST_PRESETS, type StudyTest } from '@/lib/studies'
import { norm } from '@/lib/search'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const clients = useClientsStore()
const list = ref<Awaited<ReturnType<typeof listStudies>>>([])
const loading = ref(true)
const error = ref('')
onMounted(async () => {
  try {
    await clients.load()
    list.value = await listStudies()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
const who = (s: (typeof list.value)[number]) => {
  const ids = s.study_athletes.map((a) => a.client_id).filter(Boolean) as string[]
  if (s.team) return s.team
  if (s.study_athletes.length === 1 && ids[0]) return clients.byId(ids[0])?.full_name ?? '1 osoba'
  return `${s.study_athletes.length} os.`
}

// ----- Tworzenie -----
const creating = ref(false)
const f = reactive({ name: '', team: '', others: '', q: '' })
const picked = ref<string[]>([])
const tests = ref<StudyTest[]>([TEST_PRESETS[0], TEST_PRESETS[1]])
const custom = reactive({ label: '', unit: '', higher: true })
const shownClients = computed(() => clients.all.filter((c) => !c.archived && (!f.q.trim() || norm(c.full_name).includes(norm(f.q)))))
const toggleClient = (id: string) => (picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value, id])
const hasTest = (k: string) => tests.value.some((t) => t.key === k)
const toggleTest = (t: StudyTest) => (tests.value = hasTest(t.key) ? tests.value.filter((x) => x.key !== t.key) : [...tests.value, t])
function addCustom() {
  const label = custom.label.trim()
  if (!label) return
  tests.value.push({ key: `c_${norm(label).replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`, label, unit: custom.unit.trim(), higher: custom.higher })
  Object.assign(custom, { label: '', unit: '', higher: true })
}
const others = computed(() =>
  f.others
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, position] = l.split(/[;\t]/).map((x) => x.trim())
      return { name, position: position || null, client_id: null }
    }),
)
const busy = ref(false)
async function create() {
  error.value = ''
  const athletes = [...picked.value.map((id) => ({ name: clients.byId(id)?.full_name ?? 'Klient', position: null, client_id: id })), ...others.value]
  if (!f.name.trim()) return void (error.value = 'Wpisz nazwę badania.')
  if (!tests.value.length) return void (error.value = 'Wybierz co najmniej jeden test.')
  if (!athletes.length) return void (error.value = 'Wybierz klienta albo wpisz osoby.')
  busy.value = true
  try {
    const id = await createStudy({ name: f.name.trim(), team: f.team.trim() || null, tests: tests.value, athletes })
    router.push(`/badania/${id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="pb-10">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="min-w-0 flex-1 text-2xl font-bold">Badania</h1>
      <button class="btn-primary" @click="creating = !creating"><Icon name="plus" class="size-5" />Nowe</button>
    </header>

    <div class="space-y-4 px-4">
      <p v-if="!creating" class="text-sm text-muted">Testy sprawności w kolejnych terminach – np. CMJ i SJ co kwartał – dla jednego klienta, grupy albo drużyny. Średnie, wykresy i porównanie terminów.</p>

      <form v-if="creating" class="card space-y-4 p-4" @submit.prevent="create">
        <label class="block"><span class="label">Nazwa badania</span><input v-model="f.name" class="input" placeholder="np. Badania mocy – jesień" v-focus /></label>

        <div class="space-y-2">
          <p class="label">Kto (klienci z bazy)</p>
          <input v-model="f.q" type="search" class="input !min-h-10 text-sm" placeholder="Szukaj klienta…" />
          <ul class="max-h-52 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            <li v-for="c in shownClients" :key="c.id">
              <label class="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                <input type="checkbox" class="size-5 accent-primary" :checked="picked.includes(c.id)" @change="toggleClient(c.id)" />
                <span class="min-w-0 flex-1 truncate">{{ c.full_name }}</span>
              </label>
            </li>
          </ul>
          <p class="text-xs text-muted">Wybrano: {{ picked.length }}</p>
        </div>

        <details class="space-y-2">
          <summary class="cursor-pointer text-sm font-semibold">Osoby spoza bazy (np. drużyna)</summary>
          <label class="mt-2 block"><span class="label">Drużyna / grupa (opcjonalnie)</span><input v-model="f.team" class="input" placeholder="np. Lech Poznań – seniorki" /></label>
          <label class="block"><span class="label">Osoby – jedna w linii: Nazwisko; pozycja</span>
            <textarea v-model="f.others" rows="4" class="input py-2 text-sm" placeholder="Betka; Obrona prawa&#10;Buczak; Obrona" />
          </label>
          <p class="text-xs text-muted">Możesz wkleić kolumny z arkusza (nazwisko i pozycja).</p>
        </details>

        <div class="space-y-2">
          <p class="label">Testy</p>
          <div class="flex flex-wrap gap-2">
            <button v-for="t in TEST_PRESETS" :key="t.key" type="button" :class="hasTest(t.key) ? 'chip-on' : 'chip-off'" :aria-pressed="hasTest(t.key)" @click="toggleTest(t)">
              {{ t.label }}<span v-if="t.unit" class="ml-1 opacity-70">{{ t.unit }}</span>
            </button>
            <button v-for="t in tests.filter((x) => x.key.startsWith('c_'))" :key="t.key" type="button" class="chip-on" @click="toggleTest(t)">{{ t.label }} ×</button>
          </div>
          <div class="grid grid-cols-[1fr_5rem] gap-2">
            <input v-model="custom.label" class="input !min-h-10 text-sm" placeholder="Własny test, np. Hop test" />
            <input v-model="custom.unit" class="input !min-h-10 text-sm" placeholder="jedn." />
          </div>
          <div class="flex items-center justify-between gap-2">
            <label class="flex items-center gap-2 text-sm"><input v-model="custom.higher" type="checkbox" class="size-5 accent-primary" />więcej = lepiej</label>
            <button type="button" class="btn-ghost !min-h-9 border border-line-strong text-sm" :disabled="!custom.label.trim()" @click="addCustom"><Icon name="plus" class="size-4" />Dodaj test</button>
          </div>
        </div>

        <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy">{{ busy ? 'Tworzenie…' : 'Utwórz badanie' }}</button>
      </form>

      <p v-if="loading" class="text-muted">Ładowanie…</p>
      <p v-else-if="!list.length && !creating" class="card p-5 text-center text-sm text-muted">Brak badań. Utwórz pierwsze przyciskiem „+ Nowe”.</p>
      <ul class="space-y-2">
        <li v-for="s in list" :key="s.id">
          <RouterLink :to="`/badania/${s.id}`" class="card pressable flex items-center gap-3 p-4 hover:bg-surface-2">
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">{{ s.name }}</span>
              <span class="block truncate text-xs text-muted">
                {{ who(s) }} · {{ s.tests.map((t) => t.label).join(', ') }} · {{ s.study_sessions.length }} {{ s.study_sessions.length === 1 ? 'termin' : 'terminy' }}
              </span>
            </span>
            <Icon name="chevron" class="size-4 shrink-0 text-subtle" />
          </RouterLink>
        </li>
      </ul>
    </div>
  </main>
</template>
