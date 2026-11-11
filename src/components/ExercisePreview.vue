<script setup lang="ts">
// Podgląd ćwiczenia w okienku (np. przy imporcie treningu): animacja / zdjęcia / film, opis, mięśnie, sprzęt, wskazówki.
// Opcjonalnie przycisk „Wybierz to ćwiczenie”.
import { computed, ref, watch } from 'vue'
import { useExercisesStore } from '@/stores/exercises'
import { familyOf, isOneLeg } from '@/lib/pose/families'
import { EQUIPMENT, MUSCLES, label } from '@/lib/vocab'
import ExerciseAnimation from './ExerciseAnimation.vue'
import ExerciseMedia from './ExerciseMedia.vue'
import Icon from './Icon.vue'

const props = defineProps<{ id: string; pickLabel?: string }>()
const emit = defineEmits<{ close: []; pick: [id: string] }>()
const ex = useExercisesStore()
const e = computed(() => ex.byId(props.id))
const family = computed(() => (e.value ? familyOf(e.value) : null))
const images = computed(() => (e.value?.image_urls?.length ? e.value.image_urls : e.value?.image_url ? [e.value.image_url] : []))
const videoSrc = ref<string | null>(null)
const tab = ref<'anim' | 'media'>('anim')
watch(
  () => e.value?.video_path,
  async (p) => {
    videoSrc.value = p ? await ex.videoUrl(p).catch(() => null) : null
    // film albo zdjęcia trenerki mają pierwszeństwo przed animacją
    tab.value = p || !family.value ? 'media' : 'anim'
  },
  { immediate: true },
)
const muscles = computed(() => (e.value?.primary_muscles?.length ? e.value.primary_muscles : (e.value?.muscle_groups ?? [])).map((m) => label(MUSCLES, m)))
const helpers = computed(() => (e.value?.secondary_muscles ?? []).map((m) => label(MUSCLES, m)))
const equipment = computed(() => (e.value?.equipment ?? []).filter((q) => q !== 'body only').map((q) => label(EQUIPMENT, q)))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section v-if="e" class="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-bg sm:rounded-3xl" role="dialog" aria-modal="true" :aria-label="e.name_pl">
      <header class="flex items-start gap-2 border-b border-line px-4 py-3">
        <div class="min-w-0 flex-1">
          <h2 class="font-bold leading-tight">{{ e.name_pl }}</h2>
          <p v-if="e.name_en" class="truncate text-xs text-muted">{{ e.name_en }}</p>
        </div>
        <button class="icon-btn -mr-2 shrink-0" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      </header>

      <div class="flex-1 space-y-3 overflow-y-auto p-4">
        <div v-if="family && (images.length || videoSrc)" class="flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Podgląd ruchu">
          <button role="tab" :aria-selected="tab === 'anim'" class="min-h-9 flex-1 rounded-lg text-sm font-semibold" :class="tab === 'anim' ? 'bg-surface shadow' : 'text-muted'" @click="tab = 'anim'">Animacja</button>
          <button role="tab" :aria-selected="tab === 'media'" class="min-h-9 flex-1 rounded-lg text-sm font-semibold" :class="tab === 'media' ? 'bg-surface shadow' : 'text-muted'" @click="tab = 'media'">{{ videoSrc ? 'Film' : 'Zdjęcia' }}</button>
        </div>
        <ExerciseAnimation v-if="family && tab === 'anim'" :family="family" :equipment="e.equipment" :one-leg="isOneLeg(e)" small />
        <ExerciseMedia v-else :video-src="videoSrc" :images="images" :name-en="e.name_en" :name-pl="e.name_pl" />

        <p v-if="e.description" class="text-sm">{{ e.description }}</p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <template v-if="muscles.length"><dt class="text-muted">Mięśnie</dt><dd class="font-semibold">{{ muscles.join(', ') }}</dd></template>
          <template v-if="helpers.length"><dt class="text-muted">Pomocniczo</dt><dd>{{ helpers.join(', ') }}</dd></template>
          <dt class="text-muted">Sprzęt</dt><dd>{{ equipment.length ? equipment.join(', ') : 'masa ciała' }}</dd>
        </dl>
        <div v-if="e.tags?.length" class="flex flex-wrap gap-1.5">
          <span v-for="t in e.tags" :key="t" class="tag">{{ t }}</span>
        </div>
        <details v-if="e.cues && e.cues_lang !== 'en'" class="text-sm">
          <summary class="cursor-pointer font-semibold">Wskazówki techniczne</summary>
          <p class="mt-1 whitespace-pre-line text-muted">{{ e.cues }}</p>
        </details>
        <RouterLink :to="`/cwiczenia/${e.id}`" target="_blank" class="inline-flex items-center gap-1 text-sm font-semibold text-primary-fg">Pełna karta ćwiczenia<Icon name="chevron" class="size-4" /></RouterLink>
      </div>

      <footer v-if="pickLabel" class="border-t border-line p-3" style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))">
        <button class="btn-primary w-full" @click="emit('pick', e.id)">{{ pickLabel }}</button>
      </footer>
    </section>
  </div>
</template>
