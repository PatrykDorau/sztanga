<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useExercisesStore } from '@/stores/exercises'
import { useProgramsStore } from '@/stores/programs'
import { useSortable } from '@/lib/sortable'
import { PHASES, PHASE_COLORS, STATUSES, label } from '@/lib/vocab'
import type { ProgramStatus } from '@/types'
import AssignProgramDialog from '@/components/AssignProgramDialog.vue'
import WorkoutCard from '@/components/WorkoutCard.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const programs = useProgramsStore()
const clients = useClientsStore()
const ex = useExercisesStore()

const loading = ref(true)
const error = ref('')
const weekIdx = ref(0)
const showSettings = ref(false)
const assigning = ref(false)
const busy = ref(false)

const p = computed(() => (programs.current?.id === props.id ? programs.current : null))
const client = computed(() => clients.byId(p.value?.client_id))
const limitations = computed(() => client.value?.limitations ?? [])
const week = computed(() => p.value?.program_weeks[weekIdx.value] ?? null)

const form = ref({ name: '', description: '', start_date: '', status: 'draft' as ProgramStatus })
watch(p, (v) => v && (form.value = { name: v.name, description: v.description ?? '', start_date: v.start_date ?? '', status: v.status }), { immediate: true })

async function load() {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([programs.open(props.id), clients.load(), ex.load()])
    weekIdx.value = 0
    showSettings.value = false
    assigning.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.id, load)

// Kolejność dni w tygodniu – przeciąganie za uchwyt nagłówka treningu.
const daysEl = ref<HTMLElement | null>(null)
useSortable(daysEl, {
  handle: '[data-day-handle]',
  onMove: (id, _f, _t, i) => {
    const ids = week.value!.workouts.map((w) => w.id).filter((x) => x !== id)
    ids.splice(i, 0, id)
    programs.reorderWorkouts(week.value!.id, ids).catch((e) => (error.value = e.message))
  },
})

/** Data poniedziałku danego tygodnia planu. */
function weekDate(i: number) {
  if (!p.value?.start_date) return ''
  const d = new Date(p.value.start_date)
  d.setDate(d.getDate() + i * 7)
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })
}

async function act(fn: () => Promise<unknown>) {
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

const saveSettings = () =>
  act(async () => {
    await programs.update(props.id, {
      name: form.value.name.trim() || p.value!.name,
      description: form.value.description.trim() || null,
      start_date: form.value.start_date || null,
      status: form.value.status,
    })
    showSettings.value = false
  })

const setPhase = (phase: string | null) => act(() => programs.updateWeek(week.value!.id, { phase: week.value!.phase === phase ? null : phase }))

const addWeek = () =>
  act(async () => {
    await programs.addWeek(week.value?.phase ?? null)
    weekIdx.value = p.value!.program_weeks.length - 1
  })

const duplicateWeek = (progress: boolean) =>
  act(async () => {
    await programs.duplicateWeek(week.value!.id, progress)
    weekIdx.value = p.value!.program_weeks.length - 1
  })

const removeWeek = () =>
  act(async () => {
    if (p.value!.program_weeks.length === 1) return alert('Program musi mieć co najmniej jeden tydzień.')
    if (!confirm(`Usunąć tydzień ${weekIdx.value + 1} ze wszystkimi treningami?`)) return
    await programs.removeWeek(week.value!.id)
    weekIdx.value = Math.max(0, weekIdx.value - 1)
  })

const saveAsTemplate = () =>
  act(async () => {
    const name = prompt('Nazwa szablonu', p.value!.name.replace(/\s*–\s*.*$/, ''))
    if (!name) return
    const id = await programs.copy(props.id, { asTemplate: true, name })
    router.push(`/plany/${id}`)
  })

const duplicate = () =>
  act(async () => {
    const id = await programs.copy(props.id, { clientId: p.value!.client_id, asTemplate: p.value!.is_template, name: `${p.value!.name} (kopia)` })
    router.push(`/plany/${id}`)
  })

const removeProgram = () =>
  act(async () => {
    if (!confirm(`Usunąć „${p.value!.name}”? Tego nie da się cofnąć.`)) return
    const back = p.value!.client_id ? `/klienci/${p.value!.client_id}` : '/plany'
    await programs.remove(props.id)
    router.replace(back)
  })
</script>

<template>
  <main v-if="p" class="pb-6">
    <header class="sticky top-0 z-10 bg-stone-50/95 px-2 pt-4 pb-2 backdrop-blur dark:bg-stone-950/95">
      <div class="flex items-center gap-1">
        <button class="p-2" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-lg leading-tight font-bold">{{ p.name }}</h1>
          <p class="truncate text-xs text-stone-500">
            <template v-if="p.is_template">Szablon · {{ p.program_weeks.length }} tyg.</template>
            <template v-else>
              <RouterLink v-if="client" :to="`/klienci/${client.id}`" class="underline">{{ client.full_name }}</RouterLink>
              · {{ label(STATUSES, p.status) }}
              <template v-if="p.start_date"> · od {{ new Date(p.start_date).toLocaleDateString('pl-PL') }}</template>
            </template>
          </p>
        </div>
        <RouterLink :to="`/plany/${p.id}/druk`" class="p-2" aria-label="Wersja do druku"><Icon name="download" class="size-5" /></RouterLink>
        <button class="p-2" aria-label="Ustawienia planu" @click="showSettings = !showSettings"><Icon name="edit" class="size-5" /></button>
      </div>

      <nav class="mt-2 flex gap-1.5 overflow-x-auto px-2 pb-1 [scrollbar-width:none]" aria-label="Tygodnie">
        <button
          v-for="(w, i) in p.program_weeks"
          :key="w.id"
          class="flex min-w-14 shrink-0 flex-col items-center rounded-xl border px-2 py-1.5 text-xs"
          :class="i === weekIdx ? 'border-brand-700 bg-brand-700 text-white' : 'border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900'"
          @click="weekIdx = i"
        >
          <span class="font-semibold">Tydz. {{ i + 1 }}</span>
          <span class="opacity-75">{{ w.phase ? label(PHASES, w.phase) : weekDate(i) || '—' }}</span>
        </button>
        <button class="flex min-w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-stone-300 text-stone-500 dark:border-stone-700" aria-label="Dodaj tydzień" :disabled="busy" @click="addWeek">
          <Icon name="plus" class="size-5" />
        </button>
      </nav>
    </header>

    <div class="space-y-4 px-4">
      <form v-if="showSettings" class="card space-y-3 p-4" @submit.prevent="saveSettings">
        <div>
          <label class="label" for="pn">Nazwa</label>
          <input id="pn" v-model="form.name" class="input" />
        </div>
        <div>
          <label class="label" for="pd">Opis</label>
          <textarea id="pd" v-model="form.description" rows="2" class="input py-2" />
        </div>
        <div v-if="!p.is_template" class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="ps">Start</label>
            <input id="ps" v-model="form.start_date" type="date" class="input" />
          </div>
          <div>
            <label class="label" for="st">Status</label>
            <select id="st" v-model="form.status" class="input">
              <option v-for="(l, k) in STATUSES" :key="k" :value="k">{{ l }}</option>
            </select>
          </div>
        </div>
        <button class="btn-primary w-full" :disabled="busy">Zapisz</button>
        <div class="grid grid-cols-2 gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
          <button v-if="p.is_template" type="button" class="btn-ghost" @click="assigning = true">Przypisz klientowi</button>
          <button v-else type="button" class="btn-ghost" :disabled="busy" @click="saveAsTemplate">Zapisz jako szablon</button>
          <button type="button" class="btn-ghost" :disabled="busy" @click="duplicate">Duplikuj</button>
          <button type="button" class="btn-danger col-span-2" :disabled="busy" @click="removeProgram"><Icon name="trash" class="size-4" />Usuń plan</button>
        </div>
      </form>

      <div v-if="p.description && !showSettings" class="text-sm text-stone-600 dark:text-stone-400">{{ p.description }}</div>

      <template v-if="week">
        <div>
          <p class="label">Faza tygodnia {{ weekIdx + 1 }}</p>
          <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            <button
              v-for="(l, k) in PHASES"
              :key="k"
              class="chip"
              :class="week.phase === k ? PHASE_COLORS[k] + ' border-transparent font-semibold' : 'chip-off'"
              :disabled="busy"
              @click="setPhase(String(k))"
            >
              {{ l }}
            </button>
          </div>
        </div>

        <div ref="daysEl" :key="week.id" class="space-y-3">
          <WorkoutCard v-for="wo in week.workouts" :key="wo.id" :workout="wo" :limitations="limitations" />
        </div>

        <button class="btn-ghost w-full" :disabled="busy" @click="act(() => programs.addWorkout(week!.id))"><Icon name="plus" class="size-4" />Dodaj trening</button>

        <section class="card space-y-2 p-4">
          <p class="text-sm font-semibold">Kolejny tydzień</p>
          <button class="btn-primary w-full" :disabled="busy" @click="duplicateWeek(true)"><Icon name="up" class="size-4" />Kopiuj z progresją</button>
          <p class="text-xs text-stone-500">Ćwiczenia z regułą progresji dostaną wyższy ciężar lub więcej powtórzeń – sprawdź i popraw przed udostępnieniem.</p>
          <div class="grid grid-cols-2 gap-2 pt-1">
            <button class="btn-ghost" :disabled="busy" @click="duplicateWeek(false)">Kopiuj bez zmian</button>
            <button class="btn-danger" :disabled="busy" @click="removeWeek"><Icon name="trash" class="size-4" />Usuń tydzień</button>
          </div>
        </section>
      </template>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </div>

    <AssignProgramDialog v-if="assigning" :template-id="p.id" @close="assigning = false" @done="(id) => ((assigning = false), router.push(`/plany/${id}`))" />
  </main>
  <main v-else class="px-4 pt-10 text-center text-stone-500">{{ loading ? 'Ładowanie…' : error || 'Nie znaleziono planu.' }}</main>
</template>
