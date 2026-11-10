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

const route = useRoute()
const router = useRouter()
const schedule = useScheduleStore()
const clients = useClientsStore()
const programs = useProgramsStore()

const selected = ref(route.query.d ? new Date(String(route.query.d) + 'T12:00') : new Date())
const mode = ref<'day' | 'week'>('day')
const weekStart = computed(() => startOfWeek(selected.value))
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)))
const openId = ref<string | null>(null)
const creating = ref(false)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    await schedule.loadRange(weekStart.value, addDays(weekStart.value, 7))
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await Promise.all([clients.load(), programs.loadList(), load(), schedule.loadRequests().catch(() => null)])
})
watch(weekStart, (a, b) => a.getTime() !== b?.getTime() && load())
watch(selected, (d) => router.replace({ query: { d: ymd(d) } }))

const sessionsOn = (d: Date) => schedule.sessions.filter((s) => sameDay(new Date(s.starts_at), d))
const activeOn = (d: Date) => sessionsOn(d).filter((s) => ['pending', 'confirmed', 'completed'].includes(s.status)).length
const daySessions = computed(() => sessionsOn(selected.value))
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
        <div class="flex gap-1">
          <RouterLink to="/grafik/zgloszenia" class="icon-btn relative" :aria-label="`Zgłoszenia na konsultację${newRequests ? ` (${newRequests} nowe)` : ''}`">
            <Icon name="bell" class="size-5" />
            <span v-if="newRequests" class="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-on-primary">{{ newRequests }}</span>
          </RouterLink>
          <RouterLink to="/grafik/raport" class="icon-btn" aria-label="Raport miesięczny"><Icon name="clipboard" class="size-5" /></RouterLink>
          <RouterLink to="/grafik/dostepnosc" class="icon-btn" aria-label="Dostępność i zasady rezerwacji"><Icon name="clock" class="size-5" /></RouterLink>
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
        <p v-if="loading && !daySessions.length" class="text-muted">Ładowanie…</p>
        <div v-else-if="!daySessions.length" class="card p-6 text-center">
          <p class="font-semibold">Brak sesji</p>
          <p class="text-sm text-muted">Dodaj sesję albo pozwól klientom rezerwować w godzinach dostępności.</p>
        </div>
        <ul class="space-y-2">
          <li v-for="s in daySessions" :key="s.id">
            <SessionCard :session="s" :title="clientName(s.client_id)" :subtitle="s.notes ?? undefined" @open="openId = s.id" />
          </li>
        </ul>
      </template>

      <template v-else>
        <section v-for="d in days" :key="ymd(d)">
          <h2 class="mb-2 text-lg font-bold first-letter:uppercase" :class="sameDay(d, today) ? 'text-primary-fg' : ''">{{ dayLabel(d) }}</h2>
          <p v-if="!sessionsOn(d).length" class="mb-2 text-sm text-muted">—</p>
          <ul class="space-y-2">
            <li v-for="s in sessionsOn(d)" :key="s.id">
              <SessionCard :session="s" :title="clientName(s.client_id)" @open="openId = s.id" />
            </li>
          </ul>
        </section>
      </template>
    </div>

    <button
      class="btn-primary fixed right-4 z-20 shadow-lg"
      style="bottom: calc(5rem + env(safe-area-inset-bottom))"
      @click="creating = true"
    >
      <Icon name="plus" class="size-5" />Sesja
    </button>

    <SessionSheet v-if="openId" :id="openId" @close="openId = null" />
    <NewSessionSheet v-if="creating" :day="ymd(selected)" @close="creating = false" @done="(creating = false), load()" />
  </main>
</template>
