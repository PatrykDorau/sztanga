<script setup lang="ts">
// Edycja jednego ćwiczenia w treningu: dawka, superseria, progresja, szybka podmiana na regresję/progresję.
import { computed, reactive, ref, watch } from 'vue'
import { useExercisesStore } from '@/stores/exercises'
import { useProgramsStore } from '@/stores/programs'
import { CONTRAINDICATIONS, label } from '@/lib/vocab'
import { applyProgression } from '@/lib/progression'
import type { WorkoutExercise } from '@/types'
import Icon from './Icon.vue'

const props = defineProps<{ item: WorkoutExercise; limitations: string[] }>()
const emit = defineEmits<{ close: [] }>()
const ex = useExercisesStore()
const programs = useProgramsStore()

const f = reactive({
  sets: '' as string | number,
  reps: '',
  load: '',
  tempo: '',
  rest_sec: '' as string | number,
  rpe: '' as string | number,
  group_label: '',
  notes: '',
  prog_kind: '' as '' | 'load' | 'reps',
  prog_step: '' as string | number,
})
watch(
  () => props.item,
  (it) =>
    Object.assign(f, {
      sets: it.sets ?? '',
      reps: it.reps ?? '',
      load: it.load ?? '',
      tempo: it.tempo ?? '',
      rest_sec: it.rest_sec ?? '',
      rpe: it.rpe ?? '',
      group_label: it.group_label ?? '',
      notes: it.notes ?? '',
      prog_kind: it.progression?.kind ?? '',
      prog_step: it.progression?.step ?? '',
    }),
  { immediate: true },
)

const exercise = computed(() => ex.byId(props.item.exercise_id))
const warnings = computed(() => (exercise.value?.contraindications ?? []).filter((c) => props.limitations.includes(c)))
const regressions = computed(() => ex.regressionsOf(props.item.exercise_id))
const progressions = computed(() => ex.progressionsOf(props.item.exercise_id))
const alternatives = computed(() => ex.alternativesOf(props.item.exercise_id))
const busy = ref(false)
const error = ref('')

const toNum = (v: string | number) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))
const toText = (v: string) => v.trim() || null

const preview = computed(() => {
  const step = toNum(f.prog_step)
  if (!f.prog_kind || !step) return ''
  const next = applyProgression({ load: toText(f.load), reps: toText(f.reps), progression: { kind: f.prog_kind, step } })
  return f.prog_kind === 'load' ? `następny tydzień: ${next.load ?? '—'}` : `następny tydzień: ${next.reps ?? '—'}`
})

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

const save = () =>
  run(async () => {
    const step = toNum(f.prog_step)
    await programs.updateExercise(props.item.id, {
      sets: toNum(f.sets),
      reps: toText(f.reps),
      load: toText(f.load),
      tempo: toText(f.tempo),
      rest_sec: toNum(f.rest_sec),
      rpe: toNum(f.rpe),
      group_label: toText(f.group_label)?.toUpperCase() ?? null,
      notes: toText(f.notes),
      progression: f.prog_kind && step ? { kind: f.prog_kind, step } : null,
    })
    emit('close')
  })

const swap = (exerciseId: string) => run(() => programs.updateExercise(props.item.id, { exercise_id: exerciseId }))

// Alternatywa dla przeciągania (dostępność i praca jedną ręką): przesunięcie o jedno miejsce.
const siblings = computed(() => {
  for (const w of programs.current?.program_weeks ?? []) {
    const wo = w.workouts.find((x) => x.id === props.item.workout_id)
    if (wo) return wo.workout_exercises
  }
  return []
})
const index = computed(() => siblings.value.findIndex((x) => x.id === props.item.id))
const move = (delta: number) =>
  run(() => programs.moveExercise(props.item.id, props.item.workout_id, props.item.workout_id, index.value + delta))
const remove = () =>
  run(async () => {
    await programs.removeExercise(props.item.id, props.item.workout_id)
    emit('close')
  })
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form
      class="sheet space-y-4"
      @submit.prevent="save"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h2 class="text-lg leading-tight font-semibold">{{ exercise?.name_pl }}</h2>
          <RouterLink :to="`/cwiczenia/${item.exercise_id}`" class="text-xs text-muted underline">karta ćwiczenia</RouterLink>
        </div>
        <button type="button" class="icon-btn -m-2" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      </div>

      <div v-if="warnings.length" class="flex gap-2 warn-box">
        <Icon name="alert" class="size-5 shrink-0" />
        <p>Przeciwwskazanie zgodne z ograniczeniem klienta: <strong>{{ warnings.map((w) => label(CONTRAINDICATIONS, w)).join(', ') }}</strong>.</p>
      </div>

      <div v-if="regressions.length || progressions.length || alternatives.length" class="space-y-1">
        <p class="label">Podmień jednym kliknięciem</p>
        <div class="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          <button v-for="id in regressions" :key="'r' + id" type="button" class="chip-off" :disabled="busy" @click="swap(id)">
            <Icon name="down" class="mr-1 size-4 text-sky-600" />{{ ex.byId(id)?.name_pl }}
          </button>
          <button v-for="id in progressions" :key="'p' + id" type="button" class="chip-off" :disabled="busy" @click="swap(id)">
            <Icon name="up" class="mr-1 size-4 text-rose-600" />{{ ex.byId(id)?.name_pl }}
          </button>
          <button v-for="id in alternatives" :key="'a' + id" type="button" class="chip-off" :disabled="busy" @click="swap(id)">
            <Icon name="swap" class="mr-1 size-4" />{{ ex.byId(id)?.name_pl }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="label" for="sets">Serie</label>
          <input id="sets" v-model="f.sets" inputmode="numeric" class="input" />
        </div>
        <div>
          <label class="label" for="reps">Powtórzenia</label>
          <input id="reps" v-model="f.reps" class="input" placeholder="8-10" />
        </div>
        <div>
          <label class="label" for="load">Ciężar</label>
          <input id="load" v-model="f.load" class="input" placeholder="20 kg" />
        </div>
        <div>
          <label class="label" for="rpe">RPE</label>
          <input id="rpe" v-model="f.rpe" inputmode="decimal" class="input" placeholder="8" />
        </div>
        <div>
          <label class="label" for="rest">Przerwa (s)</label>
          <input id="rest" v-model="f.rest_sec" inputmode="numeric" class="input" placeholder="90" />
        </div>
        <div>
          <label class="label" for="tempo">Tempo</label>
          <input id="tempo" v-model="f.tempo" class="input" placeholder="3-1-1-0" />
        </div>
      </div>

      <div>
        <label class="label" for="grp">Superseria / obwód</label>
        <div class="flex gap-2">
          <button v-for="g in ['', 'A', 'B', 'C', 'D']" :key="g" type="button" :class="f.group_label === g ? 'chip-on' : 'chip-off'" @click="f.group_label = g">
            {{ g || 'brak' }}
          </button>
        </div>
        <p class="mt-1 text-xs text-muted">Sąsiednie ćwiczenia z tą samą literą wykonuje się naprzemiennie.</p>
      </div>

      <div>
        <p class="label">Automatyczna progresja (podpowiedź przy kopiowaniu tygodnia)</p>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" :class="!f.prog_kind ? 'chip-on' : 'chip-off'" @click="f.prog_kind = ''">brak</button>
          <button type="button" :class="f.prog_kind === 'load' ? 'chip-on' : 'chip-off'" @click="(f.prog_kind = 'load'), f.prog_step || (f.prog_step = 2.5)">+ kg</button>
          <button type="button" :class="f.prog_kind === 'reps' ? 'chip-on' : 'chip-off'" @click="(f.prog_kind = 'reps'), (f.prog_step = 1)">+ powt.</button>
          <input v-if="f.prog_kind" v-model="f.prog_step" inputmode="decimal" class="input !w-20" aria-label="Krok progresji" />
        </div>
        <p v-if="preview" class="mt-1 text-xs text-muted">{{ preview }}</p>
      </div>

      <div>
        <label class="label" for="notes">Uwagi dla klienta</label>
        <textarea id="notes" v-model="f.notes" rows="2" class="input py-2" />
      </div>

      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <div class="flex gap-2">
        <button type="button" class="btn-danger" :disabled="busy" aria-label="Usuń z treningu" @click="remove"><Icon name="trash" class="size-4" /></button>
        <button type="button" class="btn-ghost !px-3" :disabled="busy || index <= 0" aria-label="Przesuń wyżej" @click="move(-1)"><Icon name="up" class="size-4" /></button>
        <button type="button" class="btn-ghost !px-3" :disabled="busy || index >= siblings.length - 1" aria-label="Przesuń niżej" @click="move(1)"><Icon name="down" class="size-4" /></button>
        <button class="btn-primary flex-1" :disabled="busy">Zapisz</button>
      </div>
    </form>
  </div>
</template>
