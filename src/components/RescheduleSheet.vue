<script setup lang="ts">
// Zmiana stałego terminu: aplikacja proponuje terminy wolne co tydzień (z Twojej dostępności, grafiku i Google Calendar),
// Ty odznaczasz / dopisujesz, klient wybiera pod linkiem, Ty zatwierdzasz – stara seria kończy się, nowa startuje.
import { computed, onMounted, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { useCalendarStore } from '@/stores/calendar'
import {
  applyOffer,
  clientSeries,
  createOffer,
  offers,
  offerUrl,
  setOfferStatus,
  slotKey,
  slotLabel,
  weeklyCandidates,
  WEEKDAY_PL,
  type RescheduleOffer,
  type Series,
  type WeeklySlot,
} from '@/lib/reschedule'
import Icon from '@/components/Icon.vue'

// clientId puste = propozycja dla nowej osoby (jeszcze nie klient) – imię i kontakt poda sama w linku.
const props = defineProps<{ clientId?: string | null; clientName?: string | null }>()
const prospect = ref('')
const emit = defineEmits<{ close: []; changed: [] }>()
const schedule = useScheduleStore()
const calendar = useCalendarStore()

const series = ref<Series[]>([])
const seriesId = ref<string | null>(null)
const list = ref<RescheduleOffer[]>([])
const candidates = ref<WeeklySlot[]>([])
const picked = ref(new Set<string>())
const extra = ref<WeeklySlot[]>([])
const note = ref('')
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const copied = ref<string | null>(null)
const creating = ref(false)

const current = computed(() => series.value.find((s) => s.id === seriesId.value) ?? null)
const duration = computed(() => current.value?.duration_minutes ?? schedule.settings?.session_minutes ?? 60)

async function load() {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([schedule.settings ? null : schedule.loadSettings(), calendar.gyms.length ? null : calendar.loadGyms().catch(() => null)])
    series.value = props.clientId ? await clientSeries(props.clientId) : []
    seriesId.value ??= series.value[0]?.id ?? null
    list.value = props.clientId ? await offers(props.clientId) : []
    creating.value = !list.value.some((o) => o.status === 'open' || o.status === 'chosen')
    await suggest()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** Propozycje: terminy wolne w każdym tygodniu najbliższych 4 tygodni. */
async function suggest() {
  const from = new Date(Date.now() + 864e5)
  const days = 28
  const to = new Date(from.getTime() + (days - 1) * 864e5)
  const free = await schedule.freeSlots(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))
  candidates.value = weeklyCandidates(free, from, days, duration.value)
  picked.value = new Set(candidates.value.map(slotKey))
}

const byDay = computed(() => {
  const all = [...candidates.value, ...extra.value]
  return [1, 2, 3, 4, 5, 6, 7].map((wd) => ({ wd, slots: all.filter((s) => s.weekday === wd) })).filter((d) => d.slots.length)
})
function toggle(s: WeeklySlot) {
  const k = slotKey(s)
  const n = new Set(picked.value)
  if (n.has(k)) n.delete(k)
  else n.add(k)
  picked.value = n
}
function toggleDay(wd: number, on: boolean) {
  const n = new Set(picked.value)
  for (const s of [...candidates.value, ...extra.value].filter((x) => x.weekday === wd)) on ? n.add(slotKey(s)) : n.delete(slotKey(s))
  picked.value = n
}
// Dopisany ręcznie termin (np. poza godzinami dostępności)
const addWd = ref(1)
const addTime = ref('18:00')
function addSlot() {
  const s: WeeklySlot = { weekday: addWd.value, start_time: addTime.value, duration_minutes: duration.value, gym_id: current.value?.gym_id ?? calendar.defaultGym?.id ?? null }
  if (![...candidates.value, ...extra.value].some((x) => slotKey(x) === slotKey(s))) extra.value.push(s)
  picked.value = new Set([...picked.value, slotKey(s)])
}

const chosenSlots = computed(() =>
  [...candidates.value, ...extra.value].filter((s) => picked.value.has(slotKey(s))).map((s) => ({ ...s, duration_minutes: duration.value })),
)
async function create() {
  if (!chosenSlots.value.length) return
  busy.value = true
  error.value = ''
  try {
    const o = await createOffer({ client_id: props.clientId ?? null, prospect_name: prospect.value.trim() || null, series_id: seriesId.value, slots: chosenSlots.value, note: note.value.trim() || null })
    list.value.unshift(o)
    creating.value = false
    await share(o)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function share(o: RescheduleOffer) {
  const url = offerUrl(o)
  if (navigator.share) {
    await navigator.share({ title: 'Zmiana terminu', text: `Wybierz nowy stały termin treningów:`, url }).catch(() => null)
    return
  }
  await navigator.clipboard.writeText(url).catch(() => null)
  copied.value = o.id
  setTimeout(() => (copied.value = null), 2000)
}
async function cancel(o: RescheduleOffer) {
  await setOfferStatus(o.id, 'cancelled')
  list.value = list.value.filter((x) => x.id !== o.id)
}

/** Zatwierdzenie: przyszłe sesje starej serii odwołane („zmiana terminu”), nowa seria od najbliższego wybranego dnia. */
async function apply(o: RescheduleOffer) {
  if (!o.chosen) return
  const s = o.chosen
  const old = series.value.find((x) => x.id === o.series_id)
  if (!confirm(`Zmienić stały termin ${props.clientName} na ${slotLabel(s)}?${old ? `\nPrzyszłe sesje z ${slotLabel({ weekday: old.weekday, start_time: old.start_time.slice(0, 5) })} zostaną odwołane.` : ''}`)) return
  busy.value = true
  error.value = ''
  try {
    await applyOffer(o, schedule, calendar.defaultGym?.id ?? null)
    if (props.clientId) series.value = await clientSeries(props.clientId)
    emit('changed')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
const gymName = (id: string | null) => calendar.gymById(id)?.code ?? ''
const hm = (t: string) => t.slice(0, 5)
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="rs-h" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="sheet space-y-4 sm:max-w-lg">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 id="rs-h" class="text-lg font-semibold">Zmiana stałego terminu</h2>
          <p class="text-sm text-muted">{{ clientName ?? 'Nowa osoba – poda imię i kontakt w linku' }}</p>
        </div>
        <button type="button" class="icon-btn -m-2" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      </div>
      <p v-if="loading" class="text-sm text-muted">Sprawdzanie wolnych terminów…</p>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>

      <!-- Wysłane propozycje -->
      <ul v-if="list.length" class="space-y-2">
        <li v-for="o in list" :key="o.id" class="rounded-xl bg-surface-2 p-3 text-sm">
          <template v-if="o.status === 'chosen' && o.chosen">
            <p class="font-semibold text-primary-fg">Klient wybrał: {{ slotLabel(o.chosen) }} <span class="text-muted">{{ gymName(o.chosen.gym_id) }}</span></p>
            <p v-if="o.chosen_note" class="mt-1 italic">„{{ o.chosen_note }}”</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button class="btn-primary !min-h-10" :disabled="busy" @click="apply(o)">Zatwierdź zmianę</button>
              <button class="chip border-line-strong bg-surface" @click="cancel(o)">Odrzuć</button>
            </div>
          </template>
          <template v-else-if="o.status === 'open'">
            <p>Wysłano {{ o.slots.length }} terminów – czeka na wybór klienta.</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button class="chip border-line-strong bg-surface" @click="share(o)"><Icon name="share" class="size-4" />{{ copied === o.id ? 'Skopiowano' : 'Wyślij link ponownie' }}</button>
              <a :href="offerUrl(o)" target="_blank" rel="noopener" class="chip border-line-strong bg-surface">Podgląd</a>
              <button class="chip border-line-strong bg-surface text-danger" @click="cancel(o)">Anuluj</button>
            </div>
          </template>
          <p v-else-if="o.status === 'applied'" class="flex items-center gap-1.5 text-success"><Icon name="check" class="size-4" />Zmieniono na {{ o.chosen ? slotLabel(o.chosen) : '—' }}</p>
        </li>
      </ul>

      <template v-if="!loading && creating">
        <div v-if="series.length > 1">
          <label class="label" for="rs-s">Który stały termin zmieniamy?</label>
          <select id="rs-s" v-model="seriesId" class="input">
            <option v-for="s in series" :key="s.id" :value="s.id">{{ WEEKDAY_PL[s.weekday] }} {{ hm(s.start_time) }}</option>
          </select>
        </div>
        <p v-else-if="current" class="text-sm">Obecnie: <strong>{{ WEEKDAY_PL[current.weekday] }} {{ hm(current.start_time) }}</strong> ({{ current.duration_minutes }} min)</p>
        <label v-else-if="!clientId" class="block"><span class="label">Dla kogo (opcjonalnie)</span>
          <input v-model="prospect" class="input" maxlength="120" placeholder="np. Kasia z Instagrama" />
          <span class="mt-1 block text-xs text-muted">Osoba poda imię i telefon w linku. Po Twojej akceptacji powstanie klient i stały termin w grafiku.</span>
        </label>
        <p v-else class="text-sm text-muted">Klient nie ma sesji cyklicznej – po wyborze utworzy się nowa.</p>

        <div>
          <p class="label">Terminy do wyboru (wolne w każdym tygodniu)</p>
          <p v-if="!byDay.length" class="text-sm text-muted">Brak terminów wolnych co tydzień – dopisz własne poniżej albo poszerz dostępność w grafiku.</p>
          <div v-for="d in byDay" :key="d.wd" class="mb-2">
            <div class="mb-1 flex items-center gap-2 text-sm">
              <span class="font-semibold">{{ WEEKDAY_PL[d.wd] }}</span>
              <button type="button" class="text-xs text-muted underline" @click="toggleDay(d.wd, !d.slots.every((s) => picked.has(slotKey(s))))">
                {{ d.slots.every((s) => picked.has(slotKey(s))) ? 'odznacz' : 'zaznacz' }} wszystkie
              </button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="s in d.slots"
                :key="slotKey(s)"
                type="button"
                class="min-h-10 rounded-lg border px-3 text-sm font-semibold tabular-nums"
                :class="picked.has(slotKey(s)) ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface text-muted line-through'"
                :aria-pressed="picked.has(slotKey(s))"
                @click="toggle(s)"
              >
                {{ s.start_time }}
              </button>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-end gap-2">
          <label class="text-sm"><span class="label">Dopisz termin</span>
            <select v-model.number="addWd" class="input !min-h-10">
              <option v-for="n in 7" :key="n" :value="n">{{ WEEKDAY_PL[n] }}</option>
            </select>
          </label>
          <input v-model="addTime" type="time" step="900" class="input !min-h-10 w-28" aria-label="Godzina" />
          <button type="button" class="btn-ghost !min-h-10 border border-line-strong" @click="addSlot"><Icon name="plus" class="size-4" />Dodaj</button>
        </div>

        <label class="block"><span class="label">Wiadomość do klienta (opcjonalnie)</span>
          <input v-model="note" class="input" maxlength="500" placeholder="np. od grudnia zmieniam godziny we wtorki" />
        </label>
        <button class="btn-primary w-full" :disabled="busy || !chosenSlots.length" @click="create">
          {{ busy ? 'Tworzenie…' : `Utwórz link (${chosenSlots.length} ${chosenSlots.length === 1 ? 'termin' : 'terminów'})` }}
        </button>
        <p class="text-xs text-muted">Klient wybiera jeden termin bez logowania. Nic się nie zmienia, dopóki nie zatwierdzisz.</p>
      </template>
      <button v-else-if="!loading" class="btn-ghost w-full border border-line-strong" @click="creating = true"><Icon name="plus" class="size-5" />Nowa propozycja terminów</button>
    </div>
  </div>
</template>
