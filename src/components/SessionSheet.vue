<script setup lang="ts">
// Szczegóły sesji dla trenerki: zmiana statusu, odwołanie (też całej serii), przypisany trening, notatka.
import { computed, onMounted, ref } from 'vue'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { useScheduleStore } from '@/stores/schedule'
import { dayLabel, hm } from '@/lib/dates'
import { SESSION_STATUSES, label } from '@/lib/vocab'
import type { ProgramTree, SessionStatus } from '@/types'
import Icon from './Icon.vue'
import { useRouter } from 'vue-router'
import { useLiveStore } from '@/stores/live'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ close: [] }>()
const schedule = useScheduleStore()
const clients = useClientsStore()
const programs = useProgramsStore()

const s = computed(() => schedule.sessions.find((x) => x.id === props.id))
const client = computed(() => clients.byId(s.value?.client_id))
const plan = ref<ProgramTree | null>(null)
const notes = ref(s.value?.notes ?? '')
const busy = ref(false)
const error = ref('')
const confirmCancel = ref(false)
const reason = ref('')

// Pojedyncze treningi: klienta i gotowce (bez klienta) – do przypisania jednej sesji.
const singles = ref<ProgramTree[]>([])
onMounted(async () => {
  if (!programs.listLoaded) await programs.loadList().catch(() => null)
  const p = programs.list.find((x) => x.client_id === s.value?.client_id && x.status === 'active' && x.kind !== 'single')
  if (p) plan.value = JSON.parse(JSON.stringify(await programs.open(p.id)))
  const ids = programs.list.filter((x) => x.kind === 'single' && (x.client_id === s.value?.client_id || x.is_template)).map((x) => x.id)
  for (const id of ids) singles.value.push(JSON.parse(JSON.stringify(await programs.open(id))) as ProgramTree)
})
const singleWorkouts = computed(() => singles.value.flatMap((pr) => pr.program_weeks.flatMap((w) => w.workouts.map((wo) => ({ wo, owner: pr })))))

const workoutName = computed(() => {
  for (const [i, w] of (plan.value?.program_weeks ?? []).entries()) {
    const wo = w.workouts.find((x) => x.id === s.value?.workout_id)
    if (wo) return `Tydzień ${i + 1} · ${wo.name}`
  }
  const single = singleWorkouts.value.find((x) => x.wo.id === s.value?.workout_id)
  return single ? `Pojedynczy trening · ${single.wo.name}` : null
})
// Start sesji na żywo – z przypisanym treningiem z planu (dawki z planu) albo pusta.
const live = useLiveStore()
const router = useRouter()
function startLive() {
  const workout =
    plan.value?.program_weeks.flatMap((w) => w.workouts).find((w) => w.id === s.value!.workout_id) ??
    singleWorkouts.value.find((x) => x.wo.id === s.value!.workout_id)?.wo ??
    null
  const id = live.start({ client_id: s.value!.client_id, session_id: s.value!.id, workout })
  router.push(`/sesja/${id}`)
}
const hasDraft = computed(() => live.active.some((d) => d.session_id === props.id))

// Sesja-prośba o przełożenie: skąd (stara sesja zostaje do akceptacji).
const movedFrom = computed(() => (s.value?.moved_from ? schedule.sessions.find((x) => x.id === s.value!.moved_from) : null))
const isOpen = computed(() => s.value && ['pending', 'confirmed'].includes(s.value.status))
const isPast = computed(() => s.value && new Date(s.value.starts_at) < new Date())

async function run(fn: () => Promise<unknown>, close = false) {
  busy.value = true
  error.value = ''
  try {
    await fn()
    if (close) emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

const setStatus = (st: SessionStatus) =>
  run(async () => {
    const old = movedFrom.value
    await schedule.setStatus(props.id, st, st === 'cancelled' ? reason.value || undefined : undefined)
    // Akceptacja przełożenia: baza odwołuje stary termin (wyzwalacz) – odświeżamy go lokalnie.
    if (st === 'confirmed' && old && ['pending', 'confirmed'].includes(old.status)) old.status = 'cancelled'
  })
const setWorkout = (id: string) => run(() => schedule.updateSession(props.id, { workout_id: id || null }))
const saveNotes = () => run(() => schedule.updateSession(props.id, { notes: notes.value.trim() || null }))
const cancelSeries = () => run(() => schedule.cancelSeriesFrom(s.value!.series_id!, s.value!.starts_at), true)
// Usuwanie (np. sesja dodana pomyłkowo) wymaga drugiego dotknięcia – bez systemowego okna confirm.
const armedDelete = ref(false)
const remove = () => (armedDelete.value ? run(() => schedule.removeSession(props.id), true) : (armedDelete.value = true))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Sesja" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div v-if="s" class="sheet space-y-4">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <RouterLink v-if="client" :to="`/klienci/${client.id}`" class="font-display text-2xl leading-tight font-bold underline-offset-4 hover:underline">{{ client.full_name }}</RouterLink>
          <p class="text-muted first-letter:uppercase">{{ dayLabel(new Date(s.starts_at)) }} · {{ hm(s.starts_at) }}–{{ hm(s.ends_at) }}</p>
        </div>
        <button type="button" class="icon-btn -m-2" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <span class="tag">{{ label(SESSION_STATUSES, s.status) }}</span>
        <span v-if="s.series_id" class="tag">sesja cykliczna</span>
        <span v-if="s.booked_by_client" class="tag">prośba klienta</span>
      </div>
      <p v-if="s.weekly_request && s.status === 'pending'" class="rounded-lg bg-warn-soft p-2 text-sm text-warn-fg">
        Prośba o stały termin co tydzień. Akceptacja doda serię w tym dniu i o tej godzinie (od tej sesji).
      </p>
      <p v-if="movedFrom" class="rounded-lg bg-warn-soft p-2 text-sm text-warn-fg">
        Przełożenie z {{ new Date(movedFrom.starts_at).toLocaleString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}.
        {{ s.status === 'pending' ? 'Akceptacja odwoła tamten termin; odrzucenie go zostawi.' : '' }}
      </p>
      <p v-if="s.cancel_reason" class="text-sm text-muted">Powód odwołania: {{ s.cancel_reason }}</p>

      <button v-if="s.status === 'confirmed'" class="btn-primary w-full !min-h-12 text-base" @click="startLive">
        <Icon name="dumbbell" class="size-5" />{{ hasDraft ? 'Wróć do sesji na żywo' : 'Rozpocznij sesję' }}
      </button>

      <div v-if="s.status === 'pending'" class="grid grid-cols-2 gap-2">
        <button class="btn-primary" :disabled="busy" @click="setStatus('confirmed')"><Icon name="check" class="size-5" />Akceptuj</button>
        <button class="btn-danger" :disabled="busy" @click="confirmCancel = true">Odrzuć</button>
      </div>

      <div v-if="s.status === 'confirmed' && isPast" class="grid grid-cols-2 gap-2">
        <button class="btn-primary" :disabled="busy" @click="setStatus('completed')"><Icon name="check" class="size-5" />Odbyta</button>
        <button class="btn-ghost" :disabled="busy" @click="setStatus('no_show')">Nieobecność</button>
      </div>
      <button v-if="!isOpen && s.status !== 'pending'" class="btn-ghost w-full" :disabled="busy" @click="setStatus('confirmed')">Przywróć jako potwierdzoną</button>

      <div v-if="plan || singleWorkouts.length">
        <label class="label" for="ss-w">Trening</label>
        <select id="ss-w" class="input" :value="s.workout_id ?? ''" :disabled="busy" @change="setWorkout(($event.target as HTMLSelectElement).value)">
          <option value="">Bez przypisanego treningu</option>
          <template v-if="plan">
            <optgroup v-for="(w, i) in plan.program_weeks" :key="w.id" :label="`Plan – tydzień ${i + 1}`">
              <option v-for="wo in w.workouts" :key="wo.id" :value="wo.id">{{ wo.name }}</option>
            </optgroup>
          </template>
          <optgroup v-if="singleWorkouts.length" label="Pojedyncze treningi">
            <option v-for="x in singleWorkouts" :key="x.wo.id" :value="x.wo.id">{{ x.wo.name }}{{ x.owner.client_id ? '' : ' (gotowiec)' }}</option>
          </optgroup>
        </select>
        <p v-if="workoutName" class="mt-1 text-xs text-muted">{{ workoutName }}</p>
      </div>
      <p v-else class="text-sm text-muted">Klient nie ma aktywnego planu ani pojedynczego treningu – utworzysz go w Plany → Pojedyncze treningi.</p>

      <div>
        <label class="label" for="ss-n">Notatka</label>
        <textarea id="ss-n" v-model="notes" rows="2" class="input py-2" @blur="saveNotes" />
      </div>

      <div v-if="confirmCancel" class="space-y-2 rounded-xl border border-danger/40 p-3">
        <label class="label" for="ss-r">Powód (opcjonalnie)</label>
        <input id="ss-r" v-model="reason" class="input" placeholder="np. choroba" />
        <div class="grid grid-cols-2 gap-2">
          <button class="btn-ghost" @click="confirmCancel = false">Wróć</button>
          <button class="btn-danger" :disabled="busy" @click="setStatus('cancelled').then(() => (confirmCancel = false))">Odwołaj sesję</button>
        </div>
        <button v-if="s.series_id" class="btn-danger w-full" :disabled="busy" @click="cancelSeries">Odwołaj tę i wszystkie kolejne w serii</button>
      </div>
      <div v-else-if="isOpen" class="grid grid-cols-2 gap-2">
        <button class="btn-danger" :disabled="busy" @click="confirmCancel = true">Odwołaj</button>
        <button :class="armedDelete ? 'btn-danger' : 'btn-ghost'" :disabled="busy" @click="remove">
          <Icon name="trash" class="size-4" />{{ armedDelete ? 'Na pewno usunąć?' : 'Usuń' }}
        </button>
      </div>

      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    </div>
  </div>
</template>
