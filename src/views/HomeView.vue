<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useExercisesStore } from '@/stores/exercises'
import { useProgramsStore } from '@/stores/programs'
import { useClientsStore } from '@/stores/clients'
import { useScheduleStore } from '@/stores/schedule'
import { addDays, dayLabel, hm, startOfWeek, ymd } from '@/lib/dates'
import { useLiveStore } from '@/stores/live'
import { useProgressStore } from '@/stores/progress'
import { clientStatus } from '@/lib/analytics'
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

// ===== Sesje na żywo: niedokończone i niewysłane (offline) =====
const live = useLiveStore()
onMounted(() => live.flush())

// ===== Raport tygodnia (liczony w aplikacji; wysyłka e-mail/push dojdzie z serwerem powiadomień) =====
const report = ref<{ stalled: string[]; absent: string[]; nextWeek: number; freeSlots: number } | null>(null)
onMounted(async () => {
  if (!auth.isTrainer) return
  try {
    const progress = useProgressStore()
    const [logs] = await Promise.all([progress.loadAllRecent(60), clients.load()])
    const mon = startOfWeek(addDays(new Date(), 7))
    const [next, slots] = await Promise.all([
      schedule.loadRange(mon, addDays(mon, 7)),
      schedule.freeSlots(ymd(mon), ymd(addDays(mon, 6))).catch(() => []),
    ])
    const act = clients.all.filter((c) => !c.archived)
    const st = act.map((c) => ({ c, s: clientStatus(logs.filter((l) => l.client_id === c.id)) }))
    report.value = {
      stalled: st.filter((x) => x.s.trend === 'flat' || x.s.trend === 'down').map((x) => x.c.full_name),
      absent: st.filter((x) => x.s.daysSince === null || x.s.daysSince >= 14).map((x) => x.c.full_name),
      nextWeek: next.filter((s) => ['pending', 'confirmed'].includes(s.status)).length,
      freeSlots: slots.length,
    }
  } catch {
    report.value = null
  }
})
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
      <RouterLink v-for="d in live.active" :key="d.client_uuid" :to="`/sesja/${d.client_uuid}`" class="card pressable flex items-center gap-3 border-primary p-4 hover:bg-surface-2">
        <Icon name="dumbbell" class="size-6 text-primary-fg" />
        <span class="flex-1"><strong>Sesja w toku</strong> – {{ clients.byId(d.client_id)?.full_name ?? 'klient' }}</span>
        <Icon name="chevron" class="size-5 text-subtle" />
      </RouterLink>
      <div v-if="live.queue.length" class="warn-box" role="status">
        <Icon name="clock" class="size-5 shrink-0" />
        <span class="flex-1">{{ live.queue.length }} {{ live.queue.length === 1 ? 'sesja czeka' : 'sesje czekają' }} na wysłanie (brak zasięgu).</span>
        <button class="font-semibold underline" :disabled="live.syncing" @click="live.flush()">Wyślij</button>
      </div>

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

      <section v-if="report" class="card space-y-3 p-4">
        <h2 class="text-xl font-bold">Raport tygodnia</h2>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div class="rounded-xl bg-surface-2 p-3">
            <p class="font-display text-2xl font-bold tabular-nums">{{ report.nextWeek }}</p>
            <p class="text-muted">sesji w przyszłym tyg.</p>
          </div>
          <div class="rounded-xl bg-surface-2 p-3">
            <p class="font-display text-2xl font-bold tabular-nums">{{ report.freeSlots }}</p>
            <p class="text-muted">wolnych slotów</p>
          </div>
        </div>
        <p v-if="report.stalled.length" class="text-sm"><strong>Bez progresji od 3 tyg.:</strong> {{ report.stalled.join(', ') }}</p>
        <p v-if="report.absent.length" class="text-sm"><strong>Dawno nie byli (14+ dni):</strong> {{ report.absent.join(', ') }}</p>
        <p v-if="!report.stalled.length && !report.absent.length" class="text-sm text-muted">Wszyscy klienci trenują regularnie.</p>
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

      <RouterLink to="/asystent" class="card pressable flex items-center gap-4 p-4 hover:bg-surface-2">
        <Icon name="search" class="size-7 shrink-0 text-primary-fg" />
        <div class="min-w-0 flex-1">
          <h2 class="text-xl font-bold">Asystent</h2>
          <p class="text-sm text-muted">Zapytaj np. „kiedy Ania ostatnio robiła martwy ciąg i z jakim ciężarem?”</p>
        </div>
        <Icon name="chevron" class="size-5 shrink-0 text-subtle" />
      </RouterLink>

      <RouterLink to="/analiza" class="card pressable flex items-center gap-4 p-4 hover:bg-surface-2">
        <Icon name="video" class="size-7 shrink-0 text-primary-fg" />
        <div class="min-w-0 flex-1">
          <h2 class="text-xl font-bold">Analiza ruchu</h2>
          <p class="text-sm text-muted">Nagraj ćwiczenie – licznik powtórzeń, kąty, tempo i porównanie ze wzorcem.</p>
        </div>
        <Icon name="chevron" class="size-5 shrink-0 text-subtle" />
      </RouterLink>
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
