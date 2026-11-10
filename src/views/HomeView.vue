<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useExercisesStore } from '@/stores/exercises'
import { useProgramsStore } from '@/stores/programs'
import Icon from '@/components/Icon.vue'

const auth = useAuthStore()
const ex = useExercisesStore()
const programs = useProgramsStore()
onMounted(() => Promise.all([ex.load(), programs.loadList()]))

// Dla klienta RLS zwraca tylko jego plany, które nie są szkicem.
const myPlans = computed(() => (auth.isTrainer ? [] : programs.list.filter((p) => !p.is_template && p.status !== 'draft')))

const own = computed(() => ex.all.filter((e) => e.source === 'own'))
const withVideo = computed(() => own.value.filter((e) => e.video_path).length)
const firstName = computed(() => (auth.profile?.full_name ?? '').split(/[\s@]/)[0])
const GOAL = 30
</script>

<template>
  <main class="space-y-5 px-4 pt-6">
    <header>
      <p class="text-sm text-stone-500">Cześć{{ firstName ? `, ${firstName}` : '' }}</p>
      <h1 class="text-2xl font-bold">Dzisiaj</h1>
    </header>

    <section v-if="auth.isTrainer" class="card p-5">
      <div class="mb-3 flex items-baseline justify-between">
        <h2 class="font-semibold">Twoja baza ćwiczeń</h2>
        <span class="text-sm text-stone-500">cel: {{ GOAL }}–50</span>
      </div>
      <div class="mb-2 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
        <div class="h-full rounded-full bg-brand-600 transition-all" :style="{ width: Math.min(100, (own.length / GOAL) * 100) + '%' }" />
      </div>
      <p class="text-sm text-stone-600 dark:text-stone-400">
        <strong class="text-stone-900 dark:text-stone-100">{{ own.length }}</strong> własnych ćwiczeń,
        {{ withVideo }} z filmikiem
      </p>
      <div class="mt-4 grid grid-cols-2 gap-2">
        <RouterLink to="/cwiczenia/nowe" class="btn-primary"><Icon name="plus" class="size-4" />Dodaj ćwiczenie</RouterLink>
        <RouterLink to="/cwiczenia" class="btn-ghost"><Icon name="search" class="size-4" />Przeglądaj</RouterLink>
      </div>
    </section>

    <section v-else-if="myPlans.length" class="space-y-2">
      <h2 class="font-semibold">Twój plan</h2>
      <RouterLink v-for="p in myPlans" :key="p.id" :to="`/plany/${p.id}/druk`" class="card flex items-center justify-between gap-3 p-4">
        <div class="min-w-0">
          <p class="truncate font-medium">{{ p.name }}</p>
          <p class="text-xs text-stone-500">
            {{ p.status === 'active' ? 'aktywny' : 'zakończony' }}<template v-if="p.start_date"> · od {{ new Date(p.start_date).toLocaleDateString('pl-PL') }}</template>
          </p>
        </div>
        <span class="flex items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-500"><Icon name="download" class="size-4" />Zobacz / PDF</span>
      </RouterLink>
    </section>

    <section v-else-if="auth.profile" class="card p-5">
      <h2 class="mb-1 font-semibold">Twój plan pojawi się tutaj</h2>
      <p class="text-sm text-stone-600 dark:text-stone-400">Trenerka przygotowuje plany w aplikacji. Do tego czasu możesz przejrzeć bazę ćwiczeń.</p>
    </section>

    <section v-if="auth.isTrainer" class="grid grid-cols-2 gap-3">
      <RouterLink to="/klienci" class="card p-4">
        <Icon name="users" class="mb-2 size-6 text-brand-700 dark:text-brand-500" />
        <p class="font-semibold">Klienci</p>
        <p class="text-xs text-stone-500">profile i plany</p>
      </RouterLink>
      <RouterLink to="/plany" class="card p-4">
        <Icon name="clipboard" class="mb-2 size-6 text-brand-700 dark:text-brand-500" />
        <p class="font-semibold">Szablony</p>
        <p class="text-xs text-stone-500">gotowe programy</p>
      </RouterLink>
    </section>

    <section class="card p-5">
      <h2 class="mb-3 font-semibold">Wkrótce w aplikacji</h2>
      <ul class="space-y-2 text-sm text-stone-600 dark:text-stone-400">
        <li>• Grafik i rezerwacje klientów (faza 3)</li>
        <li>• Prowadzenie sesji na żywo i dashboard klienta (faza 4)</li>
      </ul>
    </section>
  </main>
</template>
