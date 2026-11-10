<script setup lang="ts">
import { computed, ref } from 'vue'
import { useExercisesStore } from '@/stores/exercises'
import { matches } from '@/lib/search'
import ExerciseThumb from './ExerciseThumb.vue'
import Icon from './Icon.vue'

const props = defineProps<{ title: string; exclude?: string[] }>()
const emit = defineEmits<{ pick: [id: string]; close: [] }>()
const ex = useExercisesStore()
const q = ref('')

const list = computed(() =>
  ex.all
    .filter((e) => !props.exclude?.includes(e.id) && matches(q.value, e.name_pl, e.name_en))
    .sort((a, b) => Number(b.source === 'own') - Number(a.source === 'own'))
    .slice(0, 40),
)
</script>

<template>
  <div class="fixed inset-0 z-30 flex flex-col bg-stone-50 dark:bg-stone-950" role="dialog" :aria-label="title">
    <header class="flex items-center gap-2 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
      <button class="-ml-2 p-2" aria-label="Zamknij" @click="emit('close')"><Icon name="x" class="size-5" /></button>
      <h2 class="font-semibold">{{ title }}</h2>
    </header>
    <div class="p-4 pb-2">
      <input v-model="q" type="search" class="input" placeholder="Szukaj ćwiczenia…" autofocus />
    </div>
    <ul class="flex-1 space-y-2 overflow-y-auto px-4 pb-6">
      <li v-for="e in list" :key="e.id">
        <button class="card flex w-full items-center gap-3 p-2 text-left" @click="emit('pick', e.id)">
          <ExerciseThumb :exercise="e" />
          <span class="font-medium">{{ e.name_pl }}</span>
        </button>
      </li>
      <li v-if="!list.length" class="py-8 text-center text-stone-500">Brak wyników</li>
    </ul>
  </div>
</template>
