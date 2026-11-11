<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import type { ConsultationRequest } from '@/types'
import Icon from '@/components/Icon.vue'
import RescheduleSheet from '@/components/RescheduleSheet.vue'
import { applyOffer, offers, offerUrl, offerWho, setOfferStatus, slotKey, slotLabel, type RescheduleOffer, type WeeklySlot } from '@/lib/reschedule'
import { useClientsStore } from '@/stores/clients'
import { useCalendarStore } from '@/stores/calendar'

const router = useRouter()
const schedule = useScheduleStore()
const error = ref('')
const copied = ref(false)
const link = `${window.location.origin}/konsultacja`

onMounted(() => schedule.loadRequests().catch((e) => (error.value = e.message)))

// ===== Stałe terminy wybrane przez klientów / nowe osoby – do akceptacji =====
const clients = useClientsStore()
const calendar = useCalendarStore()
const termOffers = ref<RescheduleOffer[]>([])
const proposing = ref(false)
const busyId = ref<string | null>(null)
async function loadOffers() {
  await Promise.all([clients.load(), calendar.gyms.length ? null : calendar.loadGyms().catch(() => null)])
  termOffers.value = await offers().catch(() => [])
}
onMounted(loadOffers)
const waiting = computed(() => termOffers.value.filter((o) => o.status === 'chosen'))
const sentNew = computed(() => termOffers.value.filter((o) => o.status === 'open' && !o.client_id))
const nameOf = (o: RescheduleOffer) => offerWho(o, o.client_id ? clients.byId(o.client_id)?.full_name : null)
// Terminy do przyjęcia: domyślnie pierwszy priorytetowy; trenerka może zaznaczyć kilka (także z rezerwowych).
const picks = ref<Record<string, string[]>>({})
const pickedOf = (o: RescheduleOffer) => picks.value[o.id] ?? (o.chosen ? [slotKey(o.chosen)] : [])
function togglePick(o: RescheduleOffer, s: WeeklySlot) {
  const cur = [...pickedOf(o)]
  const k = slotKey(s)
  const i = cur.indexOf(k)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(k)
  picks.value = { ...picks.value, [o.id]: cur }
}
const allSlots = (o: RescheduleOffer) => [...(o.preferred ?? (o.chosen ? [o.chosen] : [])), ...(o.backup ?? [])]
const pickedSlots = (o: RescheduleOffer) => allSlots(o).filter((s) => pickedOf(o).includes(slotKey(s)))
async function accept(o: RescheduleOffer) {
  const chosen = pickedSlots(o)
  if (!chosen.length) return
  if (!confirm(`${o.client_id ? 'Zmienić stały termin' : 'Dodać nowego klienta i stały termin'}: ${nameOf(o)} – ${chosen.map(slotLabel).join(', ')}?`)) return
  busyId.value = o.id
  error.value = ''
  try {
    const id = await applyOffer(o, schedule, calendar.defaultGym?.id ?? null, chosen)
    await clients.load(true).catch(() => null)
    termOffers.value = termOffers.value.filter((x) => x.id !== o.id)
    router.push(`/klienci/${id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busyId.value = null
  }
}
async function reject(o: RescheduleOffer) {
  if (!confirm(`Odrzucić wybór ${nameOf(o)}?`)) return
  await setOfferStatus(o.id, 'cancelled')
  termOffers.value = termOffers.value.filter((x) => x.id !== o.id)
}

const STATUS: Record<ConsultationRequest['status'], string> = { new: 'Nowe', contacted: 'Kontakt', converted: 'Klient', rejected: 'Odrzucone' }
const open = computed(() => schedule.requests.filter((r) => r.status === 'new' || r.status === 'contacted'))
const closed = computed(() => schedule.requests.filter((r) => r.status === 'converted' || r.status === 'rejected'))

async function copy() {
  try {
    await navigator.clipboard.writeText(link)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    error.value = 'Nie udało się skopiować – zaznacz link ręcznie.'
  }
}

function toClient(r: ConsultationRequest) {
  // W adresie tylko id zgłoszenia – dane osobowe (i zdrowotne z wiadomości) nie trafiają do URL ani historii.
  router.push({ path: '/klienci/nowy', query: { req: r.id } })
}
</script>

<template>
  <main class="pb-8">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-2xl font-bold">Zgłoszenia</h1>
    </header>
    <div class="space-y-5 px-4">
      <section class="card space-y-2 p-4">
        <p class="font-semibold">Link dla nowych klientów</p>
        <p class="text-sm text-muted">Wyślij go np. na Messengerze – osoba zostawia kontakt bez zakładania konta.</p>
        <div class="flex gap-2">
          <input :value="link" readonly class="input flex-1 text-sm" aria-label="Link do formularza konsultacji" @focus="($event.target as HTMLInputElement).select()" />
          <button class="btn-primary" @click="copy">{{ copied ? 'Skopiowano' : 'Kopiuj' }}</button>
        </div>
      </section>

      <section class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-xl font-bold">Stałe terminy</h2>
          <button class="btn-ghost !min-h-10 border border-line-strong text-sm" @click="proposing = true"><Icon name="plus" class="size-4" />Terminy dla nowej osoby</button>
        </div>
        <p v-if="!waiting.length" class="text-sm text-muted">Brak wyborów do akceptacji.</p>
        <article v-for="o in waiting" :key="o.id" class="card space-y-2 border-primary/50 p-4">
          <p class="font-semibold">
            {{ nameOf(o) }} <span v-if="!o.client_id" class="tag ml-1">nowa osoba</span>
          </p>
          <div v-if="o.preferred?.length" class="space-y-1.5 text-sm">
            <p class="text-muted">Zaznacz terminy do przyjęcia (kilka = kilka treningów w tygodniu):</p>
            <div v-for="[title, list] in ([['★ Najbardziej pasuje', o.preferred], ['Może też', o.backup ?? []]] as [string, WeeklySlot[]][]).filter((x) => x[1].length)" :key="title">
              <p class="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{{ title }}</p>
              <div class="flex flex-wrap gap-1.5">
                <button v-for="s in list" :key="slotKey(s)" type="button" :class="pickedOf(o).includes(slotKey(s)) ? 'chip-on' : 'chip-off'" :aria-pressed="pickedOf(o).includes(slotKey(s))" @click="togglePick(o, s)">
                  {{ slotLabel(s) }}<span v-if="s.gym_id && calendar.gyms.length > 1" class="ml-1 opacity-75">· {{ calendar.gymById(s.gym_id)?.code ?? '' }}</span>
                </button>
              </div>
            </div>
          </div>
          <p v-else class="text-sm">
            Wybrany termin: <strong>{{ o.chosen ? slotLabel(o.chosen) : '—' }}</strong>
            <span v-if="o.chosen?.gym_id" class="text-muted"> · {{ calendar.gymById(o.chosen.gym_id)?.name }}</span>
          </p>
          <p v-if="!o.client_id" class="text-sm text-muted">{{ [o.contact_phone, o.contact_email].filter(Boolean).join(' · ') }}</p>
          <p v-if="o.chosen_note" class="text-sm italic">„{{ o.chosen_note }}”</p>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn-ghost border border-line-strong" :disabled="busyId === o.id" @click="reject(o)">Odrzuć</button>
            <button class="btn-primary" :disabled="busyId === o.id || !pickedSlots(o).length" @click="accept(o)">{{ busyId === o.id ? 'Dodawanie…' : pickedSlots(o).length > 1 ? `Akceptuj ${pickedSlots(o).length} terminy` : 'Akceptuj i dodaj do grafiku' }}</button>
          </div>
        </article>
        <details v-if="sentNew.length" class="text-sm">
          <summary class="cursor-pointer text-muted">Wysłane do nowych osób, bez wyboru ({{ sentNew.length }})</summary>
          <ul class="mt-2 space-y-1">
            <li v-for="o in sentNew" :key="o.id" class="flex items-center gap-2">
              <span class="flex-1 truncate">{{ o.prospect_name ?? 'bez nazwy' }} · {{ o.slots.length }} terminów</span>
              <a :href="offerUrl(o)" target="_blank" rel="noopener" class="underline">link</a>
              <button class="text-danger underline" @click="setOfferStatus(o.id, 'cancelled').then(loadOffers)">anuluj</button>
            </li>
          </ul>
        </details>
      </section>

      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <p v-if="!schedule.requests.length" class="text-center text-muted">Brak zgłoszeń.</p>

      <ul class="space-y-2">
        <li v-for="r in [...open, ...closed]" :key="r.id" class="card space-y-2 p-4" :class="closed.includes(r) ? 'opacity-70' : ''">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-semibold">{{ r.full_name }}</p>
              <p class="text-sm text-muted">{{ new Date(r.created_at).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }) }}</p>
            </div>
            <span class="tag" :class="r.status === 'new' ? '!bg-primary-soft !text-primary-fg' : ''">{{ STATUS[r.status] }}</span>
          </div>
          <div class="flex flex-wrap gap-2 text-sm">
            <a v-if="r.phone" :href="`tel:${r.phone}`" class="btn-ghost !min-h-10">{{ r.phone }}</a>
            <a v-if="r.email" :href="`mailto:${r.email}`" class="btn-ghost !min-h-10 max-w-full truncate">{{ r.email }}</a>
          </div>
          <p v-if="r.preferred_at" class="text-sm">Preferuje: <strong>{{ new Date(r.preferred_at).toLocaleString('pl-PL', { dateStyle: 'full', timeStyle: 'short' }) }}</strong></p>
          <p v-if="r.message" class="text-sm whitespace-pre-line">{{ r.message }}</p>
          <div v-if="r.status === 'new' || r.status === 'contacted'" class="grid grid-cols-3 gap-2 pt-1">
            <button v-if="r.status === 'new'" class="btn-ghost !px-2 text-sm" @click="schedule.setRequestStatus(r.id, 'contacted')">Kontakt</button>
            <button class="btn-primary !px-2 text-sm" :class="r.status !== 'new' ? 'col-span-2' : ''" @click="toClient(r)">Dodaj klienta</button>
            <button class="btn-ghost !px-2 text-sm" @click="schedule.setRequestStatus(r.id, 'rejected')">Odrzuć</button>
          </div>
        </li>
      </ul>
    </div>
    <RescheduleSheet v-if="proposing" @close="((proposing = false), loadOffers())" />
  </main>
</template>
