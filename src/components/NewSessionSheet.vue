<script setup lang="ts">
// Nowa sesja (trenerka): pojedyncza albo cykliczna co tydzień, z opcjonalnym treningiem z aktywnego planu klienta.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { useScheduleStore } from '@/stores/schedule'
import { hm, isoWeekday, localIso } from '@/lib/dates'
import { WEEKDAYS } from '@/lib/vocab'
import type { ProgramTree } from '@/types'
import Icon from './Icon.vue'
import { useCalendarStore } from '@/stores/calendar'
import { GCAL_COLORS } from '@/lib/vocab'

const props = defineProps<{ day: string; clientId?: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const clients = useClientsStore()
const programs = useProgramsStore()
const schedule = useScheduleStore()
const cal = useCalendarStore()

const f = reactive({
  client_id: props.clientId ?? '',
  day: props.day,
  time: '18:00',
  duration: 60,
  repeat: false,
  until: '',
  workout_id: '',
  notes: '',
  gym_id: '',
})
const plan = ref<ProgramTree | null>(null)
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  await Promise.all([clients.load(), programs.loadList(), schedule.settings ? null : schedule.loadSettings(), cal.gyms.length ? null : cal.loadGyms()])
  f.duration = schedule.settings?.session_minutes ?? 60
  f.gym_id = cal.defaultGym?.id ?? ''
})

const activeClients = computed(() => clients.all.filter((c) => !c.archived))
const weekday = computed(() => WEEKDAYS[isoWeekday(new Date(f.day + 'T12:00')) - 1].toLowerCase())

// Treningi z aktywnego planu klienta do przypisania (bez kopiowania – sesja wskazuje trening z planu).
watch(
  () => f.client_id,
  async (cid) => {
    plan.value = null
    f.workout_id = ''
    const p = programs.list.find((x) => x.client_id === cid && x.status === 'active' && x.kind !== 'single')
    if (p) plan.value = JSON.parse(JSON.stringify(await programs.open(p.id)))
  },
)

const conflicts = computed(() => {
  if (!f.day || !f.time) return []
  const start = new Date(localIso(f.day, f.time)).getTime()
  const end = start + f.duration * 60000
  return schedule.sessions.filter(
    (s) => ['pending', 'confirmed'].includes(s.status) && new Date(s.starts_at).getTime() < end && new Date(s.ends_at).getTime() > start,
  )
})

async function submit() {
  if (!f.client_id) return
  busy.value = true
  error.value = ''
  try {
    if (f.repeat) {
      await schedule.createSeries({
        client_id: f.client_id,
        weekday: isoWeekday(new Date(f.day + 'T12:00')),
        start_time: f.time,
        duration_minutes: f.duration,
        start_date: f.day,
        end_date: f.until || null,
        gym_id: f.gym_id || null,
      })
    } else {
      const starts = localIso(f.day, f.time)
      await schedule.createSession({
        client_id: f.client_id,
        starts_at: starts,
        ends_at: new Date(new Date(starts).getTime() + f.duration * 60000).toISOString(),
        workout_id: f.workout_id || null,
        notes: f.notes.trim() || null,
        gym_id: f.gym_id || null,
      })
    }
    emit('done')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Nowa sesja" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="sheet space-y-4" @submit.prevent="submit">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold">Nowa sesja</h2>
        <button type="button" class="icon-btn -m-2" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      </div>

      <div v-if="!clientId">
        <label class="label" for="ns-c">Klient</label>
        <select id="ns-c" v-model="f.client_id" class="input" required>
          <option value="" disabled>Wybierz…</option>
          <option v-for="c in activeClients" :key="c.id" :value="c.id">{{ c.full_name }}</option>
        </select>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label" for="ns-d">Dzień</label>
          <input id="ns-d" v-model="f.day" type="date" class="input" required />
        </div>
        <div>
          <label class="label" for="ns-t">Godzina</label>
          <input id="ns-t" v-model="f.time" type="time" step="900" class="input" required />
        </div>
      </div>

      <div v-if="cal.gyms.length > 1">
        <p class="label">Siłownia</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="g in cal.gyms" :key="g.id" type="button" :class="f.gym_id === g.id ? 'chip-on' : 'chip-off'" :aria-pressed="f.gym_id === g.id" @click="f.gym_id = g.id">
            <span class="mr-1.5 size-2.5 rounded-full" :style="{ background: GCAL_COLORS[g.color_id].hex }" aria-hidden="true" />{{ g.name }} ({{ g.code }})
          </button>
        </div>
      </div>

      <div>
        <p class="label">Czas trwania</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="m in [30, 45, 60, 90]" :key="m" type="button" :class="f.duration === m ? 'chip-on' : 'chip-off'" :aria-pressed="f.duration === m" @click="f.duration = m">{{ m }} min</button>
        </div>
      </div>

      <label class="flex min-h-11 items-center gap-3 rounded-xl bg-surface-2 px-3">
        <input v-model="f.repeat" type="checkbox" class="size-5 accent-primary" />
        <span class="text-[15px]">Powtarzaj co tydzień ({{ weekday }}, {{ f.time }})</span>
      </label>
      <div v-if="f.repeat">
        <label class="label" for="ns-u">Do kiedy (opcjonalnie)</label>
        <input id="ns-u" v-model="f.until" type="date" class="input" :min="f.day" />
        <p class="mt-1 text-xs text-muted">Bez daty: terminy tworzą się na 8 tygodni naprzód.</p>
      </div>

      <div v-if="!f.repeat && plan">
        <label class="label" for="ns-w">Trening z planu „{{ plan.name }}”</label>
        <select id="ns-w" v-model="f.workout_id" class="input">
          <option value="">Bez przypisanego treningu</option>
          <optgroup v-for="(w, i) in plan.program_weeks" :key="w.id" :label="`Tydzień ${i + 1}`">
            <option v-for="wo in w.workouts" :key="wo.id" :value="wo.id">{{ wo.name }}</option>
          </optgroup>
        </select>
      </div>

      <div v-if="conflicts.length" class="warn-box" role="alert">
        <Icon name="alert" class="size-5 shrink-0" />
        <p>Koliduje z sesją o {{ conflicts.map((c) => hm(c.starts_at)).join(', ') }}.</p>
      </div>

      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy || !f.client_id">{{ busy ? 'Zapisywanie…' : f.repeat ? 'Utwórz serię' : 'Dodaj sesję' }}</button>
    </form>
  </div>
</template>
