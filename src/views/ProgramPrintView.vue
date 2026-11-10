<script setup lang="ts">
// Wersja do druku / zapisu jako PDF (przeglądarka: Drukuj → Zapisz jako PDF). Podstawa pod udostępnianie w fazie 4.
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useExercisesStore } from '@/stores/exercises'
import { useProgramsStore } from '@/stores/programs'
import { PHASES, label } from '@/lib/vocab'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const programs = useProgramsStore()
const clients = useClientsStore()
const ex = useExercisesStore()
const ready = ref(false)
const missing = ref(false)

onMounted(async () => {
  try {
    await Promise.all([programs.open(props.id), clients.load(), ex.load()])
  } catch {
    // Brak planu albo brak dostępu (np. klient, a plan jest szkicem) – RLS zwraca 0 wierszy.
    missing.value = true
  }
  ready.value = true
})

const p = computed(() => (programs.current?.id === props.id ? programs.current : null))
const client = computed(() => clients.byId(p.value?.client_id))
const fmt = (n: number | null) => (n == null ? '' : String(n).replace('.', ','))

function weekDate(i: number) {
  if (!p.value?.start_date) return ''
  const d = new Date(p.value.start_date)
  d.setDate(d.getDate() + i * 7)
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })
}

const print = () => window.print()

function rest(sec: number | null) {
  if (!sec) return ''
  return sec >= 60 && sec % 30 === 0 ? `${fmt(sec / 60)} min` : `${sec} s`
}
</script>

<template>
  <div class="print-page min-h-dvh bg-white text-stone-900">
    <div class="sticky top-0 flex items-center gap-2 border-b border-stone-200 bg-white p-3 print:hidden">
      <button class="p-2" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <span class="flex-1 text-sm text-stone-500">Podgląd wydruku</span>
      <button v-if="p && ready" class="btn-primary" @click="print"><Icon name="download" class="size-4" />Drukuj / PDF</button>
    </div>

    <article v-if="p && ready" class="mx-auto max-w-3xl p-6 print:p-0">
      <header class="mb-6 border-b-2 border-brand-700 pb-3">
        <h1 class="text-2xl font-bold">{{ p.name }}</h1>
        <p class="text-sm text-stone-600">
          <template v-if="client">{{ client.full_name }}</template>
          <template v-if="p.start_date"> · start {{ new Date(p.start_date).toLocaleDateString('pl-PL') }}</template>
          · {{ p.program_weeks.length }} tyg.
        </p>
        <p v-if="p.description" class="mt-2 text-sm">{{ p.description }}</p>
      </header>

      <section v-for="(w, wi) in p.program_weeks" :key="w.id" class="mb-6 break-inside-avoid-page">
        <h2 class="mb-2 text-lg font-semibold">
          Tydzień {{ wi + 1 }}
          <span v-if="w.phase" class="text-sm font-normal text-stone-600">– {{ label(PHASES, w.phase) }}</span>
          <span v-if="weekDate(wi)" class="text-sm font-normal text-stone-500"> (od {{ weekDate(wi) }})</span>
        </h2>
        <div v-for="wo in w.workouts" :key="wo.id" class="mb-4 break-inside-avoid">
          <h3 class="mb-1 font-semibold">{{ wo.name }}</h3>
          <p v-if="wo.notes" class="mb-1 text-sm text-stone-600">{{ wo.notes }}</p>
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="border-b border-stone-300 text-left text-xs text-stone-500">
                <th class="w-8 py-1 font-medium"></th>
                <th class="py-1 font-medium">Ćwiczenie</th>
                <th class="w-12 py-1 text-center font-medium">Serie</th>
                <th class="w-16 py-1 text-center font-medium">Powt.</th>
                <th class="w-20 py-1 text-center font-medium">Ciężar</th>
                <th class="w-12 py-1 text-center font-medium">RPE</th>
                <th class="w-16 py-1 text-center font-medium">Przerwa</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(we, i) in wo.workout_exercises" :key="we.id" class="border-b border-stone-200 align-top">
                <td class="py-1.5 font-semibold text-brand-700">
                  {{ we.group_label ? we.group_label + (wo.workout_exercises.slice(0, i).filter((x) => x.group_label === we.group_label).length + 1) : i + 1 }}
                </td>
                <td class="py-1.5">
                  {{ ex.byId(we.exercise_id)?.name_pl }}
                  <span v-if="we.tempo" class="text-xs text-stone-500"> · tempo {{ we.tempo }}</span>
                  <p v-if="we.notes" class="text-xs text-stone-600">{{ we.notes }}</p>
                </td>
                <td class="py-1.5 text-center">{{ we.sets ?? '' }}</td>
                <td class="py-1.5 text-center">{{ we.reps ?? '' }}</td>
                <td class="py-1.5 text-center">{{ we.load ?? '' }}</td>
                <td class="py-1.5 text-center">{{ fmt(we.rpe) }}</td>
                <td class="py-1.5 text-center">{{ rest(we.rest_sec) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </article>
    <p v-else class="p-10 text-center text-stone-500">{{ missing ? 'Ten plan nie jest dostępny.' : 'Ładowanie…' }}</p>
  </div>
</template>

<style>
@media print {
  @page {
    margin: 14mm;
  }
  nav {
    display: none !important;
  }
  body {
    background: #fff !important;
  }
}
</style>
