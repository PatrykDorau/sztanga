<script setup lang="ts">
// Dostępność trenerki: tygodniowy szablon godzin, wyjątki (urlop, choroba, dodatkowe godziny) i zasady rezerwacji.
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import { time5 } from '@/lib/dates'
import { WEEKDAYS } from '@/lib/vocab'
import type { BookingSettings } from '@/types'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const schedule = useScheduleStore()
const busy = ref(false)
const error = ref('')
const saved = ref(false)

const adding = ref<number | null>(null)
const range = reactive({ start: '16:00', end: '20:00' })
const exc = reactive({ day: '', kind: 'off' as 'off' | 'extra', start: '10:00', end: '14:00', reason: '' })
const s = reactive<BookingSettings>({
  session_minutes: 60,
  slot_step_minutes: 30,
  min_notice_hours: 12,
  cancel_limit_hours: 24,
  booking_horizon_days: 28,
  require_approval: false,
})

onMounted(async () => {
  try {
    await Promise.all([schedule.loadAvailability(), schedule.loadSettings()])
    Object.assign(s, schedule.settings)
  } catch (e) {
    error.value = (e as Error).message
  }
})

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

const rulesFor = (wd: number) => schedule.rules.filter((r) => r.weekday === wd)
const addRule = (wd: number) =>
  run(async () => {
    if (range.end <= range.start) throw new Error('Koniec musi być po początku.')
    await schedule.addRule(wd, range.start, range.end)
    adding.value = null
  })

const addException = () =>
  run(async () => {
    if (!exc.day) throw new Error('Wybierz dzień.')
    await schedule.addException({
      day: exc.day,
      is_extra: exc.kind === 'extra',
      start_time: exc.kind === 'extra' ? exc.start : null,
      end_time: exc.kind === 'extra' ? exc.end : null,
      reason: exc.reason.trim() || null,
    })
    exc.day = ''
    exc.reason = ''
  })

const saveSettings = () =>
  run(async () => {
    await schedule.saveSettings({ ...s })
    saved.value = true
    setTimeout(() => (saved.value = false), 1500)
  })

const fmtDay = (d: string) => new Date(d + 'T12:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long' })
</script>

<template>
  <main class="pb-8">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-2xl font-bold">Dostępność</h1>
    </header>

    <div class="space-y-6 px-4">
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>

      <section>
        <h2 class="mb-1 text-xl font-bold">Tydzień pracy</h2>
        <p class="mb-3 text-sm text-muted">W tych godzinach klienci widzą wolne terminy do rezerwacji.</p>
        <ul class="card divide-y divide-line">
          <li v-for="(name, i) in WEEKDAYS" :key="i" class="px-3 py-2">
            <div class="flex items-center gap-2">
              <span class="w-24 shrink-0 font-semibold">{{ name }}</span>
            <div class="flex min-w-0 flex-1 flex-wrap gap-2">
              <span v-for="r in rulesFor(i + 1)" :key="r.id" class="inline-flex min-h-9 items-center gap-1 rounded-full bg-primary-soft pl-3 text-sm font-semibold text-primary-fg tabular-nums">
                {{ time5(r.start_time) }}–{{ time5(r.end_time) }}
                <button class="flex size-9 items-center justify-center rounded-full" :aria-label="`Usuń ${time5(r.start_time)}–${time5(r.end_time)}`" :disabled="busy" @click="run(() => schedule.removeRule(r.id))">
                  <Icon name="x" class="size-4" />
                </button>
              </span>
              <span v-if="!rulesFor(i + 1).length" class="py-2 text-sm text-muted">wolne</span>
            </div>
              <button class="icon-btn -mr-2 shrink-0" :aria-label="`Dodaj godziny – ${name}`" @click="adding = adding === i + 1 ? null : i + 1"><Icon name="plus" class="size-5" /></button>
            </div>
            <form v-if="adding === i + 1" class="mt-2 flex items-end gap-2" @submit.prevent="addRule(i + 1)">
              <label class="flex-1"><span class="label">Od</span><input v-model="range.start" type="time" step="900" class="input" /></label>
              <label class="flex-1"><span class="label">Do</span><input v-model="range.end" type="time" step="900" class="input" /></label>
              <button class="btn-primary" :disabled="busy">Dodaj</button>
            </form>
          </li>
        </ul>
      </section>

      <section>
        <h2 class="mb-1 text-xl font-bold">Wyjątki</h2>
        <p class="mb-3 text-sm text-muted">Urlop, choroba albo dodatkowe godziny w konkretny dzień.</p>
        <form class="card space-y-3 p-4" @submit.prevent="addException">
          <div class="grid grid-cols-2 gap-2">
            <button type="button" :class="exc.kind === 'off' ? 'chip-on' : 'chip-off'" class="justify-center" @click="exc.kind = 'off'">Dzień wolny</button>
            <button type="button" :class="exc.kind === 'extra' ? 'chip-on' : 'chip-off'" class="justify-center" @click="exc.kind = 'extra'">Dodatkowe godziny</button>
          </div>
          <label class="block"><span class="label">Dzień</span><input v-model="exc.day" type="date" class="input" required /></label>
          <div v-if="exc.kind === 'extra'" class="grid grid-cols-2 gap-2">
            <label><span class="label">Od</span><input v-model="exc.start" type="time" step="900" class="input" /></label>
            <label><span class="label">Do</span><input v-model="exc.end" type="time" step="900" class="input" /></label>
          </div>
          <label class="block"><span class="label">Powód (widzisz tylko Ty)</span><input v-model="exc.reason" class="input" placeholder="np. urlop" /></label>
          <button class="btn-primary w-full" :disabled="busy">Dodaj wyjątek</button>
        </form>
        <ul v-if="schedule.exceptions.length" class="mt-3 space-y-2">
          <li v-for="e in schedule.exceptions" :key="e.id" class="card flex items-center gap-3 p-3">
            <Icon :name="e.is_extra ? 'plus' : 'x'" class="size-5 shrink-0" :class="e.is_extra ? 'text-success' : 'text-danger'" />
            <div class="min-w-0 flex-1">
              <p class="font-semibold first-letter:uppercase">{{ fmtDay(e.day) }}</p>
              <p class="text-sm text-muted">{{ e.is_extra ? `dodatkowo ${time5(e.start_time)}–${time5(e.end_time)}` : 'cały dzień wolny' }}{{ e.reason ? ` · ${e.reason}` : '' }}</p>
            </div>
            <button class="icon-btn text-subtle hover:text-danger" aria-label="Usuń wyjątek" :disabled="busy" @click="run(() => schedule.removeException(e.id))"><Icon name="trash" class="size-4" /></button>
          </li>
        </ul>
      </section>

      <section>
        <h2 class="mb-3 text-xl font-bold">Zasady rezerwacji</h2>
        <form class="card space-y-4 p-4" @submit.prevent="saveSettings">
          <div class="grid grid-cols-2 gap-3">
            <label><span class="label">Długość sesji (min)</span><input v-model.number="s.session_minutes" type="number" min="15" max="240" step="15" class="input" /></label>
            <label><span class="label">Co ile start (min)</span>
              <select v-model.number="s.slot_step_minutes" class="input"><option :value="15">15</option><option :value="30">30</option><option :value="60">60</option></select>
            </label>
            <label><span class="label">Rezerwacja min. (h przed)</span><input v-model.number="s.min_notice_hours" type="number" min="0" class="input" /></label>
            <label><span class="label">Odwołanie do (h przed)</span><input v-model.number="s.cancel_limit_hours" type="number" min="0" class="input" /></label>
            <label class="col-span-2"><span class="label">Jak daleko naprzód (dni)</span><input v-model.number="s.booking_horizon_days" type="number" min="1" max="120" class="input" /></label>
          </div>
          <label class="flex min-h-11 items-center gap-3 rounded-xl bg-surface-2 px-3">
            <input v-model="s.require_approval" type="checkbox" class="size-5 accent-primary" />
            <span class="text-[15px]">Rezerwacje klientów wymagają mojej akceptacji</span>
          </label>
          <p class="text-xs text-muted">Później niż {{ s.cancel_limit_hours }} h przed sesją klient nie odwoła jej sam – zobaczy prośbę o kontakt z Tobą.</p>
          <button class="btn-primary w-full" :disabled="busy">{{ saved ? 'Zapisano' : 'Zapisz zasady' }}</button>
        </form>
      </section>
    </div>
  </main>
</template>
