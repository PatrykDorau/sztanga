<script setup lang="ts">
// Klienci + widok zbiorczy: kto robi postęp, kto stoi w miejscu, kto dawno nie był (sortowanie i filtry).
import { computed, onMounted, ref } from 'vue'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { useProgressStore } from '@/stores/progress'
import { GROUPS, label } from '@/lib/vocab'
import { matches } from '@/lib/search'
import { clientStatus, type Trend } from '@/lib/analytics'
import type { SessionLog } from '@/types'
import Icon from '@/components/Icon.vue'
import GymBadge from '@/components/GymBadge.vue'
import { useCalendarStore } from '@/stores/calendar'

const clients = useClientsStore()
const programs = useProgramsStore()
const progress = useProgressStore()
const q = ref('')
const group = ref<string | null>(null)
const showArchived = ref(false)
const gym = ref<string | null>(null) // filtr siłowni; '' = bez siłowni
const calendar = useCalendarStore()
type Sort = 'name' | 'absent' | 'progress'
const sort = ref<Sort>('name')
const recentLogs = ref<SessionLog[]>([])

onMounted(async () => {
  await Promise.all([clients.load(), programs.loadList(), calendar.gyms.length ? null : calendar.loadGyms?.().catch(() => null)])
  recentLogs.value = await progress.loadAllRecent().catch(() => [])
})

const activeProgram = (clientId: string) =>
  programs.list.find((p) => p.client_id === clientId && p.status === 'active') ??
  programs.list.find((p) => p.client_id === clientId && p.status === 'draft')

const status = computed(() => {
  const m = new Map<string, ReturnType<typeof clientStatus>>()
  for (const c of clients.all) m.set(c.id, clientStatus(recentLogs.value.filter((l) => l.client_id === c.id)))
  return m
})

const TREND_ORDER: Record<Trend, number> = { down: 0, flat: 1, none: 2, up: 3 }
const results = computed(() =>
  clients.all
    .filter(
      (c) =>
        c.archived === showArchived.value &&
        (!group.value || c.client_group === group.value) &&
        (gym.value == null || (c.gym_id ?? '') === gym.value) &&
        matches(q.value, c.full_name, c.email, c.goals),
    )
    .sort((a, b) => {
      const sa = status.value.get(a.id)!
      const sb = status.value.get(b.id)!
      if (sort.value === 'absent') return (sb.daysSince ?? 9999) - (sa.daysSince ?? 9999)
      if (sort.value === 'progress') return TREND_ORDER[sb.trend] - TREND_ORDER[sa.trend]
      return a.full_name.localeCompare(b.full_name, 'pl')
    }),
)
const initials = (n: string) => n.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()

// Trend pokazany ikoną + słowem (nie samym kolorem).
const TREND: Record<Trend, { text: string; icon: string; cls: string }> = {
  up: { text: 'postęp', icon: 'trend', cls: 'text-success' },
  flat: { text: 'bez zmian', icon: 'swap', cls: 'text-warn-fg' },
  down: { text: 'spadek', icon: 'down', cls: 'text-danger' },
  none: { text: '', icon: '', cls: '' },
}
const absentLong = (d: number | null) => d !== null && d >= 14
</script>

<template>
  <main class="pb-6">
    <header class="page-header space-y-3 px-4 pb-3">
      <div class="flex items-center justify-between">
        <h1 class="page-title">Klienci</h1>
        <RouterLink to="/klienci/nowy" class="btn-primary"><Icon name="plus" class="size-5" />Dodaj</RouterLink>
      </div>
      <input v-model="q" type="search" class="input" placeholder="Szukaj klienta…" aria-label="Szukaj klienta" />
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        <button :class="!group ? 'chip-on' : 'chip-off'" @click="group = null">Wszyscy</button>
        <button v-for="(l, k) in GROUPS" :key="k" :class="group === k ? 'chip-on' : 'chip-off'" @click="group = String(k)">{{ l }}</button>
        <button :class="showArchived ? 'chip-on' : 'chip-off'" @click="showArchived = !showArchived">Archiwum</button>
      </div>
      <div v-if="calendar.gyms.length > 1" class="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" role="group" aria-label="Siłownia">
        <button :class="gym == null ? 'chip-on' : 'chip-off'" @click="gym = null">Każda siłownia</button>
        <button v-for="g in calendar.gyms" :key="g.id" :class="gym === g.id ? 'chip-on' : 'chip-off'" class="shrink-0" @click="gym = gym === g.id ? null : g.id">{{ g.name }}</button>
        <button v-if="clients.all.some((c) => !c.gym_id)" :class="gym === '' ? 'chip-on' : 'chip-off'" class="shrink-0" @click="gym = gym === '' ? null : ''">Bez siłowni</button>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-muted">Sortuj:</span>
        <button
          v-for="[k, l] in ([['name', 'A–Z'], ['absent', 'Dawno nie był'], ['progress', 'Postęp']] as [Sort, string][])"
          :key="k"
          class="chip !min-h-9 text-sm"
          :class="sort === k ? 'border-primary bg-primary-soft font-semibold' : 'border-line bg-surface text-muted'"
          :aria-pressed="sort === k"
          @click="sort = k"
        >
          {{ l }}
        </button>
      </div>
    </header>

    <section class="px-4">
      <div v-if="clients.loaded && !clients.all.length" class="card p-6 text-center">
        <p class="mb-1 font-semibold">Nie masz jeszcze klientów</p>
        <p class="mb-4 text-sm text-muted">Dodaj klienta, żeby przypisać mu plan.</p>
        <RouterLink to="/klienci/nowy" class="btn-primary">Dodaj pierwszego klienta</RouterLink>
      </div>
      <p v-else-if="clients.loaded && !results.length" class="py-10 text-center text-muted">Brak klientów do pokazania.</p>
      <ul class="space-y-2">
        <li v-for="c in results" :key="c.id">
          <RouterLink :to="`/klienci/${c.id}`" class="card pressable flex items-center gap-3 p-3 hover:bg-surface-2">
            <span class="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft font-display text-lg font-bold text-primary-fg">
              {{ initials(c.full_name) }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-1.5 truncate font-semibold">
                {{ c.full_name }}
                <Icon v-if="c.limitations.length" name="alert" class="size-4 shrink-0 text-warn-fg" aria-label="Ma ograniczenia" />
                <GymBadge v-if="calendar.gyms.length > 1" :gym-id="c.gym_id" />
              </p>
              <p class="truncate text-xs text-muted">{{ label(GROUPS, c.client_group) }} · {{ activeProgram(c.id)?.name ?? 'brak planu' }}</p>
              <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                <span :class="absentLong(status.get(c.id)?.daysSince ?? null) ? 'font-semibold text-danger' : 'text-muted'">
                  {{ status.get(c.id)?.daysSince == null ? 'brak sesji' : status.get(c.id)!.daysSince === 0 ? 'trening dziś' : `${status.get(c.id)!.daysSince} dni temu` }}
                </span>
                <span class="text-muted">· {{ status.get(c.id)?.sessions30 ?? 0 }} w 30 dni</span>
                <span v-if="status.get(c.id)?.trend !== 'none'" class="inline-flex items-center gap-0.5 font-semibold" :class="TREND[status.get(c.id)!.trend].cls">
                  <Icon :name="TREND[status.get(c.id)!.trend].icon" class="size-3.5" />{{ TREND[status.get(c.id)!.trend].text }}
                </span>
              </p>
            </div>
            <Icon name="chevron" class="size-5 text-subtle" />
          </RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>
