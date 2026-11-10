<script setup lang="ts">
import { computed, ref } from 'vue'
import { useExercisesStore } from '@/stores/exercises'
import { useProgramsStore } from '@/stores/programs'
import { useSortable } from '@/lib/sortable'
import { doseLine, describeProgression } from '@/lib/progression'
import type { Workout, WorkoutExercise } from '@/types'
import ExercisePicker from './ExercisePicker.vue'
import ExerciseSheet from './ExerciseSheet.vue'
import Icon from './Icon.vue'

const props = defineProps<{ workout: Workout; limitations: string[] }>()
const ex = useExercisesStore()
const programs = useProgramsStore()

const listEl = ref<HTMLElement | null>(null)
const picking = ref(false)
const editingId = ref<string | null>(null)
const editing = computed(() => props.workout.workout_exercises.find((x) => x.id === editingId.value) ?? null)
const renaming = ref(false)
const name = ref(props.workout.name)
const error = ref('')

useSortable(listEl, {
  group: 'workout-exercises',
  handle: '[data-handle]',
  onMove: (id, from, to, i) => programs.moveExercise(id, from, to, i).catch((e) => (error.value = e.message)),
})

const hasWarning = (we: WorkoutExercise) =>
  (ex.byId(we.exercise_id)?.contraindications ?? []).some((c) => props.limitations.includes(c))

/** Pierwsze ćwiczenie z grupy dostaje ramkę łączącą je z kolejnymi z tą samą literą. */
const groupEdge = (i: number) => {
  const list = props.workout.workout_exercises
  const g = list[i].group_label
  if (!g) return ''
  const prev = list[i - 1]?.group_label === g
  const next = list[i + 1]?.group_label === g
  return [prev ? 'rounded-t-none border-t-0' : '', next ? 'rounded-b-none' : ''].join(' ')
}

async function add(exerciseId: string) {
  picking.value = false
  try {
    const row = await programs.addExercise(props.workout.id, { exercise_id: exerciseId })
    editingId.value = row.id
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function saveName() {
  renaming.value = false
  if (name.value.trim() && name.value !== props.workout.name) await programs.updateWorkout(props.workout.id, { name: name.value.trim() })
}

async function remove() {
  if (confirm(`Usunąć „${props.workout.name}” z tego tygodnia?`)) await programs.removeWorkout(props.workout.id)
}
</script>

<template>
  <section class="card p-3" :data-id="workout.id">
    <header class="mb-2 flex items-center gap-1">
      <span data-day-handle class="cursor-grab touch-none p-1 text-stone-400" aria-label="Przeciągnij, by zmienić kolejność dni">⋮⋮</span>
      <input v-if="renaming" v-model="name" class="input !min-h-9 flex-1" autofocus @blur="saveName" @keydown.enter.prevent="saveName" />
      <button v-else class="flex-1 text-left font-semibold" @click="renaming = true">{{ workout.name }}</button>
      <button class="p-2 text-stone-400 hover:text-red-600" aria-label="Usuń trening" @click="remove"><Icon name="trash" class="size-4" /></button>
    </header>

    <ul ref="listEl" :data-list="workout.id" class="min-h-2 space-y-1">
      <li v-for="(we, i) in workout.workout_exercises" :key="we.id" :data-id="we.id">
        <div
          class="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-950"
          :class="[groupEdge(i), we.group_label ? 'border-l-4 !border-l-brand-600' : '']"
        >
          <span data-handle class="cursor-grab touch-none px-1 text-stone-400" aria-label="Przeciągnij">⋮⋮</span>
          <button class="min-w-0 flex-1 text-left" @click="editingId = we.id">
            <p class="flex items-center gap-1.5 truncate text-sm font-medium">
              <span v-if="we.group_label" class="rounded bg-brand-700 px-1.5 text-xs text-white">{{ we.group_label }}{{ workout.workout_exercises.slice(0, i).filter((x) => x.group_label === we.group_label).length + 1 }}</span>
              {{ ex.byId(we.exercise_id)?.name_pl ?? '…' }}
              <Icon v-if="hasWarning(we)" name="alert" class="size-4 shrink-0 text-amber-500" />
            </p>
            <p class="truncate text-xs text-stone-500">
              {{ doseLine(we) || 'ustaw serie i powtórzenia' }}
              <span v-if="we.progression" class="text-brand-700 dark:text-brand-500"> · {{ describeProgression(we.progression) }}</span>
            </p>
          </button>
        </div>
      </li>
    </ul>

    <p v-if="error" class="mt-1 text-sm text-red-600">{{ error }}</p>
    <button class="mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-stone-300 py-2 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-400" @click="picking = true">
      <Icon name="plus" class="size-4" />Ćwiczenie
    </button>

    <ExercisePicker v-if="picking" title="Dodaj ćwiczenie" :limitations="limitations" @pick="add" @close="picking = false" />
    <ExerciseSheet v-if="editing" :item="editing" :limitations="limitations" @close="editingId = null" />
  </section>
</template>
