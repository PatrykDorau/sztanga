<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useExercisesStore } from '@/stores/exercises'
import { CONTRAINDICATIONS, EQUIPMENT, LEVELS, MUSCLES, PATTERNS, label } from '@/lib/vocab'
import ExercisePicker from '@/components/ExercisePicker.vue'
import ExerciseThumb from '@/components/ExerciseThumb.vue'
import Icon from '@/components/Icon.vue'
import ExerciseMedia from '@/components/ExerciseMedia.vue'

const props = defineProps<{ id: string }>()
const auth = useAuthStore()
const ex = useExercisesStore()
const router = useRouter()

const videoSrc = ref<string | null>(null)
const picking = ref<null | 'regression' | 'progression' | 'alternative'>(null)
const error = ref('')

onMounted(() => ex.load())
const e = computed(() => ex.byId(props.id))

watch(
  () => e.value?.video_path,
  async (p) => (videoSrc.value = p ? await ex.videoUrl(p) : null),
  { immediate: true },
)

const chain = computed(() => (e.value ? ex.chainOf(e.value.id) : []))
const regressions = computed(() => (e.value ? ex.regressionsOf(e.value.id) : []))
const progressions = computed(() => (e.value ? ex.progressionsOf(e.value.id) : []))
const alternatives = computed(() => (e.value ? ex.alternativesOf(e.value.id) : []))
const linked = computed(() => [props.id, ...regressions.value, ...progressions.value, ...alternatives.value])

const pickerTitle = { regression: 'Dodaj regresję (łatwiejsze)', progression: 'Dodaj progresję (trudniejsze)', alternative: 'Dodaj alternatywę' }

async function onPick(otherId: string) {
  if (!picking.value) return
  try {
    await ex.link(props.id, otherId, picking.value)
  } catch (err) {
    error.value = (err as Error).message
  }
  picking.value = null
}

async function unlink(otherId: string) {
  try {
    await ex.unlink(props.id, otherId)
  } catch (err) {
    error.value = (err as Error).message
  }
}

async function remove() {
  if (!e.value || !confirm(`Usunąć „${e.value.name_pl}”? Tego nie da się cofnąć.`)) return
  try {
    await ex.remove(e.value.id)
    router.replace('/cwiczenia')
  } catch (err) {
    const code = (err as { code?: string }).code
    error.value = code === '23503' ? 'To ćwiczenie jest użyte w planach – najpierw usuń je z treningów.' : (err as Error).message
  }
}
</script>

<template>
  <main v-if="e" class="pb-6">
    <header class="flex items-center gap-1 px-2 pt-4">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="min-w-0 flex-1 truncate text-lg font-bold">{{ e.name_pl }}</h1>
      <button
        class="icon-btn"
        :class="ex.favorites.has(e.id) ? 'text-warn-fg' : 'text-subtle'"
        :aria-label="ex.favorites.has(e.id) ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'"
        @click="ex.toggleFavorite(e.id)"
      >
        <Icon name="star" class="size-6" :class="ex.favorites.has(e.id) ? 'fill-current' : ''" />
      </button>
      <RouterLink v-if="auth.isTrainer" :to="`/cwiczenia/${e.id}/edycja`" class="icon-btn" aria-label="Edytuj">
        <Icon name="edit" class="size-6" />
      </RouterLink>
    </header>

    <div class="space-y-4 px-4">
      <ExerciseMedia :video-src="videoSrc" :images="e.image_urls?.length ? e.image_urls : e.image_url ? [e.image_url] : []" :name-en="e.name_en" :name-pl="e.name_pl" />

      <p v-if="e.name_en && e.name_en !== e.name_pl" class="text-sm text-muted" lang="en">{{ e.name_en }}</p>
      <p v-if="e.description" class="text-[15px] leading-relaxed">{{ e.description }}</p>

      <dl class="card grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm">
        <dt class="text-muted">Mięsień główny</dt>
        <dd class="flex flex-wrap gap-1.5">
          <span v-for="m in e.primary_muscles?.length ? e.primary_muscles : e.muscle_groups.slice(0, 1)" :key="m" class="tag !bg-primary-soft font-semibold !text-primary-fg">{{ label(MUSCLES, m) }}</span>
        </dd>
        <template v-if="(e.secondary_muscles ?? []).length">
          <dt class="text-muted">Pomocnicze</dt>
          <dd class="flex flex-wrap gap-1.5"><span v-for="m in e.secondary_muscles" :key="m" class="tag">{{ label(MUSCLES, m) }}</span></dd>
        </template>
        <dt class="text-muted">Sprzęt</dt>
        <dd class="flex flex-wrap gap-1.5"><span v-for="m in e.equipment" :key="m" class="tag">{{ label(EQUIPMENT, m) }}</span><span v-if="!e.equipment.length">—</span></dd>
        <dt class="text-muted">Typ</dt>
        <dd class="flex flex-wrap gap-1.5">
          <span class="tag">{{ label(LEVELS, e.level) }}</span>
          <span v-if="e.movement_pattern" class="tag">{{ label(PATTERNS, e.movement_pattern) }}</span>
          <span v-if="e.mechanic" class="tag">{{ e.mechanic === 'compound' ? 'wielostawowe' : 'izolowane' }}</span>
        </dd>
      </dl>

      <div v-if="e.contraindications.length" class="flex gap-2 warn-box">
        <Icon name="alert" class="size-5 shrink-0" />
        <p><strong>Uwaga przy:</strong> {{ e.contraindications.map((c) => label(CONTRAINDICATIONS, c)).join(', ') }}</p>
      </div>

      <section v-if="e.cues" class="card p-4">
        <h2 class="mb-2 font-semibold">{{ e.source === 'free-exercise-db' ? 'Technika krok po kroku (EN)' : 'Wskazówki techniczne' }}</h2>
        <p class="text-sm whitespace-pre-line text-fg">{{ e.cues }}</p>
      </section>

      <section class="card p-4">
        <h2 class="mb-3 font-semibold">Łańcuch regresji i progresji</h2>
        <ol v-if="chain.length > 1" class="space-y-1">
          <li v-for="(cid, i) in chain" :key="cid" class="flex items-center gap-2">
            <span class="w-5 text-center text-xs text-subtle">{{ i + 1 }}</span>
            <RouterLink
              v-if="cid !== e.id"
              :to="`/cwiczenia/${cid}`"
              class="flex-1 rounded-lg px-3 py-2 text-sm hover:bg-surface-2"
            >{{ ex.byId(cid)?.name_pl }}</RouterLink>
            <span v-else class="flex-1 rounded-lg bg-primary-soft px-3 py-2 text-sm font-semibold text-fg">{{ e.name_pl }}</span>
          </li>
        </ol>
        <p v-else class="text-sm text-muted">Brak powiązań. {{ auth.isTrainer ? 'Dodaj łatwiejszą lub trudniejszą wersję.' : '' }}</p>

        <div v-if="regressions.length + progressions.length + alternatives.length" class="mt-4 space-y-3 border-t border-line pt-3">
          <template v-for="grp in [
            { title: 'Regresje (łatwiejsze)', ids: regressions, icon: 'down' },
            { title: 'Progresje (trudniejsze)', ids: progressions, icon: 'up' },
            { title: 'Alternatywy', ids: alternatives, icon: 'swap' },
          ]" :key="grp.title">
            <div v-if="grp.ids.length">
              <p class="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{{ grp.title }}</p>
              <ul class="space-y-1">
                <li v-for="oid in grp.ids" :key="oid" class="flex items-center gap-2">
                  <RouterLink :to="`/cwiczenia/${oid}`" class="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 hover:bg-surface-2">
                    <ExerciseThumb v-if="ex.byId(oid)" :exercise="ex.byId(oid)!" class="!size-10" />
                    <span class="truncate text-sm">{{ ex.byId(oid)?.name_pl }}</span>
                  </RouterLink>
                  <button v-if="auth.isTrainer" class="icon-btn text-subtle hover:text-danger" aria-label="Usuń powiązanie" @click="unlink(oid)">
                    <Icon name="x" class="size-4" />
                  </button>
                </li>
              </ul>
            </div>
          </template>
        </div>

        <div v-if="auth.isTrainer" class="mt-4 grid grid-cols-3 gap-2">
          <button class="btn-ghost !px-2 text-xs" @click="picking = 'regression'"><Icon name="down" class="size-4" />Regresja</button>
          <button class="btn-ghost !px-2 text-xs" @click="picking = 'progression'"><Icon name="up" class="size-4" />Progresja</button>
          <button class="btn-ghost !px-2 text-xs" @click="picking = 'alternative'"><Icon name="swap" class="size-4" />Alternatywa</button>
        </div>
        <p v-if="error" class="mt-2 text-sm text-danger">{{ error }}</p>
      </section>

      <button v-if="auth.isTrainer" class="btn-danger w-full" @click="remove"><Icon name="trash" class="size-4" />Usuń ćwiczenie</button>
      <p v-if="e.attribution || e.source === 'free-exercise-db'" class="text-xs text-muted">
        Źródło: {{ [e.source === 'free-exercise-db' ? 'free-exercise-db (domena publiczna)' : null, e.attribution].filter(Boolean).join('; ') }}{{ e.attribution ? ' – użyte zgodnie z licencją Creative Commons' : '' }}.
      </p>
    </div>

    <ExercisePicker v-if="picking" :title="pickerTitle[picking]" :exclude="linked" @pick="onPick" @close="picking = null" />
  </main>

  <main v-else class="px-4 pt-10 text-center text-muted">
    {{ ex.loaded ? 'Nie znaleziono ćwiczenia.' : 'Ładowanie…' }}
  </main>
</template>
