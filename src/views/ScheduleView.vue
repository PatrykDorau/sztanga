<script setup lang="ts">
// Grafik trenerki: pasek tygodnia + lista sesji wybranego dnia (mobile-first), tryb tygodnia jako lista dni.
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { useScheduleStore } from '@/stores/schedule'
import { addDays, dayLabel, sameDay, startOfWeek, ymd } from '@/lib/dates'
import { WEEKDAYS_SHORT } from '@/lib/vocab'
import NewSessionSheet from '@/components/NewSessionSheet.vue'
import SessionCard from '@/components/SessionCard.vue'
import SessionSheet from '@/components/SessionSheet.vue'
import Icon from '@/components/Icon.vue'
import GymBadge from '@/components/GymBadge.vue'
import { useCalendarStore } from '@/stores/calendar'
import { hm } from '@/lib/dates'
import type { CalendarBlock, Session } from '@/types'
import { useGroupClassesStore, type GroupClass } from '@/stores/groupClasses'
import GroupClassSheet from '@/components/GroupClassSheet.vue'
import GroupClassCard from '@/components/GroupClassCard.vue'

const route = useRoute()
const router = useRouter()
const schedule = useScheduleStore()
const clients = useClientsStore()
const programs = useProgramsStore()
const cal = useCalendarStore()

const selected = ref(route.query.d ? new Date(String(route.query.d) + 'T12:00') : new Date())
const mode = ref<'day' | 'week'>('day')
const weekStart = computed(() => startOfWeek(selected.value))
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)))
const openId = ref<string | null>(null)
const creating = ref(false)
const groups = useGroupClassesStore()
const groupSheet = ref<{ item: GroupClass | null } | null>(null)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([
      schedule.loadRange(weekStart.value, addDays(weekStart.value, 7)),
      groups.loadRange(weekStart.value, addDays(weekStart.value, 7)),
      cal.loadBlocks(weekStart.value, addDays(weekStart.value, 7)).catch(() => null),
    ])
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await Promise.all([clients.load(), programs.loadList(), load(), schedule.loadRequests().catch(() => null), cal.loadGyms(), cal.loadStatus().catch(() => null)])
})
watch(weekStart, (a, b) => a.getTime() !== b?.getTime() && load())
watch(selected, (d) => router.replace({ query: { d: ymd(d) } }))

const sessionsOn = (d: Date) => schedule.sessions.filter((s) => sameDay(new Date(s.starts_at), d))
const groupsOn = (d: Date) => groups.list.filter((g) => sameDay(new Date(g.starts_at), d))
const activeOn = (d: Date) => sessionsOn(d).filter((s) => ['pending', 'confirmed', 'completed'].includes(s.status)).length + groupsOn(d).filter((g) => !g.cancelled).length
// Dzień = sesje + zajęcia grupowe + wydarzenia z Google Calendar (Wolne / Zajęte / Do przypisania), po kolei w czasie.
const blocksOn = (d: Date) => cal.blocks.filter((b) => !b.all_day && sameDay(new Date(b.starts_at), d))
type Row = { kind: 'session'; at: string; s: Session } | { kind: 'block'; at: string; b: CalendarBlock } | { kind: 'group'; at: string; g: GroupClass }
const rowsOn = (d: Date, withBlocks: boolean) =>
  [
    ...sessionsOn(d).map((s) => ({ kind: 'session' as const, at: s.starts_at, s })),
    ...groupsOn(d).map((g) => ({ kind: 'group' as const, at: g.starts_at, g })),
    ...(withBlocks ? blocksOn(d).map((b) => ({ kind: 'block' as const, at: b.starts_at, b })) : []),
  ].sort((a, b) => a.at.localeCompare(b.at)) as Row[]
const dayRows = computed<Row[]>(() => rowsOn(selected.value, true))
const rowKey = (r: Row) => (r.kind === 'session' ? r.s.id : r.kind === 'group' ? r.g.id : r.b.gcal_event_id)
const allDayOn = (d: Date) => cal.blocks.filter((b) => b.all_day && new Date(b.starts_at) <= d && new Date(b.ends_at) > d)
const BLOCK_LABEL = { free: 'Wolne', busy: 'Zajęte', unmatched: 'Do przypisania', session: '' }
const unmatchedCount = computed(() => cal.blocks.filter((b) => b.kind === 'unmatched').length)
const pendingCount = computed(() => schedule.sessions.filter((s) => s.status === 'pending').length)
const newRequests = computed(() => schedule.requests.filter((r) => r.status === 'new').length)
const today = new Date()

const clientName = (id: string) => clients.byId(id)?.full_name ?? 'Klient'
const shift = (n: number) => (selected.value = addDays(selected.value, n))
</script>

<template>
  <main class="pb-28">
    <header class="page-header space-y-3 px-4 pb-3">
      <div class="flex items-center justify-between gap-2">
        <h1 class="page-title">Grafik</h1>
        <div class="flex gap-0.5">
          <RouterLink to="/grafik/zgloszenia" class="icon-btn relative !h-auto flex-col py-1" :aria-label="`Zgłoszenia na konsultację${newRequests ? ` (${newRequests} nowe)` : ''}`">
            <Icon name="bell" class="size-5" /><span class="mt-0.5 block text-[10px] leading-none font-semibold text-muted">Zgłoszenia</span>
            <span v-if="newRequests" class="absolute top-0 right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-on-primary">{{ newRequests }}</span>
          </RouterLink>
          <RouterLink to="/grafik/google" class="icon-btn relative !h-auto flex-col py-1" :aria-label="`Google Calendar${unmatchedCount ? ` (${unmatchedCount} do przypisania)` : ''}`">
            <Icon name="calendar" class="size-5" :class="cal.status?.connected ? 'text-success' : ''" /><span class="mt-0.5 block text-[10px] leading-none font-semibold text-muted">Google</span>
            <span v-if="unmatchedCount" class="absolute top-0 right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-on-primary">{{ unmatchedCount }}</span>
          </RouterLink>
          <RouterLink to="/grafik/raport" class="icon-btn !h-auto flex-col py-1" aria-label="Raport miesięczny"><Icon name="clipboard" class="size-5" /><span class="mt-0.5 block text-[10px] leading-none font-semibold text-muted">Raport</span></RouterLink>
          <RouterLink to="/grafik/dostepnosc" class="icon-btn !h-auto flex-col py-1" aria-label="Dostępność i zasady rezerwacji"><Icon name="clock" class="size-5" /><span class="mt-0.5 block text-[10px] leading-none font-semibold text-muted">Godziny</span></RouterLink>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <button class="icon-btn -ml-2" aria-label="Poprzedni tydzień" @click="shift(-7)"><Icon name="back" class="size-5" /></button>
        <button class="pressable rounded-lg px-2 font-semibold capitalize" @click="selected = new Date()">
          {{ weekStart.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) }} – {{ addDays(weekStart, 6).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) }}
        </button>
        <button class="icon-btn -mr-2" aria-label="Następny tydzień" @click="shift(7)"><Icon name="chevron" class="size-5" /></button>
      </div>

      <div class="grid grid-cols-7 gap-1" role="tablist" aria-label="Dni tygodnia">
        <button
          v-for="(d, i) in days"
          :key="i"
          role="tab"
          :aria-selected="sameDay(d, selected)"
          class="pressable flex min-h-14 flex-col items-center justify-center rounded-xl border text-xs"
          :class="[
            sameDay(d, selected) ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface',
            sameDay(d, today) && !sameDay(d, selected) ? '!border-primary-fg' : '',
          ]"
          @click="(selected = d), (mode = 'day')"
        >
          <span class="font-medium">{{ WEEKDAYS_SHORT[i] }}</span>
          <span class="font-display text-lg leading-none font-bold">{{ d.getDate() }}</span>
          <span class="mt-0.5 flex h-1.5 gap-0.5" aria-hidden="true">
            <span v-for="n in Math.min(activeOn(d), 4)" :key="n" class="size-1.5 rounded-full" :class="sameDay(d, selected) ? 'bg-on-primary' : 'bg-primary'" />
          </span>
          <span class="sr-only">{{ activeOn(d) }} sesji</span>
        </button>
      </div>

      <div class="grid grid-cols-2 rounded-xl bg-surface-2 p-1">
        <button class="min-h-10 rounded-lg text-sm font-semibold" :class="mode === 'day' ? 'bg-surface shadow' : 'text-muted'" @click="mode = 'day'">Dzień</button>
        <button class="min-h-10 rounded-lg text-sm font-semibold" :class="mode === 'week' ? 'bg-surface shadow' : 'text-muted'" @click="mode = 'week'">Tydzień</button>
      </div>
    </header>

    <div class="space-y-4 px-4">
      <button v-if="pendingCount" type="button" class="warn-box pressable w-full text-left" @click="mode = 'week'">
        <Icon name="clock" class="size-5 shrink-0" />
        <span><strong>{{ pendingCount }}</strong> {{ pendingCount === 1 ? 'rezerwacja czeka' : 'rezerwacje czekają' }} na akceptację w tym tygodniu</span>
      </button>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>

      <template v-if="mode === 'day'">
        <h2 class="text-xl font-bold first-letter:uppercase">{{ dayLabel(selected) }}</h2>
        <p v-for="b in allDayOn(selected)" :key="b.gcal_event_id" class="tag !text-sm">Cały dzień: {{ b.title || 'zajęte' }}</p>
        <p v-if="loading && !dayRows.length" class="text-muted">Ładowanie…</p>
        <div v-else-if="!dayRows.length" class="card p-6 text-center">
          <p class="font-semibold">Brak sesji</p>
          <p class="text-sm text-muted">Dodaj sesję albo pozwól klientom rezerwować w godzinach dostępności.</p>
        </div>
        <ul class="space-y-2">
          <li v-for="r in dayRows" :key="rowKey(r)">
            <SessionCard v-if="r.kind === 'session'" :session="r.s" :title="clientName(r.s.client_id)" :subtitle="r.s.notes ?? undefined" @open="openId = r.s.id" />
            <GroupClassCard v-else-if="r.kind === 'group'" :item="r.g" @open="groupSheet = { item: r.g }" />
            <!-- Wydarzenie z Google Calendar: Wolne (dashed), Zajęte (szare), Do przypisania (ostrzeżenie) -->
            <component
              :is="r.b.kind === 'unmatched' ? 'RouterLink' : 'div'"
              v-else
              to="/grafik/google"
              class="flex items-center gap-3 rounded-2xl p-3"
              :class="{
                'border-2 border-dashed border-line-strong': r.b.kind === 'free',
                'bg-surface-2 text-muted': r.b.kind === 'busy',
                'warn-box !p-3': r.b.kind === 'unmatched',
              }"
            >
              <div class="w-14 shrink-0 text-center">
                <p class="font-display text-lg leading-none font-bold tabular-nums">{{ hm(r.b.starts_at) }}</p>
                <p class="text-[11px] tabular-nums opacity-80">{{ hm(r.b.ends_at) }}</p>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-semibold tracking-wide uppercase">{{ BLOCK_LABEL[r.b.kind] }}</p>
                <p v-if="r.b.kind !== 'free'" class="truncate text-sm">{{ r.b.title || '—' }}</p>
              </div>
              <GymBadge v-if="r.b.kind === 'free'" :gym-id="r.b.gym_id" />
              <Icon name="calendar" class="size-4 shrink-0 opacity-60" aria-label="z Google Calendar" />
            </component>
          </li>
        </ul>
      </template>

      <template v-else>
        <section v-for="d in days" :key="ymd(d)">
          <h2 class="mb-2 text-lg font-bold first-letter:uppercase" :class="sameDay(d, today) ? 'text-primary-fg' : ''">{{ dayLabel(d) }}</h2>
          <p v-if="!rowsOn(d, false).length" class="mb-2 text-sm text-muted">—</p>
          <ul class="space-y-2">
            <li v-for="r in rowsOn(d, false)" :key="rowKey(r)">
              <SessionCard v-if="r.kind === 'session'" :session="r.s" :title="clientName(r.s.client_id)" @open="openId = r.s.id" />
              <GroupClassCard v-else-if="r.kind === 'group'" :item="r.g" @open="groupSheet = { item: r.g }" />
            </li>
          </ul>
        </section>
      </template>
    </div>

    <div class="fixed right-4 z-20 flex gap-2" style="bottom: calc(5rem + env(safe-area-inset-bottom))">
      <button class="btn-ghost border border-line-strong bg-surface shadow-lg" @click="groupSheet = { item: null }"><Icon name="users" class="size-5" />Zajęcia</button>
      <button class="btn-primary shadow-lg" @click="creating = true"><Icon name="plus" class="size-5" />Sesja</button>
    </div>

    <SessionSheet v-if="openId" :id="openId" @close="openId = null" />
    <GroupClassSheet v-if="groupSheet" :item="groupSheet.item" :day="ymd(selected)" @close="groupSheet = null" @done="groupSheet = null" />
    <NewSessionSheet v-if="creating" :day="ymd(selected)" @close="creating = false" @done="(creating = false), load()" />
  </main>
</template>
