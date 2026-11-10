<script setup lang="ts">
// Raport miesięczny: liczba sesji i odwołań na klienta.
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useScheduleStore } from '@/stores/schedule'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const schedule = useScheduleStore()
const clients = useClientsStore()
const month = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const loading = ref(false)

async function load() {
  loading.value = true
  const from = month.value
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
  await schedule.loadRange(from, to)
  loading.value = false
}
onMounted(async () => {
  await clients.load()
  await load()
})
watch(month, load)

const inMonth = computed(() => {
  const from = month.value.toISOString()
  const to = new Date(month.value.getFullYear(), month.value.getMonth() + 1, 1).toISOString()
  return schedule.sessions.filter((s) => s.starts_at >= from && s.starts_at < to)
})

const rows = computed(() => {
  const map = new Map<string, { done: number; planned: number; cancelled: number; noShow: number }>()
  for (const s of inMonth.value) {
    const r = map.get(s.client_id) ?? { done: 0, planned: 0, cancelled: 0, noShow: 0 }
    if (s.status === 'completed') r.done++
    else if (s.status === 'cancelled') r.cancelled++
    else if (s.status === 'no_show') r.noShow++
    else r.planned++
    map.set(s.client_id, r)
  }
  return [...map.entries()]
    .map(([id, r]) => ({ id, name: clients.byId(id)?.full_name ?? 'Klient', ...r }))
    .sort((a, b) => b.done + b.planned - (a.done + a.planned))
})
const total = computed(() => rows.value.reduce((t, r) => ({ done: t.done + r.done, planned: t.planned + r.planned, cancelled: t.cancelled + r.cancelled, noShow: t.noShow + r.noShow }), { done: 0, planned: 0, cancelled: 0, noShow: 0 }))
const shift = (n: number) => (month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1))
</script>

<template>
  <main class="pb-8">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-2xl font-bold">Raport</h1>
    </header>
    <div class="space-y-4 px-4">
      <div class="flex items-center justify-between">
        <button class="icon-btn -ml-2" aria-label="Poprzedni miesiąc" @click="shift(-1)"><Icon name="back" class="size-5" /></button>
        <p class="font-display text-xl font-bold capitalize">{{ month.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }) }}</p>
        <button class="icon-btn -mr-2" aria-label="Następny miesiąc" @click="shift(1)"><Icon name="chevron" class="size-5" /></button>
      </div>

      <div class="grid grid-cols-3 gap-2">
        <div class="card p-3 text-center"><p class="font-display text-3xl font-bold tabular-nums text-success">{{ total.done }}</p><p class="text-xs text-muted">odbyte</p></div>
        <div class="card p-3 text-center"><p class="font-display text-3xl font-bold tabular-nums">{{ total.planned }}</p><p class="text-xs text-muted">zaplanowane</p></div>
        <div class="card p-3 text-center"><p class="font-display text-3xl font-bold tabular-nums text-danger">{{ total.cancelled + total.noShow }}</p><p class="text-xs text-muted">odwołane / nieob.</p></div>
      </div>

      <p v-if="loading" class="text-muted">Ładowanie…</p>
      <p v-else-if="!rows.length" class="text-center text-muted">Brak sesji w tym miesiącu.</p>
      <table v-else class="card w-full overflow-hidden text-sm">
        <thead>
          <tr class="border-b border-line text-left text-xs text-muted">
            <th class="p-3 font-semibold">Klient</th>
            <th class="p-3 text-center font-semibold">Odbyte</th>
            <th class="p-3 text-center font-semibold">Plan</th>
            <th class="p-3 text-center font-semibold">Odw.</th>
            <th class="p-3 text-center font-semibold">Nieob.</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="border-b border-line last:border-0">
            <td class="p-3"><RouterLink :to="`/klienci/${r.id}`" class="font-semibold underline-offset-4 hover:underline">{{ r.name }}</RouterLink></td>
            <td class="p-3 text-center tabular-nums">{{ r.done }}</td>
            <td class="p-3 text-center tabular-nums">{{ r.planned }}</td>
            <td class="p-3 text-center tabular-nums">{{ r.cancelled }}</td>
            <td class="p-3 text-center tabular-nums">{{ r.noShow }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
</template>
