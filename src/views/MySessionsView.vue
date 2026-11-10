<script setup lang="ts">
// Terminy klienta: nadchodzące sesje (z odwołaniem w limicie), rezerwacja wolnego terminu, lista oczekujących.
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useScheduleStore } from '@/stores/schedule'
import { addDays, dayLabel, hm, shortDay, ymd } from '@/lib/dates'
import { SESSION_STATUSES, label } from '@/lib/vocab'
import type { Session } from '@/types'
import Icon from '@/components/Icon.vue'

const schedule = useScheduleStore()
const myClientId = ref<string | null>(null)
const tab = ref<'mine' | 'book'>('mine')
const loading = ref(true)
const error = ref('')
const info = ref('')

const horizon = computed(() => schedule.settings?.booking_horizon_days ?? 28)
const days = computed(() => Array.from({ length: Math.min(horizon.value, 28) }, (_, i) => addDays(new Date(), i)))
const day = ref(ymd(new Date()))
const slots = ref<{ starts_at: string; ends_at: string }[]>([])
const slotsLoading = ref(false)
const picked = ref<string | null>(null)
const cancelling = ref<string | null>(null)
const reason = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    const { data } = await supabase.from('clients').select('id').limit(1).maybeSingle()
    myClientId.value = data?.id ?? null
    await Promise.all([
      schedule.loadSettings(),
      schedule.loadRange(addDays(new Date(), -30), addDays(new Date(), 120)),
      schedule.loadWaitlist(),
    ])
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

const now = () => new Date().toISOString()
const upcoming = computed(() => schedule.sessions.filter((s) => s.ends_at >= now() && s.status !== 'cancelled'))
const past = computed(() => schedule.sessions.filter((s) => s.ends_at < now() || s.status === 'cancelled').reverse().slice(0, 10))
const notified = computed(() => schedule.waitlist.filter((w) => w.notified_at))
const onWaitlist = computed(() => schedule.waitlist.find((w) => w.day === day.value))

const canCancel = (s: Session) =>
  ['pending', 'confirmed'].includes(s.status) &&
  new Date(s.starts_at).getTime() - Date.now() > (schedule.settings?.cancel_limit_hours ?? 24) * 3600_000

async function loadSlots() {
  slotsLoading.value = true
  picked.value = null
  try {
    slots.value = await schedule.freeSlots(day.value, day.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    slotsLoading.value = false
  }
}
watch([tab, day], () => tab.value === 'book' && loadSlots())

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  info.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

const book = () =>
  run(async () => {
    const s = await schedule.book(picked.value!)
    info.value = s.status === 'pending' ? 'Wysłano prośbę o termin – trenerka ją potwierdzi.' : 'Termin zarezerwowany.'
    tab.value = 'mine'
  }).finally(loadSlots)

const cancel = (id: string) =>
  run(async () => {
    await schedule.cancelMine(id, reason.value || undefined)
    cancelling.value = null
    reason.value = ''
    info.value = 'Sesja odwołana.'
  })

const joinWaitlist = () => run(() => schedule.joinWaitlist(myClientId.value!, day.value))
</script>

<template>
  <main class="pb-8">
    <header class="page-header space-y-3 px-4 pb-3">
      <h1 class="page-title">Terminy</h1>
      <div class="grid grid-cols-2 rounded-xl bg-surface-2 p-1">
        <button class="min-h-10 rounded-lg text-sm font-semibold" :class="tab === 'mine' ? 'bg-surface shadow' : 'text-muted'" @click="tab = 'mine'">Moje sesje</button>
        <button class="min-h-10 rounded-lg text-sm font-semibold" :class="tab === 'book' ? 'bg-surface shadow' : 'text-muted'" @click="tab = 'book'">Zarezerwuj</button>
      </div>
    </header>

    <div class="space-y-4 px-4">
      <p v-if="info" class="flex items-center gap-2 rounded-xl bg-success-soft p-3 text-sm font-semibold text-success" role="status"><Icon name="check" class="size-5" />{{ info }}</p>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <div v-if="!loading && !myClientId" class="card p-5 text-sm text-muted">
        Twoje konto nie jest jeszcze powiązane z profilem klienta. Poproś trenerkę o dodanie Cię do aplikacji.
      </div>

      <button v-for="w in notified" :key="w.id" class="warn-box pressable w-full text-left" @click="(tab = 'book'), (day = w.day)">
        <Icon name="bell" class="size-5 shrink-0" />
        <span>Zwolnił się termin {{ new Date(w.day + 'T12:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }) }} – kto pierwszy, ten lepszy.</span>
      </button>

      <template v-if="tab === 'mine'">
        <p v-if="loading" class="text-muted">Ładowanie…</p>
        <div v-else-if="!upcoming.length" class="card p-6 text-center">
          <p class="font-semibold">Brak zaplanowanych sesji</p>
          <button class="btn-primary mt-3" @click="tab = 'book'">Zarezerwuj termin</button>
        </div>
        <ul class="space-y-2">
          <li v-for="s in upcoming" :key="s.id" class="card p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-display text-2xl leading-none font-bold tabular-nums">{{ hm(s.starts_at) }}</p>
                <p class="mt-1 text-sm text-muted first-letter:uppercase">{{ dayLabel(new Date(s.starts_at)) }}</p>
              </div>
              <span class="tag" :class="s.status === 'pending' ? '!bg-warn-soft !text-warn-fg' : ''">{{ label(SESSION_STATUSES, s.status) }}</span>
            </div>
            <template v-if="cancelling === s.id">
              <label class="mt-3 block"><span class="label">Powód (opcjonalnie)</span><input v-model="reason" class="input" /></label>
              <div class="mt-2 grid grid-cols-2 gap-2">
                <button class="btn-ghost" @click="cancelling = null">Wróć</button>
                <button class="btn-danger" :disabled="busy" @click="cancel(s.id)">Odwołaj</button>
              </div>
            </template>
            <button v-else-if="canCancel(s)" class="btn-ghost mt-3 w-full" @click="cancelling = s.id">Odwołaj sesję</button>
            <p v-else-if="['pending', 'confirmed'].includes(s.status)" class="mt-3 text-xs text-muted">
              Do sesji zostało mniej niż {{ schedule.settings?.cancel_limit_hours ?? 24 }} h – żeby odwołać, skontaktuj się z trenerką.
            </p>
          </li>
        </ul>

        <section v-if="past.length">
          <h2 class="mb-2 text-lg font-bold">Historia</h2>
          <ul class="card divide-y divide-line">
            <li v-for="s in past" :key="s.id" class="flex items-center justify-between gap-3 p-3 text-sm">
              <span class="first-letter:uppercase">{{ shortDay(new Date(s.starts_at)) }} · {{ hm(s.starts_at) }}</span>
              <span class="text-muted">{{ label(SESSION_STATUSES, s.status) }}</span>
            </li>
          </ul>
        </section>
      </template>

      <template v-else>
        <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Dzień">
          <button
            v-for="d in days"
            :key="ymd(d)"
            role="tab"
            :aria-selected="ymd(d) === day"
            class="pressable flex min-h-16 min-w-14 shrink-0 flex-col items-center justify-center rounded-xl border px-2 text-xs"
            :class="ymd(d) === day ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface'"
            @click="day = ymd(d)"
          >
            <span class="font-medium capitalize">{{ d.toLocaleDateString('pl-PL', { weekday: 'short' }) }}</span>
            <span class="font-display text-xl leading-none font-bold">{{ d.getDate() }}</span>
          </button>
        </div>

        <p v-if="slotsLoading" class="text-muted">Szukam wolnych godzin…</p>
        <template v-else-if="slots.length">
          <p class="text-sm text-muted">Wybierz godzinę ({{ schedule.settings?.session_minutes ?? 60 }} min):</p>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="sl in slots"
              :key="sl.starts_at"
              class="chip justify-center font-semibold tabular-nums"
              :class="picked === sl.starts_at ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface'"
              :aria-pressed="picked === sl.starts_at"
              @click="picked = sl.starts_at"
            >
              {{ hm(sl.starts_at) }}
            </button>
          </div>
          <button class="btn-primary w-full" :disabled="!picked || busy || !myClientId" @click="book">
            {{ picked ? `Rezerwuję ${hm(picked)}` : 'Wybierz godzinę' }}
          </button>
          <p v-if="schedule.settings?.require_approval" class="text-xs text-muted">Trenerka potwierdza każdą rezerwację.</p>
        </template>
        <div v-else class="card space-y-3 p-5 text-center">
          <p class="font-semibold">Brak wolnych terminów tego dnia</p>
          <template v-if="myClientId">
            <p v-if="onWaitlist" class="text-sm text-muted">Jesteś na liście oczekujących – damy znać, gdy coś się zwolni.</p>
            <button v-if="onWaitlist" class="btn-ghost w-full" :disabled="busy" @click="run(() => schedule.leaveWaitlist(onWaitlist!.id))">Wypisz z listy</button>
            <button v-else class="btn-ghost w-full" :disabled="busy" @click="joinWaitlist"><Icon name="bell" class="size-5" />Zapisz na listę oczekujących</button>
          </template>
        </div>
      </template>
    </div>
  </main>
</template>
