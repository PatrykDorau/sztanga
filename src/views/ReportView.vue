<script setup lang="ts">
// Raport miesięczny: dla każdej siłowni osobno zestawienie dla recepcji (treningi personalne + zajęcia grupowe,
// kopiowanie do arkusza, PDF), a w zakładce „Wszystkie” – liczba sesji i odwołań na klienta.
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useCalendarStore } from '@/stores/calendar'
import { buildReport, excelCsv, groupTsv, loadMonth, monthFromKey, monthKey, monthLabel, personalTsv } from '@/lib/gymReport'
import Icon from '@/components/Icon.vue'

const route = useRoute()
const router = useRouter()
const clients = useClientsStore()
const cal = useCalendarStore()
const month = ref(route.query.m ? monthFromKey(String(route.query.m)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const tab = ref<string>(String(route.query.g ?? ''))
const loading = ref(false)
const error = ref('')
const data = ref<Awaited<ReturnType<typeof loadMonth>> | null>(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await loadMonth(month.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await Promise.all([clients.load(), cal.gyms.length ? null : cal.loadGyms()])
  if (!tab.value) tab.value = cal.defaultGym?.id ?? cal.gyms[0]?.id ?? 'all'
  await load()
})
watch(month, load)
watch([month, tab], () => router.replace({ query: { m: monthKey(month.value), g: tab.value } }))
const shift = (n: number) => (month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1))
const name = (id: string) => clients.byId(id)?.full_name ?? 'Klient'

// ----- Zestawienie dla siłowni -----
const gym = computed(() => cal.gyms.find((g) => g.id === tab.value) ?? null)
const report = computed(() => (data.value && gym.value ? buildReport(data.value, gym.value, name) : null))
const plannedCount = computed(() => report.value?.personal.filter((r) => r.planned).length ?? 0)
const missingPeople = computed(() => report.value?.groups.filter((g) => g.participants == null && g.at < new Date().toISOString()).length ?? 0)
const copied = ref('')
async function copy(kind: 'personal' | 'groups') {
  if (!report.value) return
  await navigator.clipboard.writeText(kind === 'personal' ? personalTsv(report.value.personal) : groupTsv(report.value.groups))
  copied.value = kind
  setTimeout(() => (copied.value = ''), 1800)
}

/** Plik .csv dla Excela – obie tabele, nazwa: siłownia + miesiąc. */
function downloadExcel() {
  if (!report.value || !gym.value) return
  const blob = new Blob([excelCsv(report.value)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${gym.value.name} ${monthLabel(month.value)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ----- Wszystkie: liczba sesji na klienta -----
const rows = computed(() => {
  const map = new Map<string, { done: number; planned: number; cancelled: number; noShow: number }>()
  for (const s of data.value?.sessions ?? []) {
    const r = map.get(s.client_id) ?? { done: 0, planned: 0, cancelled: 0, noShow: 0 }
    if (s.status === 'completed') r.done++
    else if (s.status === 'cancelled') r.cancelled++
    else if (s.status === 'no_show') r.noShow++
    else r.planned++
    map.set(s.client_id, r)
  }
  return [...map.entries()].map(([id, r]) => ({ id, name: name(id), ...r })).sort((a, b) => b.done + b.planned - (a.done + a.planned))
})
const total = computed(() => rows.value.reduce((t, r) => ({ done: t.done + r.done, planned: t.planned + r.planned, cancelled: t.cancelled + r.cancelled, noShow: t.noShow + r.noShow }), { done: 0, planned: 0, cancelled: 0, noShow: 0 }))
const groupTotal = computed(() => (data.value?.groups ?? []).filter((g) => !g.cancelled).length)
</script>

<template>
  <main class="pb-8">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-2xl font-bold">Raport</h1>
    </header>
    <div class="space-y-4 px-4">
      <div class="flex items-center justify-between">
        <button class="icon-btn -ml-2" aria-label="Poprzedni miesiąc" @click="shift(-1)"><Icon name="back" class="size-5" /></button>
        <p class="font-display text-xl font-bold capitalize">{{ monthLabel(month) }}</p>
        <button class="icon-btn -mr-2" aria-label="Następny miesiąc" @click="shift(1)"><Icon name="chevron" class="size-5" /></button>
      </div>

      <div class="flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Siłownia">
        <button v-for="g in cal.gyms" :key="g.id" role="tab" :aria-selected="tab === g.id" class="min-h-10 flex-1 rounded-lg text-sm font-semibold" :class="tab === g.id ? 'bg-surface shadow' : 'text-muted'" @click="tab = g.id">{{ g.name }}</button>
        <button role="tab" :aria-selected="tab === 'all'" class="min-h-10 flex-1 rounded-lg text-sm font-semibold" :class="tab === 'all' ? 'bg-surface shadow' : 'text-muted'" @click="tab = 'all'">Wszystkie</button>
      </div>

      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <p v-if="loading && !data" class="text-muted">Ładowanie…</p>

      <!-- Zestawienie dla siłowni -->
      <template v-else-if="gym && report">
        <div class="flex items-center gap-2">
          <p class="min-w-0 flex-1 text-sm text-muted">Zestawienie dla recepcji {{ gym.name }} – bez kwot.</p>
          <button class="btn-ghost !min-h-10 shrink-0 border border-line-strong px-3 text-sm" @click="downloadExcel"><Icon name="download" class="size-4" />Excel</button>
          <RouterLink :to="`/grafik/raport/druk?m=${monthKey(month)}&g=${gym.id}`" class="btn-primary !min-h-10 shrink-0 px-3 text-sm"><Icon name="download" class="size-4" />PDF</RouterLink>
        </div>
        <details class="rounded-xl bg-surface-2 p-3 text-sm">
          <summary class="cursor-pointer font-semibold">Jak wkleić do arkusza rozliczeniowego?</summary>
          <ol class="mt-2 list-decimal space-y-1 pl-5 text-muted">
            <li>Otwórz zakładkę miesiąca w arkuszu (Excel albo Arkusze Google).</li>
            <li>„Kopiuj” przy treningach personalnych → kliknij pierwszą pustą komórkę w kolumnie <strong>DZIEŃ</strong> (np. A2) → Ctrl+V (na telefonie: przytrzymaj → Wklej). Wypełnią się tylko kolumny dzień i klient – kwoty obok zostają.</li>
            <li>„Kopiuj” przy zajęciach grupowych → kliknij pierwszą pustą komórkę pod <strong>TRENINGI GRUPOWE</strong> (data) → Ctrl+V. Wkleją się: data, rodzaj, LP, liczba osób.</li>
            <li>Albo „Excel” – plik z obiema tabelami do wysłania recepcji lub skopiowania w całości.</li>
          </ol>
        </details>
        <p v-if="plannedCount" class="warn-box text-sm"><Icon name="clock" class="size-5 shrink-0" />W zestawieniu jest {{ plannedCount }} zaplanowanych treningów, które jeszcze się nie odbyły (oznaczone szarym).</p>
        <p v-if="missingPeople" class="warn-box text-sm"><Icon name="alert" class="size-5 shrink-0" />Brak liczby osób przy {{ missingPeople }} zajęciach – uzupełnij w grafiku (dotknij zajęć).</p>

        <section class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-lg font-bold">Treningi personalne <span class="text-muted tabular-nums">({{ report.personal.length }})</span></h2>
            <button class="btn-ghost !min-h-9 border border-line-strong px-3 text-sm" :disabled="!report.personal.length" @click="copy('personal')"><Icon :name="copied === 'personal' ? 'check' : 'clipboard'" class="size-4" />{{ copied === 'personal' ? 'Skopiowano' : 'Kopiuj' }}</button>
          </div>
          <p v-if="!report.personal.length" class="text-sm text-muted">Brak treningów w tym miesiącu.</p>
          <table v-else class="card w-full overflow-hidden text-sm">
            <thead><tr class="border-b border-line text-left text-xs text-muted"><th class="w-28 p-2 pl-3 font-semibold">Dzień</th><th class="p-2 font-semibold">Klient</th></tr></thead>
            <tbody>
              <tr v-for="r in report.personal" :key="r.id" class="border-b border-line last:border-0" :class="r.planned ? 'text-muted' : ''">
                <td class="p-2 pl-3 tabular-nums">{{ r.date }}</td>
                <td class="p-2">{{ r.client }}<span v-if="r.planned" class="ml-1 text-xs">(plan)</span></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-lg font-bold">Treningi grupowe <span class="text-muted tabular-nums">({{ report.groups.length }})</span></h2>
            <button class="btn-ghost !min-h-9 border border-line-strong px-3 text-sm" :disabled="!report.groups.length" @click="copy('groups')"><Icon :name="copied === 'groups' ? 'check' : 'clipboard'" class="size-4" />{{ copied === 'groups' ? 'Skopiowano' : 'Kopiuj' }}</button>
          </div>
          <p v-if="!report.groups.length" class="text-sm text-muted">Brak zajęć grupowych – dodasz je w grafiku przyciskiem „Zajęcia”.</p>
          <table v-else class="card w-full overflow-hidden text-sm">
            <thead><tr class="border-b border-line text-left text-xs text-muted"><th class="w-28 p-2 pl-3 font-semibold">Data</th><th class="p-2 font-semibold">Rodzaj</th><th class="w-10 p-2 text-center font-semibold">LP</th><th class="w-14 p-2 pr-3 text-right font-semibold">Osoby</th></tr></thead>
            <tbody>
              <tr v-for="r in report.groups" :key="r.id" class="border-b border-line last:border-0">
                <td class="p-2 pl-3 tabular-nums">{{ r.date }}</td>
                <td class="p-2">{{ r.kind }}</td>
                <td class="p-2 text-center tabular-nums">{{ r.lp }}</td>
                <td class="p-2 pr-3 text-right font-semibold tabular-nums">{{ r.participants ?? '–' }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <p class="text-xs text-muted">„Kopiuj” wkleja tabelę do arkusza Google komórka po komórce (dzień | klient; data | rodzaj | LP | osoby). Treningi bez siłowni liczą się do siłowni domyślnej.</p>
      </template>

      <!-- Wszystkie: statystyka na klienta -->
      <template v-else-if="tab === 'all'">
        <div class="grid grid-cols-4 gap-2">
          <div class="card p-3 text-center"><p class="font-display text-2xl font-bold tabular-nums text-success">{{ total.done }}</p><p class="text-[11px] text-muted">odbyte</p></div>
          <div class="card p-3 text-center"><p class="font-display text-2xl font-bold tabular-nums">{{ total.planned }}</p><p class="text-[11px] text-muted">zaplan.</p></div>
          <div class="card p-3 text-center"><p class="font-display text-2xl font-bold tabular-nums text-danger">{{ total.cancelled + total.noShow }}</p><p class="text-[11px] text-muted">odwołane</p></div>
          <div class="card p-3 text-center"><p class="font-display text-2xl font-bold tabular-nums text-primary-fg">{{ groupTotal }}</p><p class="text-[11px] text-muted">grupowe</p></div>
        </div>
        <p v-if="!rows.length" class="text-center text-muted">Brak sesji w tym miesiącu.</p>
        <table v-else class="card w-full overflow-hidden text-sm">
          <thead>
            <tr class="border-b border-line text-left text-xs text-muted">
              <th class="p-3 font-semibold">Klient</th>
              <th class="p-3 text-center font-semibold">Odbyte</th>
              <th class="p-3 text-center font-semibold">Plan</th>
              <th class="p-3 text-center font-semibold">Odw.</th>
              <th class="p-3 text-center font-semibold">Nieob.</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id" class="border-b border-line last:border-0">
              <td class="p-3"><RouterLink :to="`/klienci/${r.id}`" class="font-semibold underline-offset-4 hover:underline">{{ r.name }}</RouterLink></td>
              <td class="p-3 text-center tabular-nums">{{ r.done }}</td>
              <td class="p-3 text-center tabular-nums">{{ r.planned }}</td>
              <td class="p-3 text-center tabular-nums">{{ r.cancelled }}</td>
              <td class="p-3 text-center tabular-nums">{{ r.noShow }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </main>
</template>
