<script setup lang="ts">
// Import treningu: wklej tekst, dodaj zrzut ekranu / zdjęcie albo podyktuj – Claude przepisuje trening,
// aplikacja dopasowuje ćwiczenia do bazy (najpierw Twoje etykiety), a Ty poprawiasz i zapisujesz.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useExercisesStore } from '@/stores/exercises'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { matchExercise, parseWorkout, shrinkImage, speechSupported, startDictation, type ParsedPlan } from '@/lib/importWorkout'
import { savePlanDraft, type PlanDraft } from '@/lib/planRules'
import { loadCredits, lowCredits, remaining, usd } from '@/lib/credits'
import ExercisePicker from '@/components/ExercisePicker.vue'
import ExerciseThumb from '@/components/ExerciseThumb.vue'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const ex = useExercisesStore()
const clients = useClientsStore()
const programs = useProgramsStore()
onMounted(() => Promise.all([ex.load(), clients.load(), loadCredits()]).catch(() => null))

// ----- Wejście -----
const text = ref('')
const image = ref<{ media_type: string; data: string } | null>(null)
const preview = ref<string | null>(null)
const error = ref('')
async function setImage(file: Blob | null | undefined) {
  if (!file) return
  error.value = ''
  try {
    image.value = await shrinkImage(file)
    preview.value = `data:${image.value.media_type};base64,${image.value.data}`
  } catch {
    error.value = 'Nie udało się wczytać obrazu.'
  }
}
// Wklejanie zrzutu ekranu (Ctrl+V / „Wklej” na telefonie) prosto na stronę
function onPaste(e: ClipboardEvent) {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
  if (item) {
    e.preventDefault()
    setImage(item.getAsFile())
  }
}
onMounted(() => window.addEventListener('paste', onPaste))
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  stopRec?.()
})

// ----- Dyktowanie -----
const canDictate = speechSupported()
const listening = ref(false)
const interim = ref('')
let stopRec: (() => void) | null = null
function toggleDictation() {
  if (listening.value) {
    stopRec?.()
    return
  }
  error.value = ''
  try {
    stopRec = startDictation(
      (fin, int) => {
        if (fin) text.value = (text.value ? text.value.trimEnd() + ' ' : '') + fin.trim()
        interim.value = int
      },
      (err) => {
        listening.value = false
        interim.value = ''
        if (err) error.value = err
      },
    )
    listening.value = true
  } catch (e) {
    error.value = (e as Error).message
  }
}

// ----- Rozpoznanie -----
const busy = ref(false)
const plan = ref<ParsedPlan | null>(null)
interface Row {
  key: string
  w: number
  name: string
  section: string | null
  group: string | null
  sets: number | null
  reps: string
  load: string
  tempo: string | null
  rest_sec: number | null
  notes: string | null
  exerciseId: string | null
  createNew: boolean
}
const rows = ref<Row[]>([])
const workoutNames = ref<string[]>([])
async function recognize() {
  if (!text.value.trim() && !image.value) return void (error.value = 'Wklej tekst, dodaj zdjęcie albo podyktuj trening.')
  busy.value = true
  error.value = ''
  try {
    const p = await parseWorkout({ text: text.value, image: image.value ?? undefined })
    plan.value = p
    form.name = p.name
    workoutNames.value = p.workouts.map((w) => w.name)
    rows.value = p.workouts.flatMap((w, wi) =>
      w.exercises.map((e, i) => {
        const m = matchExercise(e.name, ex.all, ex.favorites)
        return { key: `${wi}-${i}`, w: wi, ...e, reps: e.reps ?? '', load: e.load ?? '', exerciseId: m?.id ?? null, createNew: false }
      }),
    )
    loadCredits().catch(() => null)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
const unmatched = computed(() => rows.value.filter((r) => !r.exerciseId && !r.createNew).length)

// ----- Podmiana ćwiczenia -----
const picking = ref<Row | null>(null)
function onPick(id: string) {
  if (picking.value) Object.assign(picking.value, { exerciseId: id, createNew: false })
  picking.value = null
}

// ----- Zapis -----
const form = reactive({ name: '', client: '', kind: 'auto' as 'auto' | 'single' | 'plan' })
const kind = computed(() => (form.kind === 'auto' ? (workoutNames.value.length > 1 ? 'plan' : 'single') : form.kind))
async function save() {
  if (unmatched.value) return void (error.value = `Dopasuj ${unmatched.value} ćwiczeń (Wybierz z bazy albo „Dodaj jako nowe”).`)
  busy.value = true
  error.value = ''
  try {
    // Nowe ćwiczenia – jako własne, z nazwą z treningu
    for (const r of rows.value.filter((x) => x.createNew && !x.exerciseId)) {
      const e = await ex.save({ name_pl: r.name, name_en: null, muscle_groups: [], equipment: [], movement_pattern: null, level: 'beginner', contraindications: [], cues: null, video_path: null, image_url: null, primary_muscles: [], secondary_muscles: [], description: null, tags: [] })
      r.exerciseId = e.id
    }
    const draft: PlanDraft = {
      name: form.name.trim() || 'Zaimportowany trening',
      description: 'Zaimportowany z tekstu, zdjęcia albo dyktowania – sprawdź dawki.',
      weeks: [
        {
          phase: null,
          notes: null,
          workouts: workoutNames.value.map((wn, wi) => ({
            name: kind.value === 'single' && workoutNames.value.length === 1 ? form.name.trim() || wn : wn,
            notes: null,
            exercises: rows.value
              .filter((r) => r.w === wi)
              .map((r) => ({
                exercise_id: r.exerciseId!,
                group: r.group,
                sets: r.sets ?? 3,
                reps: r.reps || '10',
                load: r.load || null,
                tempo: r.tempo,
                rest_sec: r.rest_sec,
                rpe: null,
                notes: [r.section, r.notes].filter(Boolean).join(' – ') || null,
              })),
          })),
        },
      ],
    }
    const id = await savePlanDraft(draft, form.client || null, kind.value)
    await programs.loadList(true).catch(() => null)
    router.replace(`/plany/${id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="pb-10">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-bold">Import treningu</h1>
        <p class="truncate text-sm text-muted">Tekst, zrzut ekranu albo dyktowanie → trening w aplikacji</p>
      </div>
    </header>

    <div class="space-y-4 px-4">
      <RouterLink v-if="lowCredits" to="/profil" class="warn-box block text-sm">Kończą się kredyty Anthropic – zostało ok. {{ usd(remaining) }}. Import korzysta z AI.</RouterLink>

      <template v-if="!plan">
        <section class="card space-y-3 p-4">
          <label class="block">
            <span class="label">Tekst treningu</span>
            <textarea v-model="text" rows="7" class="input py-2 text-sm" placeholder="np.&#10;Rozgrzewka: ergometr 5 min, wspięcia 12x str&#10;6a Martwy ciąg jednonóż 3x8 42,5 kg&#10;6b Podciąganie na TRX 3x12&#10;…" />
          </label>
          <p v-if="listening" class="flex items-center gap-2 text-sm text-primary-fg" role="status"><span class="size-2 animate-pulse rounded-full bg-danger" />Słucham… {{ interim }}</p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn-ghost border border-line-strong" :class="listening ? '!border-danger text-danger' : ''" :disabled="!canDictate" @click="toggleDictation">
              <Icon name="mic" class="size-5" />{{ listening ? 'Zakończ' : 'Dyktuj' }}
            </button>
            <label class="btn-ghost cursor-pointer border border-line-strong">
              <Icon name="video" class="size-5" />Zdjęcie / zrzut
              <input type="file" accept="image/*" class="sr-only" @change="setImage(($event.target as HTMLInputElement).files?.[0])" />
            </label>
          </div>
          <p v-if="!canDictate" class="text-xs text-muted">Dyktowanie działa w Chrome i Safari (tu przeglądarka go nie obsługuje).</p>
          <p class="text-xs text-muted">Zrzut ekranu możesz też wkleić (Ctrl+V). Mów np.: „przysiad ze sztangą cztery serie po osiem, potem wiosłowanie trzy na dziesięć”.</p>
          <div v-if="preview" class="relative">
            <img :src="preview" alt="Dodany obraz treningu" class="max-h-64 w-full rounded-xl object-contain bg-surface-2" />
            <button type="button" class="icon-btn absolute top-1 right-1 bg-black/50 text-white" aria-label="Usuń obraz" @click="(image = null), (preview = null)"><Icon name="x" class="size-4" /></button>
          </div>
        </section>
        <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy || (!text.trim() && !image)" @click="recognize">
          <Icon name="star" class="size-5" />{{ busy ? 'Claude czyta trening…' : 'Rozpoznaj trening' }}
        </button>
        <p class="text-xs text-muted">Rozpoznanie robi Claude (koszt z Twojego klucza, zwykle 1–3 centy). Nic się nie zapisze, dopóki nie zatwierdzisz.</p>
      </template>

      <template v-else>
        <div v-if="plan.warnings.length" class="warn-box text-sm">
          <Icon name="alert" class="size-5 shrink-0" />
          <ul class="list-disc pl-4"><li v-for="w in plan.warnings" :key="w">{{ w }}</li></ul>
        </div>

        <section v-for="(_, wi) in workoutNames" :key="wi" class="card space-y-2 p-4">
          <input v-model="workoutNames[wi]" class="input !min-h-10 font-semibold" :aria-label="`Nazwa treningu ${wi + 1}`" />
          <template v-for="(r, i) in rows.filter((x) => x.w === wi)" :key="r.key">
            <p v-if="r.section && r.section !== rows.filter((x) => x.w === wi)[i - 1]?.section" class="pt-2 text-xs font-semibold tracking-wide text-muted uppercase">{{ r.section }}</p>
            <div class="space-y-1.5 rounded-xl border p-2" :class="!r.exerciseId && !r.createNew ? 'border-warn-line bg-warn-soft/40' : 'border-line'">
              <p class="text-xs text-muted">
                <span v-if="r.group" class="mr-1 rounded bg-primary-soft px-1 font-bold text-primary-fg">{{ r.group }}</span>„{{ r.name }}”
              </p>
              <div v-if="r.exerciseId && ex.byId(r.exerciseId)" class="flex items-center gap-2">
                <ExerciseThumb :exercise="ex.byId(r.exerciseId)!" class="!size-10" />
                <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ ex.byId(r.exerciseId)!.name_pl }}</span>
                <button class="btn-ghost !min-h-8 shrink-0 px-2 text-xs" @click="picking = r">Zmień</button>
              </div>
              <div v-else-if="r.createNew" class="flex items-center gap-2 text-sm">
                <Icon name="plus" class="size-4 text-primary-fg" /><span class="min-w-0 flex-1">Nowe ćwiczenie: <strong>{{ r.name }}</strong></span>
                <button class="btn-ghost !min-h-8 shrink-0 px-2 text-xs" @click="r.createNew = false">Cofnij</button>
              </div>
              <div v-else class="flex flex-wrap items-center gap-2 text-sm">
                <span class="text-warn-fg">Nie znaleziono w bazie.</span>
                <button class="btn-ghost !min-h-8 border border-line-strong px-2 text-xs" @click="picking = r">Wybierz z bazy</button>
                <button class="btn-ghost !min-h-8 border border-line-strong px-2 text-xs" @click="r.createNew = true">Dodaj jako nowe</button>
              </div>
              <div class="grid grid-cols-3 gap-1.5">
                <label class="block"><span class="text-[11px] text-muted">Serie</span><input v-model.number="r.sets" type="number" min="1" class="input !min-h-9 text-center text-sm" /></label>
                <label class="block"><span class="text-[11px] text-muted">Powt.</span><input v-model="r.reps" class="input !min-h-9 text-center text-sm" /></label>
                <label class="block"><span class="text-[11px] text-muted">Ciężar</span><input v-model="r.load" class="input !min-h-9 text-center text-sm" /></label>
              </div>
              <p v-if="r.tempo || r.rest_sec || r.notes" class="text-xs text-muted">{{ [r.tempo ? `tempo ${r.tempo}` : null, r.rest_sec ? `przerwa ${r.rest_sec} s` : null, r.notes].filter(Boolean).join(' · ') }}</p>
            </div>
          </template>
        </section>

        <section class="card space-y-3 p-4">
          <label class="block"><span class="label">Nazwa</span><input v-model="form.name" class="input" /></label>
          <label class="block"><span class="label">Dla kogo</span>
            <select v-model="form.client" class="input">
              <option value="">Szablon / gotowiec</option>
              <option v-for="c in clients.all.filter((x) => !x.archived)" :key="c.id" :value="c.id">{{ c.full_name }}</option>
            </select>
          </label>
          <div class="flex rounded-xl bg-surface-2 p-1" role="group" aria-label="Zapisz jako">
            <button type="button" class="min-h-10 flex-1 rounded-lg text-sm font-semibold" :class="kind === 'single' ? 'bg-surface shadow' : 'text-muted'" @click="form.kind = 'single'">Pojedynczy trening</button>
            <button type="button" class="min-h-10 flex-1 rounded-lg text-sm font-semibold" :class="kind === 'plan' ? 'bg-surface shadow' : 'text-muted'" @click="form.kind = 'plan'">Plan</button>
          </div>
          <p v-if="unmatched" class="text-sm text-warn-fg">Do dopasowania: {{ unmatched }} {{ unmatched === 1 ? 'ćwiczenie' : 'ćwiczeń' }}.</p>
          <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn-ghost border border-line-strong" :disabled="busy" @click="plan = null">Wróć</button>
            <button class="btn-primary" :disabled="busy || !!unmatched" @click="save">{{ busy ? 'Zapisywanie…' : 'Zapisz i otwórz' }}</button>
          </div>
        </section>
      </template>
    </div>

    <ExercisePicker v-if="picking" :title="`Wybierz ćwiczenie dla „${picking.name}”`" @pick="onPick" @close="picking = null" />
  </main>
</template>
