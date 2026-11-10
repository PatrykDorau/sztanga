<script lang="ts">
import { reactive } from 'vue'
// Filtry żyją poza komponentem, żeby po powrocie ze szczegółów ćwiczenia zostały na miejscu.
const filters = reactive({
  q: '',
  muscles: [] as string[],
  equipment: [] as string[],
  pattern: [] as string[],
  level: [] as string[],
  favOnly: false,
  scope: 'own' as 'own' | 'all',
})
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useExercisesStore } from '@/stores/exercises'
import { EQUIPMENT, LEVELS, MUSCLES, PATTERNS, label } from '@/lib/vocab'
import { matches } from '@/lib/search'
import ChipSelect from '@/components/ChipSelect.vue'
import ExerciseThumb from '@/components/ExerciseThumb.vue'
import Icon from '@/components/Icon.vue'

const auth = useAuthStore()
const ex = useExercisesStore()
const showFilters = ref(false)
const LIMIT_STEP = 60
const limit = ref(LIMIT_STEP)

onMounted(() => ex.load())

const hasImported = computed(() => ex.all.some((e) => e.source !== 'own'))
const activeFilterCount = computed(
  () => filters.muscles.length + filters.equipment.length + filters.pattern.length + filters.level.length,
)

const results = computed(() =>
  ex.all.filter((e) => {
    if (filters.scope === 'own' && hasImported.value && e.source !== 'own') return false
    if (filters.favOnly && !ex.favorites.has(e.id)) return false
    if (filters.muscles.length && !filters.muscles.some((m) => e.muscle_groups.includes(m))) return false
    if (filters.equipment.length && !filters.equipment.some((m) => e.equipment.includes(m))) return false
    if (filters.pattern.length && !filters.pattern.includes(e.movement_pattern ?? '')) return false
    if (filters.level.length && !filters.level.includes(e.level)) return false
    return matches(
      filters.q,
      e.name_pl,
      e.name_en,
      ...e.muscle_groups.map((m) => label(MUSCLES, m)),
      ...e.equipment.map((m) => label(EQUIPMENT, m)),
      label(PATTERNS, e.movement_pattern),
    )
  }),
)
const visible = computed(() => results.value.slice(0, limit.value))

function clearFilters() {
  filters.muscles = []
  filters.equipment = []
  filters.pattern = []
  filters.level = []
}
</script>

<template>
  <main>
    <header class="sticky top-0 z-10 space-y-3 bg-stone-50/95 px-4 pt-6 pb-3 backdrop-blur dark:bg-stone-950/95">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Ćwiczenia</h1>
        <RouterLink v-if="auth.isTrainer" to="/cwiczenia/nowe" class="btn-primary" aria-label="Dodaj ćwiczenie">
          <Icon name="plus" class="size-5" />Dodaj
        </RouterLink>
      </div>
      <div class="relative">
        <Icon name="search" class="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-stone-400" />
        <input v-model="filters.q" type="search" class="input pl-10" placeholder="Szukaj: nazwa, partia, sprzęt…" @input="limit = LIMIT_STEP" />
      </div>
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        <button :class="showFilters || activeFilterCount ? 'chip-on' : 'chip-off'" @click="showFilters = !showFilters">
          <Icon name="filter" class="mr-1 size-4" />Filtry{{ activeFilterCount ? ` (${activeFilterCount})` : '' }}
        </button>
        <button :class="filters.favOnly ? 'chip-on' : 'chip-off'" @click="filters.favOnly = !filters.favOnly">
          <Icon name="star" class="mr-1 size-4" />Ulubione
        </button>
        <template v-if="hasImported">
          <button :class="filters.scope === 'own' ? 'chip-on' : 'chip-off'" @click="filters.scope = 'own'">Moje</button>
          <button :class="filters.scope === 'all' ? 'chip-on' : 'chip-off'" @click="filters.scope = 'all'">Wszystkie</button>
        </template>
      </div>

      <div v-if="showFilters" class="card space-y-3 p-4">
        <div>
          <p class="label">Partia mięśniowa</p>
          <ChipSelect v-model="filters.muscles" :options="MUSCLES" />
        </div>
        <div>
          <p class="label">Sprzęt</p>
          <ChipSelect v-model="filters.equipment" :options="EQUIPMENT" />
        </div>
        <div>
          <p class="label">Wzorzec ruchu</p>
          <ChipSelect v-model="filters.pattern" :options="PATTERNS" />
        </div>
        <div>
          <p class="label">Poziom</p>
          <ChipSelect v-model="filters.level" :options="LEVELS" />
        </div>
        <div class="flex gap-2">
          <button class="btn-ghost flex-1" @click="clearFilters">Wyczyść</button>
          <button class="btn-primary flex-1" @click="showFilters = false">Pokaż {{ results.length }}</button>
        </div>
      </div>
    </header>

    <section class="px-4">
      <p v-if="ex.loading && !ex.loaded" class="py-10 text-center text-stone-500">Ładowanie…</p>

      <div v-else-if="!ex.all.length" class="card p-6 text-center">
        <p class="mb-1 font-semibold">Baza jest jeszcze pusta</p>
        <p class="mb-4 text-sm text-stone-500">Dodaj swoje najczęstsze ćwiczenia albo zaimportuj bazę startową.</p>
        <div v-if="auth.isTrainer" class="flex flex-col gap-2">
          <RouterLink to="/cwiczenia/nowe" class="btn-primary">Dodaj pierwsze ćwiczenie</RouterLink>
          <RouterLink to="/cwiczenia/import" class="btn-ghost">Importuj bazę startową (~870)</RouterLink>
        </div>
      </div>

      <p v-else-if="!results.length" class="py-10 text-center text-stone-500">Nic nie pasuje do wyszukiwania.</p>

      <template v-else>
        <p class="mb-2 text-xs text-stone-500">{{ results.length }} ćwiczeń</p>
        <ul class="space-y-2">
          <li v-for="e in visible" :key="e.id">
            <RouterLink :to="`/cwiczenia/${e.id}`" class="card flex items-center gap-3 p-2 pr-3 active:bg-stone-100 dark:active:bg-stone-800">
              <ExerciseThumb :exercise="e" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ e.name_pl }}</p>
                <p class="truncate text-xs text-stone-500">
                  {{ [...e.muscle_groups.slice(0, 2).map((m) => label(MUSCLES, m)), ...e.equipment.slice(0, 1).map((m) => label(EQUIPMENT, m))].join(' · ') }}
                </p>
              </div>
              <button
                class="-m-2 p-2"
                :class="ex.favorites.has(e.id) ? 'text-amber-500' : 'text-stone-300 dark:text-stone-700'"
                :aria-label="ex.favorites.has(e.id) ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'"
                @click.prevent="ex.toggleFavorite(e.id)"
              >
                <Icon name="star" class="size-5" :class="ex.favorites.has(e.id) ? 'fill-current' : ''" />
              </button>
            </RouterLink>
          </li>
        </ul>
        <button v-if="results.length > limit" class="btn-ghost my-4 w-full" @click="limit += LIMIT_STEP">
          Pokaż więcej ({{ results.length - limit }})
        </button>
      </template>

      <RouterLink v-if="auth.isTrainer && ex.all.length && !hasImported" to="/cwiczenia/import" class="mt-6 block text-center text-sm text-stone-500 underline">
        Importuj bazę startową z free-exercise-db
      </RouterLink>
    </section>
  </main>
</template>
