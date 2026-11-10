<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useExercisesStore } from '@/stores/exercises'
import { searchExercises } from '@/lib/exerciseSearch'
import ExerciseThumb from './ExerciseThumb.vue'
import Icon from './Icon.vue'

// allowed: ćwiczenia możliwe w siłowni klienta (brak = wszystkie)
const props = defineProps<{ title: string; exclude?: string[]; limitations?: string[]; allowed?: Set<string> | null }>()
const warn = (c: string[]) => !!props.limitations?.some((l) => c.includes(l))
const emit = defineEmits<{ pick: [id: string]; close: [] }>()
const ex = useExercisesStore()
const q = ref('')
const showAll = ref(false) // pokaż też ćwiczenia spoza sprzętu siłowni
// Atrybut autofocus działa tylko przy ładowaniu strony, nie w oknie otwieranym później.
const searchEl = ref<HTMLInputElement | null>(null)
onMounted(() => searchEl.value?.focus())

const list = computed(() => {
  const pool = ex.all.filter((e) => !props.exclude?.includes(e.id) && (!props.allowed || showAll.value || props.allowed.has(e.id)))
  // bez zapytania: własne ćwiczenia trenerki na górze; z zapytaniem – trafność
  return (q.value.trim() ? searchExercises(q.value, pool) : [...pool].sort((a, b) => Number(b.source === 'own') - Number(a.source === 'own'))).slice(0, 40)
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" :aria-label="title" @keydown.esc="emit('close')">
    <header class="flex items-center gap-2 border-b border-line px-4 py-3">
      <button class="icon-btn -ml-2" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      <h2 class="font-semibold">{{ title }}</h2>
    </header>
    <div class="p-4 pb-2">
      <input ref="searchEl" v-model="q" type="search" class="input" placeholder="Szukaj: nazwa, partia, sprzęt, np. rdl, klata hantle…" />
      <label v-if="allowed" class="mt-2 flex items-center gap-2 text-sm text-muted"><input v-model="showAll" type="checkbox" class="size-4 accent-primary" />Pokaż też ćwiczenia spoza sprzętu tej siłowni</label>
    </div>
    <ul class="flex-1 space-y-2 overflow-y-auto px-4 pb-6">
      <li v-for="e in list" :key="e.id">
        <button class="card flex w-full items-center gap-3 p-2 text-left" @click="emit('pick', e.id)">
          <ExerciseThumb :exercise="e" />
          <span class="min-w-0 flex-1">
            <span class="block font-medium">
              {{ e.name_pl }}
              <span v-for="t in e.tags ?? []" :key="t" class="ml-1 rounded-md bg-primary-soft px-1.5 text-[11px] font-semibold text-primary-fg">{{ t }}</span>
            </span>
            <span v-if="e.name_en && e.name_en !== e.name_pl" class="block truncate text-xs text-subtle" lang="en">{{ e.name_en }}</span>
          </span>
          <Icon v-if="warn(e.contraindications)" name="alert" class="size-5 shrink-0 text-warn-fg" aria-label="Przeciwwskazanie" />
        </button>
      </li>
      <li v-if="!list.length" class="py-8 text-center text-muted">Brak wyników</li>
    </ul>
  </div>
</template>
