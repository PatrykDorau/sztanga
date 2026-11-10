<script setup lang="ts">
// Sprzęt siłowni: kategorie (sztangi, hantle, wyciągi…) i konkretne maszyny. Plany dla klientów tej siłowni
// (generator i dobór ćwiczeń w kreatorze) biorą tylko ćwiczenia możliwe do zrobienia na miejscu.
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useCalendarStore } from '@/stores/calendar'
import { useExercisesStore } from '@/stores/exercises'
import { EQUIPMENT, MUSCLES, label } from '@/lib/vocab'
import { searchExercises } from '@/lib/exerciseSearch'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const cal = useCalendarStore()
const ex = useExercisesStore()
const gym = computed(() => cal.gymById(props.id))
const eq = ref<Set<string>>(new Set())
const machines = ref<Set<string>>(new Set())
const allMachines = ref(true) // brak listy = wszystkie maszyny
const q = ref('')
const saving = ref(false)
const saved = ref(false)
const error = ref('')

onMounted(async () => {
  await Promise.all([cal.gyms.length ? null : cal.loadGyms(), ex.load()])
  const g = gym.value
  eq.value = new Set(g?.equipment ?? Object.keys(EQUIPMENT).filter((k) => k !== 'body only'))
  allMachines.value = !g?.machines
  machines.value = new Set(g?.machines ?? machineList.value.map((e) => e.id))
})

const CATS = computed(() => Object.entries(EQUIPMENT).filter(([k]) => k !== 'body only' && k !== 'other'))
const machineList = computed(() => ex.all.filter((e) => e.equipment.includes('machine')).sort((a, b) => a.name_pl.localeCompare(b.name_pl, 'pl')))
const shown = computed(() => searchExercises(q.value, machineList.value))
const byMuscle = computed(() => {
  const m = new Map<string, typeof shown.value>()
  for (const e of shown.value) {
    const k = e.primary_muscles?.[0] ?? e.muscle_groups[0] ?? 'other'
    m.set(k, [...(m.get(k) ?? []), e])
  }
  return [...m.entries()].sort((a, b) => label(MUSCLES, a[0]).localeCompare(label(MUSCLES, b[0]), 'pl'))
})
function toggle(set: Set<string>, k: string) {
  const n = new Set(set)
  if (n.has(k)) n.delete(k)
  else n.add(k)
  return n
}
async function save() {
  saving.value = true
  error.value = ''
  try {
    const patch = {
      equipment: [...eq.value],
      machines: !eq.value.has('machine') ? [] : allMachines.value ? null : [...machines.value],
    }
    const { error: e } = await supabase.from('gyms').update(patch).eq('id', props.id)
    if (e) throw e
    await cal.loadGyms()
    saved.value = true
    setTimeout(() => (saved.value = false), 1500)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="pb-28">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-2xl font-bold">Sprzęt: {{ gym?.name ?? '…' }}</h1>
        <p class="text-sm text-muted">Plany dla tej siłowni użyją tylko dostępnego sprzętu</p>
      </div>
    </header>

    <div v-if="gym" class="space-y-5 px-4">
      <section class="space-y-2">
        <h2 class="text-lg font-bold">Rodzaje sprzętu</h2>
        <div class="flex flex-wrap gap-2">
          <button v-for="[k, l] in CATS" :key="k" type="button" :class="eq.has(k) ? 'chip-on' : 'chip-off'" :aria-pressed="eq.has(k)" @click="eq = toggle(eq, k)">{{ l }}</button>
        </div>
        <p class="text-xs text-muted">Ćwiczenia z masą ciała są dostępne zawsze.</p>
      </section>

      <section v-if="eq.has('machine')" class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-bold">Maszyny</h2>
          <label class="flex items-center gap-2 text-sm"><input v-model="allMachines" type="checkbox" class="size-5 accent-primary" />wszystkie</label>
        </div>
        <template v-if="!allMachines">
          <p class="text-sm text-muted">Zaznacz maszyny, które są w tej siłowni ({{ machines.size }} z {{ machineList.length }}).</p>
          <input v-model="q" type="search" class="input" placeholder="Szukaj maszyny, np. suwnica, uginanie nóg…" />
          <div v-for="[m, list] in byMuscle" :key="m" class="space-y-1">
            <p class="text-xs font-semibold tracking-wide text-muted uppercase">{{ label(MUSCLES, m) }}</p>
            <label v-for="e in list" :key="e.id" class="flex min-h-10 items-center gap-3 text-sm">
              <input type="checkbox" class="size-5 accent-primary" :checked="machines.has(e.id)" @change="machines = toggle(machines, e.id)" />
              <span class="min-w-0 flex-1">{{ e.name_pl }}</span>
            </label>
          </div>
        </template>
      </section>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    </div>

    <div class="fixed inset-x-0 z-20 mx-auto max-w-2xl border-t border-line bg-bg/95 px-4 py-3 backdrop-blur" style="bottom: calc(4rem + env(safe-area-inset-bottom))">
      <button class="btn-primary w-full" :disabled="saving" @click="save">{{ saving ? 'Zapisywanie…' : saved ? 'Zapisano' : 'Zapisz sprzęt' }}</button>
    </div>
  </main>
</template>
