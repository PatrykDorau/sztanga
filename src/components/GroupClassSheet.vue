<script setup lang="ts">
// Zajęcia grupowe: dodanie (pojedyncze albo co tydzień) i edycja – rodzaj, siłownia, termin, liczba uczestników.
import { computed, onMounted, reactive, ref } from 'vue'
import { CLASS_KINDS, useGroupClassesStore, type GroupClass } from '@/stores/groupClasses'
import { useCalendarStore } from '@/stores/calendar'
import { addDays, isoWeekday, localIso, ymd } from '@/lib/dates'
import { GCAL_COLORS, WEEKDAYS } from '@/lib/vocab'
import Icon from './Icon.vue'
import ConflictWarning from './ConflictWarning.vue'

const props = defineProps<{ day?: string; item?: GroupClass | null }>()
const emit = defineEmits<{ close: []; done: [] }>()
const store = useGroupClassesStore()
const cal = useCalendarStore()

const it = props.item ?? null
const pad = (n: number) => String(n).padStart(2, '0')
const start = it ? new Date(it.starts_at) : null
const endOfMonth = (day: string) => {
  const d = new Date(day + 'T12:00')
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}
const f = reactive({
  kind: it?.kind ?? CLASS_KINDS[0],
  gym_id: it?.gym_id ?? '',
  day: start ? ymd(start) : (props.day ?? ymd(new Date())),
  time: start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '18:00',
  duration: it ? Math.round((new Date(it.ends_at).getTime() - new Date(it.starts_at).getTime()) / 60000) : 60,
  participants: it?.participants ?? ('' as number | ''),
  notes: it?.notes ?? '',
  repeat: false,
  until: '',
})
f.until = endOfMonth(f.day)
const custom = ref(!!it && !CLASS_KINDS.includes(it.kind))
const busy = ref(false)
const error = ref('')
onMounted(async () => {
  if (!cal.gyms.length) await cal.loadGyms()
  if (!it) f.gym_id = cal.defaultGym?.id ?? cal.gyms[0]?.id ?? ''
})

const weekday = computed(() => WEEKDAYS[isoWeekday(new Date(f.day + 'T12:00')) - 1].toLowerCase())
/** Terminy do utworzenia: jeden albo co tydzień do wybranego dnia (max 26). */
const times = computed(() => {
  const out: { starts_at: string; ends_at: string }[] = []
  const first = new Date(f.day + 'T12:00')
  const last = f.repeat && f.until ? new Date(f.until + 'T12:00') : first
  for (let i = 0; i < 26; i++) {
    const d = addDays(first, 7 * i)
    if (d > last) break
    const s = localIso(ymd(d), f.time)
    out.push({ starts_at: s, ends_at: new Date(new Date(s).getTime() + f.duration * 60000).toISOString() })
  }
  return out
})

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
    emit('done')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
function submit() {
  const kind = f.kind.trim()
  if (!kind) return void (error.value = 'Wpisz rodzaj zajęć.')
  const base = { kind, gym_id: f.gym_id || null, notes: f.notes.trim() || null }
  if (it)
    return run(() =>
      store.update(it.id, {
        ...base,
        ...times.value[0],
        participants: f.participants === '' ? null : Number(f.participants),
      }),
    )
  return run(() => store.create(base, times.value))
}
const setCancelled = (v: boolean) => it && run(() => store.update(it.id, { cancelled: v }))
const remove = (following: boolean) => it && confirm(following ? 'Usunąć te i kolejne zajęcia z tej serii?' : 'Usunąć te zajęcia?') && run(() => store.remove(it, following))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" :aria-label="it ? 'Zajęcia grupowe' : 'Nowe zajęcia grupowe'" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="sheet space-y-4" @submit.prevent="submit">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold">{{ it ? 'Zajęcia grupowe' : 'Nowe zajęcia grupowe' }}</h2>
        <button type="button" class="icon-btn -m-2" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      </div>

      <div>
        <p class="label">Rodzaj zajęć</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="k in CLASS_KINDS" :key="k" type="button" :class="!custom && f.kind === k ? 'chip-on' : 'chip-off'" :aria-pressed="!custom && f.kind === k" @click="(custom = false), (f.kind = k)">{{ k }}</button>
          <button type="button" :class="custom ? 'chip-on' : 'chip-off'" :aria-pressed="custom" @click="(custom = true), (f.kind = '')">Inne…</button>
        </div>
        <input v-if="custom" v-model="f.kind" class="input mt-2" placeholder="np. Zdrowy kręgosłup" aria-label="Nazwa zajęć" />
      </div>

      <div v-if="cal.gyms.length > 1">
        <p class="label">Siłownia</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="g in cal.gyms" :key="g.id" type="button" :class="f.gym_id === g.id ? 'chip-on' : 'chip-off'" :aria-pressed="f.gym_id === g.id" @click="f.gym_id = g.id">
            <span class="mr-1.5 size-2.5 rounded-full" :style="{ background: GCAL_COLORS[g.color_id].hex }" aria-hidden="true" />{{ g.name }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label><span class="label">Dzień</span><input v-model="f.day" type="date" class="input" required /></label>
        <label><span class="label">Godzina</span><input v-model="f.time" type="time" step="900" class="input" required /></label>
      </div>

      <div>
        <p class="label">Czas trwania</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="m in [45, 60, 75, 90]" :key="m" type="button" :class="f.duration === m ? 'chip-on' : 'chip-off'" :aria-pressed="f.duration === m" @click="f.duration = m">{{ m }} min</button>
        </div>
      </div>

      <template v-if="!it">
        <label class="flex min-h-11 items-center gap-3 rounded-xl bg-surface-2 px-3">
          <input v-model="f.repeat" type="checkbox" class="size-5 accent-primary" />
          <span class="text-[15px]">Powtarzaj co tydzień ({{ weekday }}, {{ f.time }})</span>
        </label>
        <label v-if="f.repeat" class="block">
          <span class="label">Do kiedy</span>
          <input v-model="f.until" type="date" class="input" :min="f.day" />
          <span class="mt-1 block text-xs text-muted">Utworzy się {{ times.length }} {{ times.length === 1 ? 'termin' : times.length < 5 ? 'terminy' : 'terminów' }}.</span>
        </label>
      </template>

      <label v-else class="block">
        <span class="label">Liczba uczestników</span>
        <input v-model.number="f.participants" type="number" min="0" inputmode="numeric" class="input" placeholder="wpisz po zajęciach" />
      </label>

      <label class="block"><span class="label">Notatka (opcjonalnie)</span><input v-model="f.notes" class="input" /></label>

      <ConflictWarning :windows="times" :ignore-id="it?.id" />
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy">{{ it ? 'Zapisz' : times.length > 1 ? `Dodaj ${times.length} ${times.length < 5 ? 'terminy' : 'terminów'}` : 'Dodaj zajęcia' }}</button>

      <div v-if="it" class="flex flex-wrap gap-2">
        <button type="button" class="btn-ghost border border-line-strong text-sm" :disabled="busy" @click="setCancelled(!it.cancelled)">{{ it.cancelled ? 'Przywróć (odbędą się)' : 'Odwołane' }}</button>
        <button type="button" class="btn-ghost text-sm text-danger" :disabled="busy" @click="remove(false)">Usuń</button>
        <button v-if="it.repeat_id" type="button" class="btn-ghost text-sm text-danger" :disabled="busy" @click="remove(true)">Usuń te i kolejne</button>
      </div>
    </form>
  </div>
</template>
