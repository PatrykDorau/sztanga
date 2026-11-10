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

// Kolejność dni bez przeciągania (alternatywa dla gestu).
const week = computed(() => programs.current?.program_weeks.find((w) => w.id === props.workout.week_id))
const dayIndex = computed(() => week.value?.workouts.findIndex((w) => w.id === props.workout.id) ?? -1)
async function moveDay(delta: number) {
  const ids = week.value!.workouts.map((w) => w.id)
  const [id] = ids.splice(dayIndex.value, 1)
  ids.splice(dayIndex.value + delta, 0, id)
  await programs.reorderWorkouts(week.value!.id, ids).catch((e) => (error.value = e.message))
}

async function remove() {
  if (confirm(`Usunąć „${props.workout.name}” z tego tygodnia?`)) await programs.removeWorkout(props.workout.id)
}
</script>

<template>
  <section class="card p-3" :data-id="workout.id">
    <header class="mb-2 flex items-center gap-1">
      <span data-day-handle class="flex h-11 w-7 cursor-grab touch-none items-center justify-center text-subtle" title="Przeciągnij, by zmienić kolejność dni">
        <Icon name="grip" class="size-5" />
      </span>
      <input v-if="renaming" v-model="name" class="input flex-1" aria-label="Nazwa treningu" v-focus @blur="saveName" @keydown.enter.prevent="saveName" />
      <button v-else class="min-h-11 flex-1 text-left font-display text-xl font-bold" @click="renaming = true">{{ workout.name }}</button>
      <button v-if="dayIndex > 0" class="icon-btn text-subtle" aria-label="Przesuń trening wyżej" @click="moveDay(-1)"><Icon name="up" class="size-4" /></button>
      <button v-if="week && dayIndex < week.workouts.length - 1" class="icon-btn text-subtle" aria-label="Przesuń trening niżej" @click="moveDay(1)"><Icon name="down" class="size-4" /></button>
      <button class="icon-btn text-subtle hover:text-danger" aria-label="Usuń trening" @click="remove"><Icon name="trash" class="size-4" /></button>
    </header>

    <!-- Pusty trening musi mieć wyraźną strefę upuszczania, inaczej nie da się do niego przeciągnąć ćwiczenia. -->
    <ul
      ref="listEl"
      :data-list="workout.id"
      class="space-y-1"
      :class="workout.workout_exercises.length ? 'min-h-2' : 'flex min-h-14 items-center justify-center rounded-xl border border-dashed border-line text-xs text-muted before:content-[attr(data-hint)]'"
      data-hint="Pusty – dodaj lub przeciągnij tu ćwiczenie"
    >
      <li v-for="(we, i) in workout.workout_exercises" :key="we.id" :data-id="we.id">
        <div
          class="flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-2"
          :class="[groupEdge(i), we.group_label ? 'border-l-4 !border-l-primary' : '']"
        >
          <span data-handle class="flex h-11 w-7 shrink-0 cursor-grab touch-none items-center justify-center text-subtle" title="Przeciągnij, by zmienić kolejność">
            <Icon name="grip" class="size-5" />
          </span>
          <button class="min-w-0 flex-1 text-left" @click="editingId = we.id">
            <p class="flex items-center gap-1.5 truncate text-sm font-medium">
              <span v-if="we.group_label" class="rounded bg-primary px-1.5 text-xs font-semibold text-on-primary">{{ we.group_label }}{{ workout.workout_exercises.slice(0, i).filter((x) => x.group_label === we.group_label).length + 1 }}</span>
              {{ ex.byId(we.exercise_id)?.name_pl ?? '…' }}
              <Icon v-if="hasWarning(we)" name="alert" class="size-4 shrink-0 text-warn-fg" />
            </p>
            <p class="truncate text-xs text-muted">
              {{ doseLine(we) || 'ustaw serie i powtórzenia' }}
              <span v-if="we.progression" class="text-primary-fg"> · {{ describeProgression(we.progression) }}</span>
            </p>
          </button>
        </div>
      </li>
    </ul>

    <p v-if="error" class="mt-1 text-sm text-danger">{{ error }}</p>
    <button class="mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong py-2 text-sm text-muted" @click="picking = true">
      <Icon name="plus" class="size-4" />Ćwiczenie
    </button>

    <ExercisePicker v-if="picking" title="Dodaj ćwiczenie" :limitations="limitations" @pick="add" @close="picking = false" />
    <ExerciseSheet v-if="editing" :item="editing" :limitations="limitations" @close="editingId = null" />
  </section>
</template>
