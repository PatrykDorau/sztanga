<script setup lang="ts">
// Generator planów AI: formularz → Claude układa szkic wyłącznie z ćwiczeń z bazy trenerki →
// szkic otwiera się w kreatorze (status "szkic" – klient nic nie widzi, dopóki trenerka nie aktywuje).
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { aiStatus, generatePlan, type PlanRequest } from '@/lib/ai'
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
})
const busy = ref<false | 'rules' | 'ai'>(false)
const aiOn = ref(false)
const error = ref('')
const elapsed = ref(0)
const LEVELS: Record<string, string> = { beginner: 'Początkujący', intermediate: 'Średniozaawansowany', advanced: 'Zaawansowany' }

onMounted(async () => {
  clients.load()
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
      const { exercises, usage } = await loadRuleData()
      const plan = buildRulePlan(request(), exercises, usage, `${form.client_id}${new Date().toISOString().slice(0, 10)}`, client.value?.client_group ?? null)
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
        <ChipSelect v-model="form.equipment" :options="EQUIPMENT" />
        <p class="mt-1 text-xs text-muted">Ćwiczenia z masą ciała są zawsze dostępne.</p>
      </div>
      <div>
        <p class="label">Ograniczenia / kontuzje</p>
        <ChipSelect v-model="form.limitations" :options="CONTRAINDICATIONS" />
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
