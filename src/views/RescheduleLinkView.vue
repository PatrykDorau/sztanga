<script setup lang="ts">
// Link dla klienta (bez konta): wybór nowego stałego terminu spośród zaproponowanych przez trenerkę.
import { computed, onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { slotKey, slotLabel, WEEKDAY_PL, type WeeklySlot } from '@/lib/reschedule'
import Icon from '@/components/Icon.vue'

interface Offer {
  first_name: string
  current: { weekday: number; start_time: string; duration_minutes: number } | null
  slots: WeeklySlot[]
  note: string | null
  status: 'open' | 'chosen' | 'applied'
  chosen: WeeklySlot | null
  gyms: Record<string, string>
}
const props = defineProps<{ token: string }>()
const o = ref<Offer | null>(null)
const state = ref<'loading' | 'ok' | 'missing'>('loading')
const sel = ref<number | null>(null)
const msg = ref('')
const busy = ref(false)
const error = ref('')
const editing = ref(false)

async function load() {
  const { data, error: e } = await supabase.rpc('reschedule_offer', { link_token: props.token })
  if (e || !data) {
    state.value = 'missing'
    return
  }
  o.value = data as Offer
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
  if (sel.value == null) return
  busy.value = true
  error.value = ''
  const { data, error: e } = await supabase.rpc('choose_reschedule', { link_token: props.token, slot_index: sel.value, p_note: msg.value.trim() || null })
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
        <h1 class="font-display text-3xl font-bold">Cześć {{ o.first_name }}! Wybierz nowy stały termin</h1>
        <p v-if="o.current" class="mt-1 text-sm text-muted">Obecnie: {{ WEEKDAY_PL[o.current.weekday] }} {{ o.current.start_time }} ({{ o.current.duration_minutes }} min)</p>
        <p v-if="o.note" class="mt-3 rounded-xl bg-surface-2 p-3 text-sm">„{{ o.note }}”</p>
      </header>

      <div v-if="o.status === 'applied'" class="card space-y-2 p-5 text-center">
        <Icon name="check" class="mx-auto size-10 text-success" />
        <p class="text-lg font-semibold">Gotowe – nowy termin: {{ o.chosen ? slotLabel(o.chosen) : '' }}</p>
        <p class="text-sm text-muted">Trenerka zatwierdziła zmianę. Kolejne treningi są już w grafiku.</p>
      </div>
      <div v-else-if="o.status === 'chosen' && o.chosen && !editing" class="card space-y-3 p-5 text-center">
        <Icon name="clock" class="mx-auto size-10 text-primary-fg" />
        <p class="text-lg font-semibold">Wybrano: {{ slotLabel(o.chosen) }}</p>
        <p class="text-sm text-muted">Trenerka potwierdzi zmianę – do tego czasu obowiązuje stary termin.</p>
        <button class="btn-ghost w-full border border-line-strong" @click="editing = true">Zmień wybór</button>
      </div>
      <form v-else class="space-y-4" @submit.prevent="choose">
        <fieldset v-for="d in byDay" :key="d.wd">
          <legend class="mb-1.5 font-semibold">{{ WEEKDAY_PL[d.wd] }}</legend>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="x in d.slots"
              :key="slotKey(x.s)"
              type="button"
              class="min-h-12 rounded-xl border text-base font-semibold tabular-nums"
              :class="sel === x.i ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface'"
              :aria-pressed="sel === x.i"
              @click="sel = x.i"
            >
              {{ x.s.start_time }}<span v-if="multiGym && x.s.gym_id" class="block text-[11px] font-normal opacity-80">{{ o.gyms[x.s.gym_id] }}</span>
            </button>
          </div>
        </fieldset>
        <label class="block"><span class="label">Wiadomość (opcjonalnie)</span><input v-model="msg" class="input" maxlength="500" placeholder="np. od przyszłego tygodnia" /></label>
        <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="sel == null || busy">{{ busy ? 'Zapisywanie…' : sel == null ? 'Wybierz termin' : `Wybieram: ${slotLabel(o.slots[sel])}` }}</button>
        <p class="text-xs text-muted">Każdy termin powtarza się co tydzień. Zmiana zacznie obowiązywać po potwierdzeniu przez trenerkę.</p>
      </form>
    </template>
  </main>
</template>
