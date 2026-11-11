<script setup lang="ts">
// Wydruk / PDF zestawienia dla recepcji siłowni: miesiąc, treningi personalne (dzień + klient), zajęcia grupowe.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useCalendarStore } from '@/stores/calendar'
import { useAuthStore } from '@/stores/auth'
import { buildReport, loadMonth, monthFromKey, monthLabel } from '@/lib/gymReport'
import Icon from '@/components/Icon.vue'

const route = useRoute()
const router = useRouter()
const clients = useClientsStore()
const cal = useCalendarStore()
const auth = useAuthStore()
const month = monthFromKey(String(route.query.m ?? ''))
const data = ref<Awaited<ReturnType<typeof loadMonth>> | null>(null)
const error = ref('')
onMounted(async () => {
  try {
    await Promise.all([clients.load(), cal.gyms.length ? null : cal.loadGyms()])
    data.value = await loadMonth(month)
  } catch (e) {
    error.value = (e as Error).message
  }
})
const gym = computed(() => cal.gyms.find((g) => g.id === route.query.g) ?? null)
const report = computed(() => (data.value && gym.value ? buildReport(data.value, gym.value, (id) => clients.byId(id)?.full_name ?? 'Klient') : null))
const trainer = computed(() => auth.profile?.full_name ?? '')
const print = () => window.print()
</script>

<template>
  <div class="print-page min-h-dvh bg-white text-stone-900">
    <div class="sticky top-0 flex items-center gap-2 border-b border-stone-200 bg-white p-3 print:hidden">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <span class="flex-1 text-sm text-stone-500">Podgląd – „Zapisz jako PDF” w oknie drukowania</span>
      <button v-if="report" class="btn-primary" @click="print"><Icon name="download" class="size-4" />Drukuj / PDF</button>
    </div>

    <article v-if="report && gym" class="mx-auto max-w-4xl p-6 print:p-0">
      <header class="mb-4 border-b-2 border-stone-800 pb-2">
        <h1 class="text-2xl font-bold capitalize">{{ gym.name }} – {{ monthLabel(month) }}</h1>
        <p class="text-sm text-stone-600"><template v-if="trainer">{{ trainer }} · </template>treningi personalne: {{ report.personal.length }} · zajęcia grupowe: {{ report.groups.length }}</p>
      </header>

      <div class="grid grid-cols-[3fr_4fr] gap-6 print:gap-4">
        <section>
          <h2 class="mb-1 text-sm font-bold tracking-wide uppercase">Treningi personalne</h2>
          <table class="report-table">
            <thead><tr><th class="w-24">Dzień (data)</th><th>Klient</th></tr></thead>
            <tbody>
              <tr v-for="r in report.personal" :key="r.id">
                <td class="tabular-nums">{{ r.date }}</td>
                <td>{{ r.client }}</td>
              </tr>
              <tr v-if="!report.personal.length"><td colspan="2" class="text-stone-500">brak</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h2 class="mb-1 text-sm font-bold tracking-wide uppercase">Treningi grupowe</h2>
          <table class="report-table">
            <thead><tr><th class="w-24">Data</th><th>Rodzaj zajęć</th><th class="w-10 text-center">LP</th><th class="w-14 text-right">Osoby</th></tr></thead>
            <tbody>
              <tr v-for="r in report.groups" :key="r.id">
                <td class="tabular-nums">{{ r.date }}</td>
                <td>{{ r.kind }}</td>
                <td class="text-center tabular-nums">{{ r.lp }}</td>
                <td class="text-right font-semibold tabular-nums">{{ r.participants ?? '' }}</td>
              </tr>
              <tr v-if="!report.groups.length"><td colspan="4" class="text-stone-500">brak</td></tr>
            </tbody>
          </table>
        </section>
      </div>
    </article>
    <p v-else class="p-10 text-center text-stone-500">{{ error || 'Ładowanie…' }}</p>
  </div>
</template>

<style>
.report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.report-table th {
  background: #fde68a;
  text-align: left;
  font-weight: 700;
}
.report-table th,
.report-table td {
  border: 1px solid #a8a29e;
  padding: 3px 6px;
}
@media print {
  @page {
    margin: 12mm;
  }
  nav {
    display: none !important;
  }
  body {
    background: #fff !important;
  }
  .report-table tr {
    break-inside: avoid;
  }
}
</style>
