<script setup lang="ts">
// Google Calendar trenerki: połączenie, wybór kalendarza, siłownie (kod + kolor wydarzenia), wydarzenia do przypisania.
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCalendarStore } from '@/stores/calendar'
import { useClientsStore } from '@/stores/clients'
import { GCAL_COLORS } from '@/lib/vocab'
import { dayLabel, hm } from '@/lib/dates'
import type { CalendarBlock, Gym } from '@/types'
import Icon from '@/components/Icon.vue'

const route = useRoute()
const router = useRouter()
const cal = useCalendarStore()
const clients = useClientsStore()

const error = ref('')
const info = ref(route.query.polaczono ? 'Kalendarz połączony – trwa pierwszy import.' : '')
const busy = ref(false)
const calendarList = ref<{ id: string; name: string; primary: boolean; color: string }[]>([])
const todo = ref<CalendarBlock[]>([])

if (route.query.blad) error.value = `Nie udało się połączyć z Google (${route.query.blad}). Spróbuj jeszcze raz.`

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function refresh() {
  await Promise.all([cal.loadStatus(), cal.loadGyms(), clients.load()])
  if (cal.status?.connected) {
    todo.value = await cal.unmatched()
    calendarList.value = await cal.calendars().catch(() => [])
  }
}
onMounted(() => run(refresh).then(() => router.replace({ query: {} })))

// ===== Siłownie =====
const editing = ref<string | 'new' | null>(null)
const gf = reactive({ name: '', code: '', color_id: 11, is_default: false })
function editGym(g?: Gym) {
  editing.value = g?.id ?? 'new'
  Object.assign(gf, g ? { name: g.name, code: g.code, color_id: g.color_id, is_default: g.is_default } : { name: '', code: '', color_id: 2, is_default: false })
}
const saveGym = () =>
  run(async () => {
    const code = gf.code.trim().toUpperCase()
    if (!/^[A-Z0-9]{1,4}$/.test(code)) throw new Error('Skrót: 1–4 litery lub cyfry, np. BW.')
    await cal.saveGym({ name: gf.name.trim(), code, color_id: gf.color_id, is_default: gf.is_default }, editing.value === 'new' ? undefined : editing.value!)
    editing.value = null
  })

// ===== Do przypisania (pogrupowane po tytule – jedno przypisanie łapie wszystkie wystąpienia) =====
const groups = computed(() => {
  const m = new Map<string, CalendarBlock[]>()
  for (const b of todo.value) m.set(b.title ?? '', [...(m.get(b.title ?? '') ?? []), b])
  return [...m.entries()]
})
const pick = reactive<Record<string, string>>({})
const assign = (title: string, clientId: string | null) =>
  run(async () => {
    await cal.assign(title, clientId)
    todo.value = await cal.unmatched()
  })
// Imię z kalendarza przekazujemy przez stan aplikacji, nie w adresie URL (dane osobowe).
function createClient(title: string) {
  cal.pendingAlias = title
  router.push('/klienci/nowy')
}

const lastSync = computed(() =>
  cal.status?.last_sync_at ? new Date(cal.status.last_sync_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : 'jeszcze nie',
)
</script>

<template>
  <main class="pb-8">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.push('/grafik')"><Icon name="back" class="size-6" /></button>
      <h1 class="text-2xl font-bold">Google Calendar</h1>
    </header>

    <div class="space-y-6 px-4">
      <p v-if="info" class="flex items-center gap-2 rounded-xl bg-success-soft p-3 text-sm font-semibold text-success" role="status"><Icon name="check" class="size-5" />{{ info }}</p>
      <p v-if="error" class="warn-box" role="alert"><Icon name="alert" class="size-5 shrink-0" />{{ error }}</p>

      <!-- Połączenie -->
      <section class="card space-y-3 p-4">
        <template v-if="cal.status?.connected">
          <div class="flex items-start gap-3">
            <Icon name="calendar" class="size-6 text-success" />
            <div class="min-w-0 flex-1">
              <p class="font-semibold">Połączono{{ cal.status.email ? ` – ${cal.status.email}` : '' }}</p>
              <p class="text-sm text-muted">Ostatnia synchronizacja: {{ lastSync }} · {{ cal.status.watching ? 'zmiany z Google na bieżąco' : 'co 5 minut' }}</p>
            </div>
          </div>
          <p v-if="cal.status.last_error" class="warn-box"><Icon name="alert" class="size-5 shrink-0" />{{ cal.status.last_error }}</p>
          <label v-if="calendarList.length" class="block">
            <span class="label">Kalendarz do synchronizacji</span>
            <select class="input" :value="cal.status.calendar_id" :disabled="busy" @change="run(() => cal.setCalendar(($event.target as HTMLSelectElement).value))">
              <option v-for="c in calendarList" :key="c.id" :value="c.primary ? 'primary' : c.id">{{ c.name }}{{ c.primary ? ' (główny)' : '' }}</option>
            </select>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn-primary" :disabled="busy || cal.syncing" @click="run(() => cal.syncNow().then(refresh))">
              <Icon name="swap" class="size-5" />{{ cal.syncing ? 'Synchronizuję…' : 'Synchronizuj teraz' }}
            </button>
            <button class="btn-ghost" :disabled="busy" @click="run(() => cal.disconnect())">Odłącz</button>
          </div>
        </template>
        <template v-else>
          <p class="font-semibold">Połącz kalendarz Google</p>
          <ul class="space-y-1 text-sm text-muted">
            <li>• Treningi z kalendarza („Imię Nazwisko (BW)”) pojawią się w grafiku.</li>
            <li>• Wydarzenia „Free” to wolne terminy do rezerwacji dla klientów.</li>
            <li>• Sesje dodane lub odwołane w aplikacji od razu zmieniają kalendarz.</li>
            <li>• Prywatne wydarzenia blokują godziny, klienci nie widzą ich treści.</li>
          </ul>
          <button class="btn-primary w-full" :disabled="busy" @click="run(() => cal.connect())"><Icon name="calendar" class="size-5" />Połącz z Google</button>
        </template>
      </section>

      <!-- Do przypisania -->
      <section v-if="cal.status?.connected">
        <h2 class="mb-1 text-xl font-bold">Do przypisania <span v-if="groups.length" class="text-primary-fg">({{ groups.length }})</span></h2>
        <p class="mb-3 text-sm text-muted">Wydarzenia, które wyglądają na treningi, ale nie pasują do żadnego klienta. Jedno przypisanie obejmuje wszystkie wystąpienia tytułu.</p>
        <p v-if="!groups.length" class="card p-4 text-sm text-muted">Wszystko dopasowane.</p>
        <ul class="space-y-2">
          <li v-for="[title, items] in groups" :key="title" class="card space-y-2 p-4">
            <div class="flex items-baseline justify-between gap-2">
              <p class="font-semibold">{{ title }}</p>
              <span class="text-xs text-muted">{{ items.length }}× · najbliższe {{ dayLabel(new Date(items[0].starts_at)) }} {{ hm(items[0].starts_at) }}</span>
            </div>
            <div class="flex gap-2">
              <select v-model="pick[title]" class="input flex-1" :aria-label="`Klient dla: ${title}`">
                <option value="" disabled selected>Wybierz klienta…</option>
                <option v-for="c in clients.all.filter((x) => !x.archived)" :key="c.id" :value="c.id">{{ c.full_name }}</option>
              </select>
              <button class="btn-primary" :disabled="busy || !pick[title]" @click="assign(title, pick[title])">Przypisz</button>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button class="btn-ghost !min-h-10 text-sm" @click="createClient(title)"><Icon name="plus" class="size-4" />Nowy klient</button>
              <button class="btn-ghost !min-h-10 text-sm" :disabled="busy" @click="assign(title, null)">To nie klient</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Siłownie -->
      <section>
        <div class="mb-1 flex items-center justify-between">
          <h2 class="text-xl font-bold">Siłownie</h2>
          <button class="btn-ghost !min-h-10 text-sm" @click="editGym()"><Icon name="plus" class="size-4" />Dodaj</button>
        </div>
        <p class="mb-3 text-sm text-muted">Skrót trafia do tytułu wydarzenia („Anna Kowalska (BW)”), a kolor – do kolorów w Google Calendar.</p>
        <ul class="space-y-2">
          <li v-for="g in cal.gyms" :key="g.id" class="card flex items-center gap-3 p-3">
            <span class="size-6 shrink-0 rounded-full" :style="{ background: GCAL_COLORS[g.color_id].hex }" :title="GCAL_COLORS[g.color_id].name" />
            <div class="min-w-0 flex-1">
              <p class="font-semibold">{{ g.name }} <span class="tag ml-1">{{ g.code }}</span><span v-if="g.is_default" class="ml-1 text-xs text-muted">domyślna</span></p>
              <p class="text-xs text-muted">kolor: {{ GCAL_COLORS[g.color_id].name }}</p>
            </div>
            <RouterLink :to="`/silownie/${g.id}`" class="chip border-line-strong bg-surface">Sprzęt{{ g.equipment || g.machines ? '' : ' (wszystko)' }}</RouterLink>
            <button class="icon-btn" :aria-label="`Edytuj ${g.name}`" @click="editGym(g)"><Icon name="edit" class="size-5" /></button>
          </li>
        </ul>

        <form v-if="editing" class="card mt-3 space-y-3 p-4" @submit.prevent="saveGym">
          <div class="grid grid-cols-[1fr_6rem] gap-2">
            <label><span class="label">Nazwa</span><input v-model="gf.name" class="input" required /></label>
            <label><span class="label">Skrót</span><input v-model="gf.code" class="input uppercase" maxlength="4" required /></label>
          </div>
          <div>
            <p class="label">Kolor wydarzeń</p>
            <div class="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Kolor wydarzeń">
              <button
                v-for="(c, id) in GCAL_COLORS"
                :key="id"
                type="button"
                role="radio"
                :aria-checked="gf.color_id === Number(id)"
                :aria-label="c.name"
                :title="c.name"
                class="flex size-11 items-center justify-center rounded-full ring-offset-2 ring-offset-surface"
                :class="gf.color_id === Number(id) ? 'ring-2 ring-fg' : ''"
                :style="{ background: c.hex }"
                @click="gf.color_id = Number(id)"
              >
                <Icon v-if="gf.color_id === Number(id)" name="check" class="size-5 text-white" />
              </button>
            </div>
          </div>
          <label class="flex min-h-11 items-center gap-3 rounded-xl bg-surface-2 px-3">
            <input v-model="gf.is_default" type="checkbox" class="size-5 accent-primary" />
            <span class="text-[15px]">Domyślna (dla wydarzeń bez skrótu i koloru)</span>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn-ghost" @click="editing = null">Anuluj</button>
            <button class="btn-primary" :disabled="busy">Zapisz</button>
          </div>
          <button v-if="editing !== 'new'" type="button" class="btn-danger w-full" :disabled="busy" @click="run(() => cal.removeGym(editing as string)).then(() => (editing = null))">
            <Icon name="trash" class="size-4" />Usuń siłownię
          </button>
        </form>
      </section>
    </div>
  </main>
</template>
