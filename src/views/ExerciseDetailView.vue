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
import ExerciseAnimation from '@/components/ExerciseAnimation.vue'
import { autoFamily, FAMILIES, FAMILY_KEYS, familyOf, isOneLeg } from '@/lib/pose/families'

const props = defineProps<{ id: string }>()
const auth = useAuthStore()
const ex = useExercisesStore()
const router = useRouter()

const videoSrc = ref<string | null>(null)
const picking = ref<null | 'regression' | 'progression' | 'alternative'>(null)
const error = ref('')
// ----- Własne etykiety -----
const newTag = ref('')
async function addTag() {
  if (!e.value || !newTag.value.trim()) return
  await ex.setTags(e.value.id, [...(e.value.tags ?? []), newTag.value]).catch((err) => (error.value = (err as Error).message))
  newTag.value = ''
}
const removeTag = (t: string) => e.value && ex.setTags(e.value.id, (e.value.tags ?? []).filter((x) => x !== t)).catch((err) => (error.value = (err as Error).message))

onMounted(() => ex.load())
const e = computed(() => ex.byId(props.id))

// ----- Wzorzec ruchu (animacja + analiza) -----
const family = computed(() => (e.value ? familyOf(e.value) : null))
const autoName = computed(() => {
  const a = e.value ? autoFamily(e.value) : null
  return a ? FAMILIES[a].name.toLowerCase() : 'brak'
})
type Media = 'anim' | 'media'
const media = ref<Media>('anim')
watch(
  () => e.value?.id,
  () => (media.value = e.value?.video_path ? 'media' : 'anim'),
  { immediate: true },
)
const mediaTabs = computed<[Media, string][]>(() => [
  ['anim', 'Animacja'],
  ['media', e.value?.video_path ? 'Film' : 'Zdjęcia'],
])
async function setFamily(v: string) {
  if (!e.value) return
  await ex.setFamily(e.value.id, v || null).catch((err) => (error.value = (err as Error).message))
}

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

const pickerTitle = { regression: 'Wybierz łatwiejszą wersję (regresję)', progression: 'Wybierz trudniejszą wersję (progresję)', alternative: 'Wybierz alternatywę (zamiennik)' }
type RelKind = 'regression' | 'progression' | 'alternative'
const RELATION_GROUPS: { kind: RelKind; title: string; hint: string; add: string; icon: string }[] = [
  { kind: 'regression', title: 'Regresje – łatwiejsze', hint: 'Gdy klient jeszcze nie daje rady albo coś boli.', add: 'Dodaj regresję', icon: 'down' },
  { kind: 'progression', title: 'Progresje – trudniejsze', hint: 'Następny krok, gdy ćwiczenie idzie łatwo.', add: 'Dodaj progresję', icon: 'up' },
  { kind: 'alternative', title: 'Alternatywy – zamienniki', hint: 'Podobny ruch, gdy brak sprzętu albo zajęte stanowisko.', add: 'Dodaj alternatywę', icon: 'swap' },
]
const idsOf = (k: RelKind) => (k === 'regression' ? regressions.value : k === 'progression' ? progressions.value : alternatives.value)

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
      <div v-if="family" class="flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Podgląd ruchu">
        <button v-for="[k, l] in mediaTabs" :key="k" role="tab" :aria-selected="media === k" class="min-h-9 flex-1 rounded-lg text-sm font-semibold" :class="media === k ? 'bg-surface shadow' : 'text-muted'" @click="media = k">{{ l }}</button>
      </div>
      <ExerciseAnimation v-if="family && media === 'anim'" :family="family" :equipment="e.equipment" :one-leg="isOneLeg(e)" />
      <ExerciseMedia v-else :video-src="videoSrc" :images="e.image_urls?.length ? e.image_urls : e.image_url ? [e.image_url] : []" :name-en="e.name_en" :name-pl="e.name_pl" />

      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="text-muted">Wzorzec ruchu:</span>
        <select v-if="auth.isTrainer" :value="e.movement_family ?? ''" class="input !min-h-9 w-auto py-1 text-sm" aria-label="Wzorzec ruchu ćwiczenia" @change="setFamily(($event.target as HTMLSelectElement).value)">
          <option value="">automatycznie: {{ autoName }}</option>
          <option v-for="k in FAMILY_KEYS" :key="k" :value="k">{{ FAMILIES[k].name }}</option>
          <option value="none">brak wzorca (nietypowe)</option>
        </select>
        <span v-else class="font-semibold">{{ family ? FAMILIES[family].name : 'brak' }}</span>
      </div>

      <p v-if="e.name_en && e.name_en !== e.name_pl" class="text-sm text-muted" lang="en">{{ e.name_en }}</p>
      <div class="flex flex-wrap items-center gap-1.5">
        <span v-for="t in e.tags ?? []" :key="t" class="inline-flex items-center gap-1 rounded-lg bg-primary-soft px-2 py-1 text-sm font-semibold text-primary-fg">
          {{ t }}
          <button v-if="auth.isTrainer" type="button" class="-mr-1 rounded p-0.5 hover:bg-primary/20" :aria-label="`Usuń etykietę ${t}`" @click="removeTag(t)"><Icon name="x" class="size-3.5" /></button>
        </span>
        <form v-if="auth.isTrainer" class="flex items-center gap-1" @submit.prevent="addTag">
          <input v-model="newTag" class="input !min-h-9 w-36 text-sm" maxlength="30" placeholder="+ własna etykieta" aria-label="Nowa etykieta ćwiczenia" />
          <button v-if="newTag.trim()" class="btn-ghost !min-h-9 border border-line-strong text-sm">Dodaj</button>
        </form>
      </div>
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
        <h2 class="mb-2 font-semibold">{{ e.source === 'free-exercise-db' ? 'Technika krok po kroku' : 'Wskazówki techniczne' }}<span v-if="e.cues_lang === 'en'" class="ml-1 text-xs font-normal text-muted">(po angielsku – do przetłumaczenia w Profilu)</span></h2>
        <p class="text-sm whitespace-pre-line text-fg">{{ e.cues }}</p>
      </section>

      <section class="card p-4">
        <h2 class="font-semibold">Regresje, progresje i alternatywy</h2>
        <p class="mt-0.5 mb-3 text-sm text-muted">Łatwiejsze i trudniejsze wersje oraz zamienniki – w sesji na żywo podmienisz ćwiczenie jednym dotknięciem.</p>

        <div v-for="grp in RELATION_GROUPS" :key="grp.kind" class="border-t border-line py-3 first-of-type:border-t-0">
          <div class="mb-1.5 flex items-center gap-2">
            <span class="flex size-7 items-center justify-center rounded-full bg-surface-2"><Icon :name="grp.icon" class="size-4" /></span>
            <div class="min-w-0 flex-1">
              <p class="font-semibold">{{ grp.title }}</p>
              <p class="text-xs text-muted">{{ grp.hint }}</p>
            </div>
          </div>
          <ul v-if="idsOf(grp.kind).length" class="space-y-1">
            <li v-for="oid in idsOf(grp.kind)" :key="oid" class="flex items-center gap-2">
              <RouterLink :to="`/cwiczenia/${oid}`" class="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 hover:bg-surface-2">
                <ExerciseThumb v-if="ex.byId(oid)" :exercise="ex.byId(oid)!" class="!size-10" />
                <span class="truncate text-sm">{{ ex.byId(oid)?.name_pl }}</span>
              </RouterLink>
              <button v-if="auth.isTrainer" class="icon-btn text-subtle hover:text-danger" :aria-label="`Usuń powiązanie z ${ex.byId(oid)?.name_pl ?? 'ćwiczeniem'}`" @click="unlink(oid)">
                <Icon name="x" class="size-4" />
              </button>
            </li>
          </ul>
          <p v-else class="text-sm text-subtle">Brak.</p>
          <button v-if="auth.isTrainer" class="mt-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-sm font-semibold text-primary-fg hover:bg-surface-2" @click="picking = grp.kind">
            <Icon name="plus" class="size-4" />{{ grp.add }}
          </button>
        </div>

        <details v-if="chain.length > 2" class="mt-1 border-t border-line pt-3">
          <summary class="cursor-pointer text-sm font-semibold">Cała ścieżka od najłatwiejszego ({{ chain.length }})</summary>
          <ol class="mt-2 space-y-1">
            <li v-for="(cid, i) in chain" :key="cid" class="flex items-center gap-2">
              <span class="w-5 text-center text-xs text-subtle">{{ i + 1 }}</span>
              <RouterLink v-if="cid !== e.id" :to="`/cwiczenia/${cid}`" class="flex-1 rounded-lg px-3 py-2 text-sm hover:bg-surface-2">{{ ex.byId(cid)?.name_pl }}</RouterLink>
              <span v-else class="flex-1 rounded-lg bg-primary-soft px-3 py-2 text-sm font-semibold text-fg">{{ e.name_pl }}</span>
            </li>
          </ol>
        </details>
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
