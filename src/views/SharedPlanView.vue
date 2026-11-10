<script setup lang="ts">
// Plan klienta pod linkiem (bez konta): tydzień po tygodniu, ćwiczenia z filmikami i wskazówkami,
// podsumowania sesji zatwierdzone przez trenerkę, wydruk / PDF.
import { computed, onMounted, ref } from 'vue'
import { MEDIA_BUCKET, supabase } from '@/lib/supabase'
import { PHASES, label } from '@/lib/vocab'
import Icon from '@/components/Icon.vue'

interface SharedExercise {
  exercise_id: string
  group_label: string | null
  sets: number | null
  reps: string | null
  load: string | null
  tempo: string | null
  rest_sec: number | null
  rpe: number | null
  notes: string | null
}
interface SharedPlan {
  program: { id: string; name: string; description: string | null; start_date: string | null }
  client_first_name: string | null
  weeks: { position: number; phase: string | null; workouts: { name: string; notes: string | null; exercises: SharedExercise[] }[] }[]
  exercises: Record<string, { name: string; cues: string | null; image_url: string | null; video_path: string | null }>
  summaries: { date: string; summary: string }[]
}

const props = defineProps<{ token: string }>()
const plan = ref<SharedPlan | null>(null)
const state = ref<'loading' | 'ok' | 'missing'>('loading')
const weekIdx = ref(0)
const open = ref<string | null>(null)
const videoUrls = ref<Record<string, string>>({})

onMounted(async () => {
  const { data, error } = await supabase.rpc('get_shared_plan', { share_token: props.token })
  if (error || !data) {
    state.value = 'missing'
    return
  }
  plan.value = data as SharedPlan
  state.value = 'ok'
  // Bieżący tydzień wg daty startu.
  if (plan.value.program.start_date) {
    const w = Math.floor((Date.now() - new Date(plan.value.program.start_date).getTime()) / (7 * 864e5))
    weekIdx.value = Math.max(0, Math.min(plan.value.weeks.length - 1, w))
  }
})

const week = computed(() => plan.value?.weeks[weekIdx.value])
const ex = (id: string) => plan.value?.exercises[id]

async function toggle(key: string, exerciseId: string) {
  open.value = open.value === key ? null : key
  const path = ex(exerciseId)?.video_path
  if (open.value && path && !videoUrls.value[path]) {
    const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600)
    if (data) videoUrls.value[path] = data.signedUrl
  }
}

const dose = (e: SharedExercise) =>
  [e.sets && e.reps ? `${e.sets} × ${e.reps}` : e.reps, e.load, e.rpe ? `RPE ${String(e.rpe).replace('.', ',')}` : null, e.rest_sec ? `przerwa ${e.rest_sec >= 60 ? `${String(e.rest_sec / 60).replace('.', ',')} min` : `${e.rest_sec} s`}` : null]
    .filter(Boolean)
    .join(' · ')
const groupIdx = (list: SharedExercise[], i: number) => list.slice(0, i).filter((x) => x.group_label === list[i].group_label).length + 1
const print = () => window.print()
</script>

<template>
  <main class="mx-auto min-h-dvh max-w-2xl pb-10">
    <p v-if="state === 'loading'" class="p-10 text-center text-muted">Ładowanie planu…</p>
    <div v-else-if="state === 'missing'" class="flex min-h-dvh flex-col items-center justify-center gap-2 p-8 text-center">
      <Icon name="alert" class="size-10 text-warn-fg" />
      <h1 class="page-title">Link nie działa</h1>
      <p class="text-muted">Plan został wycofany albo link jest niepełny. Poproś trenerkę o nowy.</p>
    </div>

    <template v-else-if="plan">
      <header class="px-4 pb-3" style="padding-top: max(1.5rem, env(safe-area-inset-top))">
        <p class="eyebrow">{{ plan.client_first_name ? `Plan dla: ${plan.client_first_name}` : 'Plan treningowy' }}</p>
        <h1 class="page-title mt-1">{{ plan.program.name }}</h1>
        <p v-if="plan.program.description" class="mt-2 text-muted">{{ plan.program.description }}</p>
        <button class="btn-ghost mt-3 print:hidden" @click="print"><Icon name="download" class="size-5" />Pobierz PDF / drukuj</button>
      </header>

      <nav class="sticky top-0 z-10 flex gap-2 overflow-x-auto bg-bg/95 px-4 py-2 backdrop-blur [scrollbar-width:none] print:hidden" aria-label="Tygodnie">
        <button
          v-for="(w, i) in plan.weeks"
          :key="i"
          class="chip shrink-0"
          :class="i === weekIdx ? 'border-primary bg-primary font-semibold text-on-primary' : 'border-line-strong bg-surface'"
          :aria-current="i === weekIdx ? 'true' : undefined"
          @click="weekIdx = i"
        >
          Tydzień {{ i + 1 }}<template v-if="w.phase"> · {{ label(PHASES, w.phase) }}</template>
        </button>
      </nav>

      <div v-if="week" class="space-y-4 px-4 pt-2">
        <section v-for="(wo, wi) in week.workouts" :key="wi" class="card overflow-hidden">
          <h2 class="border-b border-line px-4 py-3 text-xl font-bold">{{ wo.name }}</h2>
          <p v-if="wo.notes" class="px-4 pt-2 text-sm text-muted">{{ wo.notes }}</p>
          <ul class="divide-y divide-line">
            <li v-for="(e, i) in wo.exercises" :key="i">
              <button class="pressable flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2" :aria-expanded="open === `${wi}-${i}`" @click="toggle(`${wi}-${i}`, e.exercise_id)">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-display font-bold" :class="e.group_label ? '!bg-primary text-on-primary' : ''">
                  {{ e.group_label ? `${e.group_label}${groupIdx(wo.exercises, i)}` : i + 1 }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold">{{ ex(e.exercise_id)?.name }}</span>
                  <span class="block text-sm text-muted tabular-nums">{{ dose(e) }}</span>
                </span>
                <Icon v-if="ex(e.exercise_id)?.video_path || ex(e.exercise_id)?.cues" :name="open === `${wi}-${i}` ? 'up' : 'down'" class="size-5 text-subtle" />
              </button>
              <div v-if="open === `${wi}-${i}`" class="space-y-2 px-4 pb-4">
                <video
                  v-if="ex(e.exercise_id)?.video_path && videoUrls[ex(e.exercise_id)!.video_path!]"
                  :src="videoUrls[ex(e.exercise_id)!.video_path!]"
                  controls
                  playsinline
                  muted
                  loop
                  class="aspect-[4/5] w-full rounded-xl bg-black object-contain"
                />
                <img v-else-if="ex(e.exercise_id)?.image_url" :src="ex(e.exercise_id)!.image_url!" alt="" class="w-full rounded-xl bg-white" />
                <p v-if="e.tempo" class="text-sm"><strong>Tempo:</strong> {{ e.tempo }}</p>
                <p v-if="e.notes" class="text-sm"><strong>Uwagi:</strong> {{ e.notes }}</p>
                <p v-if="ex(e.exercise_id)?.cues" class="text-sm whitespace-pre-line text-muted">{{ ex(e.exercise_id)!.cues }}</p>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <section v-if="plan.summaries.length" class="mt-8 space-y-3 px-4 print:hidden">
        <h2 class="text-2xl font-bold">Podsumowania sesji</h2>
        <article v-for="(s, i) in plan.summaries" :key="i" class="card p-4">
          <p class="eyebrow">{{ new Date(s.date).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }) }}</p>
          <p class="mt-1 text-sm whitespace-pre-line">{{ s.summary }}</p>
        </article>
      </section>
    </template>
  </main>
</template>
