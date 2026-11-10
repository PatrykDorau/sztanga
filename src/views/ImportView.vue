<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchFreeExerciseDb, importFreeExerciseDb } from '@/lib/freeExerciseDb'
import { useExercisesStore } from '@/stores/exercises'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const ex = useExercisesStore()
const state = ref<'idle' | 'busy' | 'done'>('idle')
const total = ref(0)
const done = ref(0)
const error = ref('')

async function run() {
  error.value = ''
  state.value = 'busy'
  try {
    const items = await fetchFreeExerciseDb()
    total.value = items.length
    await importFreeExerciseDb(items, (n) => (done.value = n))
    await ex.load(true)
    state.value = 'done'
  } catch (e) {
    error.value = (e as Error).message
    state.value = 'idle'
  }
}
</script>

<template>
  <main class="pb-6">
    <header class="flex items-center gap-1 px-2 pt-4">
      <button class="p-2" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-lg font-bold">Import bazy startowej</h1>
    </header>
    <div class="space-y-4 px-4">
      <div class="card space-y-2 p-4 text-sm text-stone-700 dark:text-stone-300">
        <p>
          Zaimportuje ok. 870 ćwiczeń z otwartej bazy
          <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener" class="underline">free-exercise-db</a>
          (domena publiczna) – z obrazkami, partiami, sprzętem i instrukcjami po angielsku.
        </p>
        <p>Zaimportowane ćwiczenia są oddzielone od Twoich: na liście domyślnie widać tylko „Moje”. Możesz je edytować, tłumaczyć i łączyć w łańcuchy regresji/progresji.</p>
        <p class="text-stone-500">Ponowny import nie tworzy duplikatów.</p>
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <div v-if="state === 'busy'" class="card p-4">
        <p class="mb-2 text-sm">Importowanie… {{ done }} / {{ total || '?' }}</p>
        <div class="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
          <div class="h-full bg-brand-600 transition-all" :style="{ width: total ? (done / total) * 100 + '%' : '5%' }" />
        </div>
      </div>

      <div v-else-if="state === 'done'" class="card p-4">
        <p class="mb-3 font-semibold">Gotowe – zaimportowano {{ total }} ćwiczeń.</p>
        <RouterLink to="/cwiczenia" class="btn-primary w-full">Przejdź do ćwiczeń</RouterLink>
      </div>

      <button v-else class="btn-primary w-full" @click="run">Importuj</button>
    </div>
  </main>
</template>
