<script setup lang="ts">
// Generator planów AI: formularz → Claude układa szkic wyłącznie z ćwiczeń z bazy trenerki →
// szkic otwiera się w kreatorze (status "szkic" – klient nic nie widzi, dopóki trenerka nie aktywuje).
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { aiStatus, generatePlan, SPLIT_HINT, SPLIT_LABEL, type PlanRequest, type SplitType } from '@/lib/ai'
import { useCalendarStore } from '@/stores/calendar'
import { useExercisesStore } from '@/stores/exercises'
import { allowedSet } from '@/lib/gymEquipment'
import { buildRulePlan, loadRuleData, savePlanDraft } from '@/lib/planRules'
import { CONTRAINDICATIONS, EQUIPMENT } from '@/lib/vocab'
import ChipSelect from '@/components/ChipSelect.vue'
import Icon from '@/components/Icon.vue'

const route = useRoute()
const router = useRouter()
const clients = useClientsStore()
const programs = useProgramsStore()

const form = reactive({
  client_id: String(route.query.client ?? ''),
  goal: '',
  level: ['beginner'] as string[],
  days: 3,
  weeks: 4,
  minutes: 60 as number | null,
  equipment: ['dumbbell', 'barbell'] as string[],
  limitations: [] as string[],
  notes: '',
  split: 'auto' as SplitType,
  gym_id: '' as string,
  structure: true, // schemat trenerki: przygotowanie ruchowe, aktywacja, pary, finisher
})
const cal = useCalendarStore()
const exStore = useExercisesStore()
const gym = computed(() => cal.gymById(form.gym_id || null))
// Siłownia z ustawionym sprzętem wyznacza sprzęt planu
watch(gym, (g) => {
  if (g?.equipment) form.equipment = [...g.equipment]
})
const busy = ref<false | 'rules' | 'ai'>(false)
const aiOn = ref(false)
const error = ref('')
const elapsed = ref(0)
const LEVELS: Record<string, string> = { beginner: 'Początkujący', intermediate: 'Średniozaawansowany', advanced: 'Zaawansowany' }

onMounted(async () => {
  clients.load()
  cal.gyms.length || cal.loadGyms().catch(() => null)
  aiOn.value = (await aiStatus()).ai
})
const client = computed(() => clients.byId(form.client_id))
// Dane z karty klienta jako punkt wyjścia (trenerka może je zmienić).
watch(
  client,
  (c) => {
    if (!c) return
    if (c.goals && !form.goal) form.goal = c.goals
    if (c.equipment.length) form.equipment = [...c.equipment]
    form.limitations = [...c.limitations]
    if (c.gym_id) form.gym_id = c.gym_id
  },
  { immediate: true },
)

function request(): PlanRequest {
  return {
    client_id: form.client_id || null,
    goal: form.goal.trim(),
    level: (form.level[0] ?? 'beginner') as PlanRequest['level'],
    days: form.days,
    weeks: form.weeks,
    minutes: form.minutes || null,
    equipment: form.equipment,
    limitations: form.limitations,
    notes: form.notes.trim() || null,
    split: form.split,
    gym_id: form.gym_id || null,
    structure: form.structure,
  }
}

/** mode 'rules' – za darmo, od razu, na telefonie; 'ai' – Claude (gdy skonfigurowany klucz). */
async function submit(mode: 'rules' | 'ai') {
  if (!form.goal.trim()) {
    error.value = 'Opisz cel planu.'
    return
  }
  busy.value = mode
  error.value = ''
  elapsed.value = 0
  const tick = setInterval(() => elapsed.value++, 1000)
  try {
    let id: string
    let note = '1'
    if (mode === 'ai') {
      const r = await generatePlan(request())
      id = r.program_id
      if (r.warnings.length) note = r.warnings.join(' ')
    } else {
      const { exercises, usage, favorites } = await loadRuleData()
      await exStore.load()
      const plan = buildRulePlan(request(), exercises, usage, `${form.client_id}${new Date().toISOString().slice(0, 10)}`, client.value?.client_group ?? null, allowedSet(exStore.all, gym.value), {
        favorites,
        structure: form.structure,
      })
      id = await savePlanDraft(plan, form.client_id || null)
      note = 'rules'
    }
    await programs.loadList(true).catch(() => null)
    router.replace({ path: `/plany/${id}`, query: { ai: note } })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    clearInterval(tick)
    busy.value = false
  }
}
</script>

<template>
  <main class="pb-10">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <div>
        <h1 class="text-2xl font-bold">Generator planu</h1>
        <p class="text-sm text-muted">Szkic z ćwiczeń z Twojej bazy – do poprawienia w kreatorze</p>
      </div>
    </header>

    <form class="space-y-5 px-4" @submit.prevent="submit(aiOn ? 'ai' : 'rules')">
      <div>
        <label class="label" for="cl">Dla kogo</label>
        <select id="cl" v-model="form.client_id" class="input" :disabled="!!busy">
          <option value="">Szablon (bez klienta)</option>
          <option v-for="c in clients.all.filter((x) => !x.archived)" :key="c.id" :value="c.id">{{ c.full_name }}</option>
        </select>
      </div>
      <div>
        <label class="label" for="goal">Cel</label>
        <textarea id="goal" v-model="form.goal" rows="3" class="input py-2" :disabled="!!busy" placeholder="np. siła w przysiadzie i martwym ciągu, powrót po kontuzji kolana, redukcja 5 kg" />
      </div>
      <div>
        <p class="label">Typ treningu</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="(l, k) in SPLIT_LABEL" :key="k" type="button" :class="form.split === k ? 'chip-on' : 'chip-off'" :aria-pressed="form.split === k" :disabled="!!busy" @click="form.split = k">{{ l }}</button>
        </div>
        <p class="mt-1 text-xs text-muted">{{ SPLIT_HINT[form.split] }}</p>
      </div>
      <div v-if="cal.gyms.length">
        <label class="label" for="gym">Siłownia</label>
        <select id="gym" v-model="form.gym_id" class="input" :disabled="!!busy">
          <option value="">Dowolna (sprzęt poniżej)</option>
          <option v-for="g in cal.gyms" :key="g.id" :value="g.id">{{ g.name }}{{ g.equipment || g.machines ? '' : ' – sprzęt nieustawiony' }}</option>
        </select>
        <p v-if="gym && (gym.equipment || gym.machines)" class="mt-1 text-xs text-muted">Plan użyje tylko sprzętu i maszyn dostępnych w {{ gym.name }}.</p>
        <p v-else-if="gym" class="mt-1 text-xs text-muted">Ustaw sprzęt tej siłowni: <RouterLink :to="`/silownie/${gym.id}`" class="underline">Sprzęt {{ gym.code }}</RouterLink>.</p>
      </div>
      <div>
        <p class="label">Poziom</p>
        <ChipSelect v-model="form.level" :options="LEVELS" single />
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="label" for="d">Treningi / tydz.</label>
          <input id="d" v-model.number="form.days" type="number" min="1" max="6" class="input" :disabled="!!busy" />
        </div>
        <div>
          <label class="label" for="w">Tygodnie</label>
          <input id="w" v-model.number="form.weeks" type="number" min="1" max="8" class="input" :disabled="!!busy" />
        </div>
        <div>
          <label class="label" for="m">Minuty</label>
          <input id="m" v-model.number="form.minutes" type="number" min="20" max="150" step="5" class="input" :disabled="!!busy" />
        </div>
      </div>
      <div>
        <p class="label">Dostępny sprzęt</p>
        <ChipSelect v-model="form.equipment" :options="EQUIPMENT" custom placeholder="wybierz sprzęt" />
        <p class="mt-1 text-xs text-muted">Ćwiczenia z masą ciała są zawsze dostępne.</p>
      </div>
      <label class="flex items-start gap-3 text-sm">
        <input v-model="form.structure" type="checkbox" class="mt-0.5 size-5 accent-primary" :disabled="!!busy" />
        <span><strong>Mój schemat treningu</strong> – przygotowanie ruchowe (ergometr + ćwiczenia z etykietą „przygotowanie ruchowe”), aktywacja (A), część główna w parach po 3 serie, na końcu finisher (sanki). Ulubione ćwiczenia (gwiazdka) mają pierwszeństwo.</span>
      </label>
      <div>
        <p class="label">Ograniczenia / kontuzje</p>
        <ChipSelect v-model="form.limitations" :options="CONTRAINDICATIONS" custom placeholder="brak – dodaj" />
        <p class="mt-1 text-xs text-muted">Ćwiczenia z pasującym przeciwwskazaniem w ogóle nie trafią do AI.</p>
      </div>
      <div>
        <label class="label" for="n">Uwagi (opcjonalnie)</label>
        <textarea id="n" v-model="form.notes" rows="2" class="input py-2" :disabled="!!busy" placeholder="np. dzień 1 dół, dzień 2 góra; bez skoków; dużo pracy na pośladki" />
      </div>

      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <div v-if="busy" class="card space-y-2 p-4" role="status">
        <p class="font-semibold">{{ busy === 'ai' ? 'Claude układa plan…' : 'Układanie planu…' }} <span class="text-muted tabular-nums">{{ elapsed }} s</span></p>
        <p class="text-sm text-muted">{{ busy === 'ai' ? 'Zwykle do minuty.' : 'Kilka sekund.' }} Potem plan otworzy się w kreatorze jako szkic.</p>
      </div>
      <div class="grid gap-3" :class="aiOn ? 'grid-cols-2' : ''">
        <button type="button" :class="aiOn ? 'btn-ghost border border-line-strong' : 'btn-primary'" :disabled="!!busy" @click="submit('rules')">
          <Icon name="clipboard" class="size-5" />{{ busy === 'rules' ? 'Układanie…' : 'Z reguł' }}
        </button>
        <button v-if="aiOn" type="button" class="btn-primary" :disabled="!!busy" @click="submit('ai')">
          <Icon name="star" class="size-5" />{{ busy === 'ai' ? 'Generowanie…' : 'Z AI' }}
        </button>
      </div>
      <p class="text-xs text-muted">
        <strong>Z reguł</strong> – za darmo, od razu: podział wg liczby treningów, ćwiczenia najczęściej używane w Twoich planach, progresja i deload.
        <template v-if="aiOn"><strong>Z AI</strong> – Claude dopasowuje plan do opisu celu i uwag (kilka–kilkanaście groszy). Do AI trafiają: cel, poziom, sprzęt, ograniczenia, grupa, wiek i cele z karty klienta oraz lista ćwiczeń – bez imienia, kontaktu i notatek.</template>
      </p>
    </form>
  </main>
</template>
