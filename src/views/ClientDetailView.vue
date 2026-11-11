<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ClientMovement from '@/components/ClientMovement.vue'
import ClientSport from '@/components/ClientSport.vue'
import ClientKid from '@/components/ClientKid.vue'
import RescheduleSheet from '@/components/RescheduleSheet.vue'
import ClientAttendance from '@/components/ClientAttendance.vue'
import ClientViewSettings from '@/components/ClientViewSettings.vue'
import ClientStudies from '@/components/ClientStudies.vue'
import { offers as rescheduleOffers } from '@/lib/reschedule'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { CONTRAINDICATIONS, EQUIPMENT, GROUPS, STATUSES, label } from '@/lib/vocab'
import AssignProgramDialog from '@/components/AssignProgramDialog.vue'
import Icon from '@/components/Icon.vue'
import NewSessionSheet from '@/components/NewSessionSheet.vue'
import SessionCard from '@/components/SessionCard.vue'
import SessionSheet from '@/components/SessionSheet.vue'
import { useScheduleStore } from '@/stores/schedule'
import { addDays, shortDay, ymd } from '@/lib/dates'
import ClientProgress from '@/components/ClientProgress.vue'
import ClientHistory from '@/components/ClientHistory.vue'
import { useProgressStore } from '@/stores/progress'
import { useExercisesStore } from '@/stores/exercises'
import { useLiveStore } from '@/stores/live'

const props = defineProps<{ id: string }>()
const clients = useClientsStore()
const programs = useProgramsStore()
const router = useRouter()
const assigning = ref(false)
const schedule = useScheduleStore()
const booking = ref(false)
const openSession = ref<string | null>(null)
const rescheduling = ref(false)
const pendingChange = ref(0) // klient wybrał nowy termin – czeka na zatwierdzenie
async function loadChanges() {
  pendingChange.value = (await rescheduleOffers(props.id).catch(() => [])).filter((o) => o.status === 'chosen').length
}
loadChanges()
const progress = useProgressStore()
const live = useLiveStore()
type Tab = 'overview' | 'progress' | 'history' | 'ruch' | 'sport' | 'kid'
const route = useRoute()
const tab = ref<Tab>((['progress', 'history', 'ruch', 'sport', 'kid'] as string[]).includes(String(route.query.tab)) ? (route.query.tab as Tab) : 'overview')
// Sportowcy: gotowość i obciążenie; dzieci: testy, odznaki, zgody i raport dla rodzica.
const TABS = computed<[Tab, string][]>(() => [
  ['overview', 'Przegląd'],
  ...(c.value?.client_group === 'athlete' ? [['sport', 'Sport'] as [Tab, string]] : c.value?.client_group === 'child' ? [['kid', 'Rozwój'] as [Tab, string]] : []),
  ['progress', 'Postępy'],
  ['history', 'Historia'],
  ['ruch', 'Ruch'],
])

/** Sesja bez terminu w grafiku (np. dodatkowy trening) – zaczyna się pusta. */
function startLive() {
  router.push(`/sesja/${live.start({ client_id: props.id })}`)
}

onMounted(() =>
  Promise.all([
    clients.load(),
    programs.loadList(),
    useExercisesStore().load(),
    schedule.loadRange(addDays(new Date(), -1), addDays(new Date(), 60)),
    progress.loadClient(props.id).catch(() => null),
  ]),
)
const upcoming = computed(() =>
  // Tylko to, co jeszcze się odbędzie (bez odwołanych, odbytych i nieobecności).
  schedule.sessions.filter((s) => s.client_id === props.id && s.ends_at >= new Date().toISOString() && ['pending', 'confirmed'].includes(s.status)).slice(0, 5),
)
const c = computed(() => clients.byId(props.id))
const plans = computed(() => programs.list.filter((p) => p.client_id === props.id))
const age = computed(() => {
  if (!c.value?.birth_date) return null
  const b = new Date(c.value.birth_date)
  const n = new Date()
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0)
})

async function newPlan() {
  const p = await programs.create({ name: `Plan – ${c.value!.full_name}`, client_id: props.id, start_date: null }, 1)
  router.push(`/plany/${p.id}`)
}
</script>

<template>
  <main v-if="c" class="pb-6">
    <header class="page-header space-y-2 px-2 pb-2">
      <div class="flex items-center gap-1">
        <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
        <h1 class="min-w-0 flex-1 truncate font-display text-2xl font-bold">{{ c.full_name }}</h1>
        <RouterLink :to="`/klienci/${c.id}/edycja`" class="icon-btn" aria-label="Edytuj klienta"><Icon name="edit" class="size-6" /></RouterLink>
      </div>
      <div class="mx-2 grid rounded-xl bg-surface-2 p-1" :style="{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }" role="tablist">
        <button
          v-for="[k, l] in TABS"
          :key="k"
          role="tab"
          :aria-selected="tab === k"
          class="min-h-10 rounded-lg text-sm font-semibold"
          :class="tab === k ? 'bg-surface shadow' : 'text-muted'"
          @click="tab = k"
        >
          {{ l }}
        </button>
      </div>
    </header>

    <div class="space-y-4 px-4 pt-2">
      <ClientProgress v-if="tab === 'progress'" :client-id="c.id" />
      <template v-else-if="tab === 'history'">
        <ClientAttendance :client-id="c.id" />
        <ClientHistory :client-id="c.id" />
      </template>
      <ClientMovement v-else-if="tab === 'ruch'" :client-id="c.id" />
      <ClientSport v-else-if="tab === 'sport'" :client-id="c.id" :first-name="c.full_name.split(' ')[0]" />
      <ClientKid v-else-if="tab === 'kid'" :client-id="c.id" :first-name="c.full_name.split(' ')[0]" />

      <template v-else>
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="tag">{{ label(GROUPS, c.client_group) }}</span>
        <span v-if="age !== null" class="tag">{{ age }} lat</span>
        <span v-if="c.archived" class="tag">Archiwum</span>
        <a v-if="c.phone" :href="`tel:${c.phone.replace(/s+/g, '')}`" class="tag !bg-surface-2 underline-offset-2 hover:underline">{{ c.phone }}</a>
        <a v-if="c.email" :href="`mailto:${c.email}`" class="tag max-w-full truncate !bg-surface-2 underline-offset-2 hover:underline">{{ c.email }}</a>
      </div>
      <!-- Szybkie akcje: rzadziej używane niż informacje o kliencie, więc nie dominują ekranu -->
      <div class="grid grid-cols-2 gap-2">
        <button class="btn-ghost border border-line-strong text-sm" @click="startLive"><Icon name="dumbbell" class="size-4" />Sesja teraz</button>
        <RouterLink :to="{ path: '/asystent', query: { client: c.id } }" class="btn-ghost border border-line-strong text-sm"><Icon name="star" class="size-4" />Zapytaj asystenta</RouterLink>
      </div>

      <section class="card space-y-3 p-4 text-sm">
        <div v-if="c.goals">
          <p class="text-xs font-medium tracking-wide text-muted uppercase">Cele</p>
          <p class="whitespace-pre-line">{{ c.goals }}</p>
        </div>
        <div v-if="c.limitations.length" class="flex gap-2 warn-box">
          <Icon name="alert" class="size-5 shrink-0" />
          <p><strong>Ograniczenia:</strong> {{ c.limitations.map((x) => label(CONTRAINDICATIONS, x)).join(', ') }}</p>
        </div>
        <div v-if="c.equipment.length">
          <p class="text-xs font-medium tracking-wide text-muted uppercase">Sprzęt</p>
          <p>{{ c.equipment.map((x) => label(EQUIPMENT, x)).join(', ') }}</p>
        </div>
        <div v-if="c.notes">
          <p class="text-xs font-medium tracking-wide text-muted uppercase">Notatki</p>
          <p class="whitespace-pre-line">{{ c.notes }}</p>
        </div>
        <p v-if="!c.goals && !c.limitations.length && !c.notes" class="text-muted">
          Uzupełnij cele i ograniczenia – kreator planu z nich korzysta.
        </p>
      </section>

      <section>
        <div class="mb-2 flex items-center justify-between gap-2">
          <h2 class="text-xl font-bold whitespace-nowrap">Najbliższe sesje</h2>
          <button class="btn-ghost !min-h-10 shrink-0 text-sm" @click="booking = true"><Icon name="plus" class="size-4" />Umów</button>
        </div>
        <button class="mb-2 flex w-full items-center gap-2 rounded-xl px-1 py-1 text-left text-sm" :class="pendingChange ? 'font-semibold text-primary-fg' : 'text-muted'" @click="rescheduling = true">
          <Icon name="swap" class="size-4 shrink-0" />{{ pendingChange ? 'Klient wybrał nowy stały termin – sprawdź' : 'Zaproponuj zmianę stałego terminu' }}
        </button>
        <p v-if="!upcoming.length" class="text-sm text-muted">Brak zaplanowanych sesji.</p>
        <ul class="space-y-2">
          <li v-for="s in upcoming" :key="s.id">
            <SessionCard :session="s" :title="shortDay(new Date(s.starts_at))" @open="openSession = s.id" />
          </li>
        </ul>
      </section>

      <ClientAttendance :key="openSession ?? 'att'" :client-id="c.id" />
      <ClientStudies :client-id="c.id" />

      <section>
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-xl font-bold">Plany</h2>
        </div>
        <ul v-if="plans.length" class="mb-3 space-y-2">
          <li v-for="p in plans" :key="p.id">
            <RouterLink :to="`/plany/${p.id}`" class="card flex items-center justify-between gap-3 p-3">
              <div class="min-w-0">
                <p class="truncate font-medium">{{ p.name }}</p>
                <p class="text-xs text-muted">{{ p.start_date ? `od ${new Date(p.start_date).toLocaleDateString('pl-PL')}` : 'bez daty startu' }}</p>
              </div>
              <span class="tag" :class="p.status === 'active' ? '!bg-success-soft !text-success' : ''">{{ label(STATUSES, p.status) }}</span>
            </RouterLink>
          </li>
        </ul>
        <div class="grid grid-cols-2 gap-2">
          <button class="btn-primary" @click="assigning = true">Z szablonu</button>
          <button class="btn-ghost" @click="newPlan"><Icon name="plus" class="size-4" />Od zera</button>
        </div>
      </section>

      <ClientViewSettings :client-id="c.id" />
      </template>
    </div>

    <NewSessionSheet v-if="booking" :day="ymd(new Date())" :client-id="c.id" @close="booking = false" @done="booking = false" />
    <RescheduleSheet
      v-if="rescheduling"
      :client-id="c.id"
      :client-name="c.full_name"
      @close="((rescheduling = false), loadChanges())"
      @changed="schedule.loadRange(addDays(new Date(), -1), addDays(new Date(), 60))"
    />
    <SessionSheet v-if="openSession" :id="openSession" @close="openSession = null" />
    <AssignProgramDialog v-if="assigning" :client-id="c.id" @close="assigning = false" @done="(id) => router.push(`/plany/${id}`)" />
  </main>
  <main v-else class="px-4 pt-10 text-center text-muted">{{ clients.loaded ? 'Nie znaleziono klienta.' : 'Ładowanie…' }}</main>
</template>
