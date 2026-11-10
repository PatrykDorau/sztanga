<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useExercisesStore } from '@/stores/exercises'
import { useProgramsStore } from '@/stores/programs'
import { useClientsStore } from '@/stores/clients'
import { useScheduleStore } from '@/stores/schedule'
import { addDays, dayLabel, hm } from '@/lib/dates'
import Icon from '@/components/Icon.vue'
import ProgressRing from '@/components/ProgressRing.vue'
import SessionCard from '@/components/SessionCard.vue'
import SessionSheet from '@/components/SessionSheet.vue'

const auth = useAuthStore()
const ex = useExercisesStore()
const programs = useProgramsStore()
const clients = useClientsStore()
const schedule = useScheduleStore()
const openId = ref<string | null>(null)
const startOfToday = new Date(new Date().setHours(0, 0, 0, 0))
onMounted(() =>
  Promise.all([
    ex.load(),
    programs.loadList(),
    auth.isTrainer ? clients.load() : null,
    // Trenerka: dziś; klient: najbliższe 60 dni (RLS zwraca tylko jego sesje).
    schedule.loadRange(startOfToday, addDays(startOfToday, auth.isTrainer ? 1 : 60)).catch(() => null),
  ]),
)

const todaySessions = computed(() =>
  schedule.sessions.filter((s) => s.starts_at >= startOfToday.toISOString() && s.starts_at < addDays(startOfToday, 1).toISOString()),
)
const nextSession = computed(() =>
  schedule.sessions.find((s) => s.ends_at >= new Date().toISOString() && ['pending', 'confirmed'].includes(s.status)),
)

// Dla klienta RLS zwraca tylko jego plany, które nie są szkicem.
const myPlans = computed(() => (auth.isTrainer ? [] : programs.list.filter((p) => !p.is_template && p.status !== 'draft')))

const own = computed(() => ex.all.filter((e) => e.source === 'own'))
const withVideo = computed(() => own.value.filter((e) => e.video_path).length)
const firstName = computed(() => (auth.profile?.full_name ?? '').split(/[\s@]/)[0])
const initials = computed(() => (auth.profile?.full_name ?? '?').split(/[\s@]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase())
const today = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })

const activeClients = computed(() => clients.all.filter((c) => !c.archived))
const withoutPlan = computed(
  () => activeClients.value.filter((c) => !programs.list.some((p) => p.client_id === c.id && p.status === 'active')).length,
)
const templates = computed(() => programs.list.filter((p) => p.is_template).length)
const GOAL = 30
</script>

<template>
  <main class="space-y-5 px-4 pb-6" style="padding-top: max(1.5rem, env(safe-area-inset-top))">
    <header class="flex items-start justify-between gap-3">
      <div>
        <p class="text-sm text-muted first-letter:uppercase">{{ today }}</p>
        <h1 class="page-title">Cześć{{ firstName ? `, ${firstName}` : '' }}</h1>
      </div>
      <RouterLink
        to="/profil"
        class="pressable flex size-11 items-center justify-center rounded-full bg-primary-soft font-display text-lg font-bold text-primary-fg"
        aria-label="Profil i ustawienia"
      >
        {{ initials }}
      </RouterLink>
    </header>

    <template v-if="auth.isTrainer">
      <section>
        <div class="mb-2 flex items-baseline justify-between">
          <h2 class="text-xl font-bold">Dziś</h2>
          <RouterLink to="/grafik" class="text-sm font-semibold text-primary-fg">Cały grafik</RouterLink>
        </div>
        <p v-if="!todaySessions.length" class="card p-4 text-sm text-muted">Dziś bez sesji.</p>
        <ul v-else class="space-y-2">
          <li v-for="s in todaySessions" :key="s.id">
            <SessionCard :session="s" :title="clients.byId(s.client_id)?.full_name ?? 'Klient'" @open="openId = s.id" />
          </li>
        </ul>
      </section>

      <section class="card flex items-center gap-4 p-4">
        <ProgressRing :value="own.length" :max="GOAL" :label="`${own.length} z ${GOAL} ćwiczeń w bazie`" />
        <div class="min-w-0 flex-1">
          <h2 class="text-xl font-bold">Baza ćwiczeń</h2>
          <p class="text-sm text-muted">{{ withVideo }} z filmikiem · cel {{ GOAL }}–50</p>
          <RouterLink to="/cwiczenia/nowe" class="btn-primary mt-3 w-full"><Icon name="plus" class="size-5" />Dodaj ćwiczenie</RouterLink>
        </div>
      </section>

      <section class="grid grid-cols-2 gap-3">
        <RouterLink to="/klienci" class="card pressable p-4 hover:bg-surface-2">
          <Icon name="users" class="mb-3 size-6 text-primary-fg" />
          <p class="font-display text-3xl leading-none font-bold tabular-nums">{{ activeClients.length }}</p>
          <p class="mt-1 text-sm font-semibold">Klienci</p>
          <p class="text-xs" :class="withoutPlan ? 'text-warn-fg' : 'text-muted'">
            {{ withoutPlan ? `${withoutPlan} bez aktywnego planu` : 'wszyscy mają plan' }}
          </p>
        </RouterLink>
        <RouterLink to="/plany" class="card pressable p-4 hover:bg-surface-2">
          <Icon name="clipboard" class="mb-3 size-6 text-primary-fg" />
          <p class="font-display text-3xl leading-none font-bold tabular-nums">{{ templates }}</p>
          <p class="mt-1 text-sm font-semibold">Szablony</p>
          <p class="text-xs text-muted">gotowe programy</p>
        </RouterLink>
      </section>
    </template>

    <RouterLink v-if="!auth.isTrainer && auth.profile" to="/terminy" class="card pressable flex items-center gap-4 p-4 hover:bg-surface-2">
      <div class="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary"><Icon name="calendar" class="size-7" /></div>
      <div class="min-w-0 flex-1">
        <p class="eyebrow">Najbliższa sesja</p>
        <template v-if="nextSession">
          <p class="font-display text-2xl leading-tight font-bold first-letter:uppercase">{{ dayLabel(new Date(nextSession.starts_at)) }}</p>
          <p class="text-muted">godz. {{ hm(nextSession.starts_at) }}{{ nextSession.status === 'pending' ? ' · czeka na potwierdzenie' : '' }}</p>
        </template>
        <p v-else class="font-semibold">Brak – zarezerwuj termin</p>
      </div>
      <Icon name="chevron" class="size-5 text-subtle" />
    </RouterLink>

    <section v-if="!auth.isTrainer && myPlans.length" class="space-y-2">
      <h2 class="text-xl font-bold">Twój plan</h2>
      <RouterLink v-for="p in myPlans" :key="p.id" :to="`/plany/${p.id}/druk`" class="card pressable flex items-center justify-between gap-3 p-4 hover:bg-surface-2">
        <div class="min-w-0">
          <p class="truncate font-semibold">{{ p.name }}</p>
          <p class="text-sm text-muted">
            {{ p.status === 'active' ? 'aktywny' : 'zakończony' }}<template v-if="p.start_date"> · od {{ new Date(p.start_date).toLocaleDateString('pl-PL') }}</template>
          </p>
        </div>
        <span class="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary-fg">Zobacz<Icon name="chevron" class="size-4" /></span>
      </RouterLink>
    </section>

    <section v-else-if="!auth.isTrainer && auth.profile" class="card p-5">
      <h2 class="mb-1 text-xl font-bold">Twój plan pojawi się tutaj</h2>
      <p class="text-sm text-muted">Trenerka przygotowuje plany w aplikacji. Do tego czasu możesz przejrzeć bazę ćwiczeń.</p>
    </section>
    <SessionSheet v-if="openId" :id="openId" @close="openId = null" />
  </main>
</template>
