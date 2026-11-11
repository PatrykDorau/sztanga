<script setup lang="ts">
// Link dla klienta (bez konta): wybór nowego stałego terminu spośród zaproponowanych przez trenerkę.
import { computed, onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { slotKey, slotLabel, WEEKDAY_PL, type WeeklySlot } from '@/lib/reschedule'
import Icon from '@/components/Icon.vue'

interface Offer {
  first_name: string | null
  is_new: boolean
  contact_name: string | null
  current: { weekday: number; start_time: string; duration_minutes: number } | null
  slots: WeeklySlot[]
  note: string | null
  status: 'open' | 'chosen' | 'applied'
  chosen: WeeklySlot | null
  preferred: WeeklySlot[] | null
  backup: WeeklySlot[] | null
  gyms: Record<string, string>
}
const props = defineProps<{ token: string }>()
const o = ref<Offer | null>(null)
const state = ref<'loading' | 'ok' | 'missing'>('loading')
const sel = ref<number | null>(null)
// Nowa osoba: kilka terminów „najbardziej mi pasuje” (max 5) i dowolnie dużo „mogę też”.
const pref = ref<number[]>([])
const backup = ref<number[]>([])
const mode = ref<'pref' | 'backup'>('pref')
const MAX_PREF = 5
function tap(i: number) {
  if (!o.value?.is_new) {
    sel.value = i
    return
  }
  const inP = pref.value.indexOf(i)
  const inB = backup.value.indexOf(i)
  if (mode.value === 'pref') {
    if (inP >= 0) return void pref.value.splice(inP, 1)
    if (inB >= 0) backup.value.splice(inB, 1)
    if (pref.value.length < MAX_PREF) pref.value.push(i)
  } else {
    if (inB >= 0) return void backup.value.splice(inB, 1)
    if (inP >= 0) pref.value.splice(inP, 1)
    backup.value.push(i)
  }
}
const state2 = (i: number) => (o.value?.is_new ? (pref.value.includes(i) ? 'pref' : backup.value.includes(i) ? 'backup' : null) : sel.value === i ? 'pref' : null)
const ready = computed(() => (o.value?.is_new ? pref.value.length > 0 : sel.value != null))
const msg = ref('')
const busy = ref(false)
const error = ref('')
const editing = ref(false)
const who = ref({ name: '', phone: '', email: '' })
const contactOk = computed(() => !o.value?.is_new || (who.value.name.trim().length >= 2 && (who.value.phone.replace(/\D/g, '').length >= 6 || who.value.email.includes('@'))))

async function load() {
  const { data, error: e } = await supabase.rpc('reschedule_offer', { link_token: props.token })
  if (e || !data) {
    state.value = 'missing'
    return
  }
  o.value = data as Offer
  // „Zmień wybór” zaczyna od poprzednich zaznaczeń.
  const ix = (list: WeeklySlot[] | null) => (list ?? []).map((s) => o.value!.slots.findIndex((x) => slotKey(x) === slotKey(s))).filter((i) => i >= 0)
  pref.value = ix(o.value.preferred)
  backup.value = ix(o.value.backup)
  state.value = 'ok'
}
onMounted(load)

const byDay = computed(() =>
  [1, 2, 3, 4, 5, 6, 7]
    .map((wd) => ({ wd, slots: (o.value?.slots ?? []).map((s, i) => ({ s, i })).filter((x) => x.s.weekday === wd) }))
    .filter((d) => d.slots.length),
)
const multiGym = computed(() => new Set((o.value?.slots ?? []).map((s) => s.gym_id)).size > 1)

async function choose() {
  if (!ready.value || !o.value) return
  busy.value = true
  error.value = ''
  const contact = { p_note: msg.value.trim() || null, p_name: who.value.name.trim() || null, p_phone: who.value.phone.trim() || null, p_email: who.value.email.trim() || null }
  const { data, error: e } = o.value.is_new
    ? await supabase.rpc('choose_reschedule_multi', { link_token: props.token, pref: pref.value, backup_ix: backup.value, ...contact })
    : await supabase.rpc('choose_reschedule', { link_token: props.token, slot_index: sel.value, ...contact })
  busy.value = false
  if (e || !data) {
    error.value = 'Nie udało się zapisać wyboru – możliwe, że trenerka już zatwierdziła zmianę. Odśwież stronę.'
    return
  }
  editing.value = false
  await load()
}
</script>

<template>
  <main class="mx-auto max-w-md px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
    <p v-if="state === 'loading'" class="pt-10 text-center text-muted">Ładowanie…</p>
    <div v-else-if="state === 'missing'" class="card mt-10 p-6 text-center">
      <h1 class="text-xl font-bold">Link jest nieaktywny</h1>
      <p class="mt-2 text-sm text-muted">Propozycja wygasła albo została anulowana. Napisz do trenerki.</p>
    </div>
    <template v-else-if="o">
      <header class="mb-5">
        <h1 class="font-display text-3xl font-bold">{{ o.first_name ? `Cześć ${o.first_name}! ` : 'Cześć! ' }}{{ o.is_new ? 'Wybierz stały termin treningów' : 'Wybierz nowy stały termin' }}</h1>
        <p v-if="o.current" class="mt-1 text-sm text-muted">Obecnie: {{ WEEKDAY_PL[o.current.weekday] }} {{ o.current.start_time }} ({{ o.current.duration_minutes }} min)</p>
        <p v-if="o.note" class="mt-3 rounded-xl bg-surface-2 p-3 text-sm">„{{ o.note }}”</p>
      </header>

      <div v-if="o.status === 'applied'" class="card space-y-2 p-5 text-center">
        <Icon name="check" class="mx-auto size-10 text-success" />
        <p class="text-lg font-semibold">Gotowe – nowy termin: {{ o.chosen ? slotLabel(o.chosen) : '' }}</p>
        <p class="text-sm text-muted">Trenerka zatwierdziła termin. Kolejne treningi są już w grafiku.</p>
      </div>
      <div v-else-if="o.status === 'chosen' && o.chosen && !editing" class="card space-y-3 p-5 text-center">
        <Icon name="clock" class="mx-auto size-10 text-primary-fg" />
        <template v-if="o.preferred?.length">
          <p class="text-lg font-semibold">Najbardziej pasuje: {{ o.preferred.map(slotLabel).join(', ') }}</p>
          <p v-if="o.backup?.length" class="text-sm">Mogę też: {{ o.backup.map(slotLabel).join(', ') }}</p>
        </template>
        <p v-else class="text-lg font-semibold">Wybrano: {{ slotLabel(o.chosen) }}</p>
        <p class="text-sm text-muted">{{ o.is_new ? 'Trenerka potwierdzi termin i wpisze Cię do grafiku.' : 'Trenerka potwierdzi zmianę – do tego czasu obowiązuje stary termin.' }}</p>
        <button class="btn-ghost w-full border border-line-strong" @click="editing = true">Zmień wybór</button>
      </div>
      <form v-else class="space-y-4" @submit.prevent="choose">
        <div v-if="o.is_new" class="space-y-2">
          <p class="text-sm">Zaznacz terminy, które Ci pasują: najpierw te <strong>najlepsze</strong>, potem te, które <strong>też wchodzą w grę</strong>. Trenerka dobierze termin (albo kilka, jeśli trenujesz częściej).</p>
          <div class="flex rounded-xl bg-surface-2 p-1" role="group" aria-label="Co zaznaczam">
            <button type="button" class="min-h-10 flex-1 rounded-lg text-sm font-semibold" :class="mode === 'pref' ? 'bg-primary text-on-primary shadow' : 'text-muted'" :aria-pressed="mode === 'pref'" @click="mode = 'pref'">★ Najbardziej mi pasuje ({{ pref.length }}/{{ MAX_PREF }})</button>
            <button type="button" class="min-h-10 flex-1 rounded-lg text-sm font-semibold" :class="mode === 'backup' ? 'bg-surface text-fg shadow' : 'text-muted'" :aria-pressed="mode === 'backup'" @click="mode = 'backup'">Mogę też ({{ backup.length }})</button>
          </div>
        </div>
        <fieldset v-for="d in byDay" :key="d.wd">
          <legend class="mb-1.5 font-semibold">{{ WEEKDAY_PL[d.wd] }}</legend>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="x in d.slots"
              :key="slotKey(x.s)"
              type="button"
              class="min-h-12 rounded-xl border text-base font-semibold tabular-nums"
              :class="state2(x.i) === 'pref' ? 'border-primary bg-primary text-on-primary' : state2(x.i) === 'backup' ? 'border-2 border-dashed border-primary bg-primary-soft text-fg' : 'border-line-strong bg-surface'"
              :aria-pressed="!!state2(x.i)"
              :aria-label="`${WEEKDAY_PL[d.wd]} ${x.s.start_time}${state2(x.i) === 'pref' ? ' – najbardziej pasuje' : state2(x.i) === 'backup' ? ' – mogę też' : ''}`"
              @click="tap(x.i)"
            >
              <span v-if="state2(x.i) === 'pref' && o.is_new" class="mr-1 text-xs align-top">★{{ pref.indexOf(x.i) + 1 }}</span>{{ x.s.start_time }}<span v-if="multiGym && x.s.gym_id" class="block text-[11px] font-normal opacity-80">{{ o.gyms[x.s.gym_id] }}</span>
            </button>
          </div>
        </fieldset>
        <fieldset v-if="o.is_new" class="space-y-3">
          <legend class="mb-1.5 font-semibold">Twoje dane</legend>
          <label class="block"><span class="label">Imię i nazwisko</span><input v-model="who.name" class="input" maxlength="120" autocomplete="name" required /></label>
          <label class="block"><span class="label">Telefon</span><input v-model="who.phone" type="tel" class="input" maxlength="40" autocomplete="tel" /></label>
          <label class="block"><span class="label">E-mail (jeśli wolisz zamiast telefonu)</span><input v-model="who.email" type="email" class="input" maxlength="200" autocomplete="email" /></label>
        </fieldset>
        <label class="block"><span class="label">Wiadomość (opcjonalnie)</span><input v-model="msg" class="input" maxlength="500" placeholder="np. od przyszłego tygodnia" /></label>
        <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="!ready || busy || !contactOk">
          {{ busy ? 'Zapisywanie…' : !ready ? 'Wybierz termin' : !contactOk ? 'Podaj imię i telefon' : o.is_new ? `Wysyłam: ${pref.length} najlepsze${backup.length ? ` + ${backup.length} rezerwowe` : ''}` : `Wybieram: ${slotLabel(o.slots[sel!])}` }}
        </button>
        <p class="text-xs text-muted">Każdy termin powtarza się co tydzień. Zmiana zacznie obowiązywać po potwierdzeniu przez trenerkę.</p>
      </form>
    </template>
  </main>
</template>
