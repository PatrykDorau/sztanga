<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useExercisesStore } from '@/stores/exercises'
import { CONTRAINDICATIONS, EQUIPMENT, LEVELS, MUSCLES, PATTERNS } from '@/lib/vocab'
import { compressVideo } from '@/lib/video'
import { MEDIA_BUCKET, supabase } from '@/lib/supabase'
import type { ExerciseInput, ExerciseLevel } from '@/types'
import ChipSelect from '@/components/ChipSelect.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ id?: string }>()
const ex = useExercisesStore()
const router = useRouter()

const form = reactive({
  name_pl: '',
  name_en: '',
  muscle_groups: [] as string[],
  equipment: [] as string[],
  pattern: [] as string[],
  level: ['beginner'] as string[],
  contraindications: [] as string[],
  cues: '',
  video_path: null as string | null,
  image_url: null as string | null,
})

const newVideo = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const removeVideo = ref(false)
const status = ref('')
const progress = ref(0)
const busy = ref(false)
const error = ref('')

const isEdit = computed(() => !!props.id)

onMounted(async () => {
  await ex.load()
  const e = props.id ? ex.byId(props.id) : null
  if (!e) return
  Object.assign(form, {
    name_pl: e.name_pl,
    name_en: e.name_en ?? '',
    muscle_groups: [...e.muscle_groups],
    equipment: [...e.equipment],
    pattern: e.movement_pattern ? [e.movement_pattern] : [],
    level: [e.level],
    contraindications: [...e.contraindications],
    cues: e.cues ?? '',
    video_path: e.video_path,
    image_url: e.image_url,
  })
  if (e.video_path) previewUrl.value = await ex.videoUrl(e.video_path)
})

watch(newVideo, (f, _old, onCleanup) => {
  if (!f) return
  const url = URL.createObjectURL(f)
  previewUrl.value = url
  removeVideo.value = false
  onCleanup(() => URL.revokeObjectURL(url))
})

function onFile(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]
  if (f) newVideo.value = f
}

function dropVideo() {
  newVideo.value = null
  previewUrl.value = null
  removeVideo.value = true
}

async function submit() {
  error.value = ''
  if (!form.name_pl.trim()) {
    error.value = 'Podaj nazwę ćwiczenia.'
    return
  }
  busy.value = true
  try {
    let videoPath = removeVideo.value ? null : form.video_path
    const oldPath = form.video_path
    if (newVideo.value) {
      status.value = 'Kompresja wideo…'
      const compressed = await compressVideo(newVideo.value, (p) => (progress.value = p))
      status.value = `Wysyłanie (${(compressed.size / 1024 / 1024).toFixed(1)} MB)…`
      videoPath = await ex.uploadVideo(compressed)
    }
    status.value = 'Zapisywanie…'
    const input: ExerciseInput = {
      name_pl: form.name_pl.trim(),
      name_en: form.name_en.trim() || null,
      muscle_groups: form.muscle_groups,
      equipment: form.equipment,
      movement_pattern: form.pattern[0] ?? null,
      level: (form.level[0] ?? 'beginner') as ExerciseLevel,
      contraindications: form.contraindications,
      cues: form.cues.trim() || null,
      video_path: videoPath,
      image_url: form.image_url,
    }
    const saved = await ex.save(input, props.id)
    if (oldPath && oldPath !== videoPath) await supabase.storage.from(MEDIA_BUCKET).remove([oldPath])
    router.replace(`/cwiczenia/${saved.id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
    status.value = ''
  }
}
</script>

<template>
  <main class="pb-6">
    <header class="flex items-center gap-1 px-2 pt-4">
      <button class="p-2" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-lg font-bold">{{ isEdit ? 'Edytuj ćwiczenie' : 'Nowe ćwiczenie' }}</h1>
    </header>

    <form class="space-y-5 px-4" @submit.prevent="submit">
      <section class="space-y-3">
        <div>
          <label class="label" for="name">Nazwa</label>
          <input id="name" v-model="form.name_pl" class="input" placeholder="np. Przysiad goblet" required />
        </div>
        <div>
          <label class="label" for="name_en">Nazwa angielska (opcjonalnie)</label>
          <input id="name_en" v-model="form.name_en" class="input" placeholder="Goblet squat" />
        </div>
      </section>

      <section>
        <p class="label">Wideo</p>
        <div v-if="previewUrl" class="relative overflow-hidden rounded-2xl bg-black">
          <video :src="previewUrl" controls playsinline muted loop class="aspect-[4/5] w-full object-contain" />
          <button type="button" class="absolute top-2 right-2 rounded-full bg-black/60 p-2 text-white" aria-label="Usuń wideo" @click="dropVideo">
            <Icon name="x" class="size-4" />
          </button>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <label class="btn-ghost cursor-pointer">
            <Icon name="video" class="size-4" />Nagraj
            <input type="file" accept="video/*" capture="environment" class="sr-only" @change="onFile" />
          </label>
          <label class="btn-ghost cursor-pointer">
            <Icon name="download" class="size-4 rotate-180" />Z galerii
            <input type="file" accept="video/*" class="sr-only" @change="onFile" />
          </label>
        </div>
        <p class="mt-1 text-xs text-stone-500">Krótki filmik 5–15 s wystarczy. Duże pliki są zmniejszane do 720p przed wysłaniem.</p>
      </section>

      <section>
        <p class="label">Partie mięśniowe</p>
        <ChipSelect v-model="form.muscle_groups" :options="MUSCLES" />
      </section>
      <section>
        <p class="label">Sprzęt</p>
        <ChipSelect v-model="form.equipment" :options="EQUIPMENT" />
      </section>
      <section>
        <p class="label">Wzorzec ruchu</p>
        <ChipSelect v-model="form.pattern" :options="PATTERNS" single />
      </section>
      <section>
        <p class="label">Poziom</p>
        <ChipSelect v-model="form.level" :options="LEVELS" single />
      </section>
      <section>
        <p class="label">Przeciwwskazania</p>
        <ChipSelect v-model="form.contraindications" :options="CONTRAINDICATIONS" />
      </section>
      <section>
        <label class="label" for="cues">Wskazówki techniczne</label>
        <textarea id="cues" v-model="form.cues" rows="5" class="input py-2" placeholder="np. Kolana w linii palców, klatka wysoko, pełna stopa na ziemi" />
      </section>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <div v-if="busy && status" class="text-sm text-stone-600 dark:text-stone-400">
        {{ status }}
        <div v-if="status.startsWith('Kompresja')" class="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
          <div class="h-full bg-brand-600" :style="{ width: progress * 100 + '%' }" />
        </div>
      </div>

      <button class="btn-primary sticky bottom-24 w-full shadow-lg" :disabled="busy">
        {{ busy ? 'Zapisywanie…' : isEdit ? 'Zapisz zmiany' : 'Dodaj ćwiczenie' }}
      </button>
    </form>
  </main>
</template>
