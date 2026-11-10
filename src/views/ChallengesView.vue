<script setup lang="ts">
// Wyzwania drużynowe (dzieci): wspólny cel tygodnia, trenerka wpisuje wkład każdego dziecka. Rodzic widzi wkład swojego dziecka
// i postęp drużyny – nigdy ranking. Tutaj (tylko trenerka) lista wkładów jest w kolejności alfabetycznej.
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useSportStore, type Challenge } from '@/stores/sport'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const clients = useClientsStore()
const sport = useSportStore()
const list = ref<Challenge[]>([])
const creating = ref(false)
const error = ref('')
const today = new Date().toISOString().slice(0, 10)
const plus = (d: string, n: number) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10)
const f = reactive({ title: '', description: '', unit: 'powt.', team_target: 500, starts_on: today, ends_on: plus(today, 6) })

onMounted(async () => {
  await clients.load()
  list.value = await sport.challenges()
})
const kids = computed(() => clients.all.filter((c) => c.client_group === 'child' && !c.archived).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pl')))
const team = (c: Challenge) => (c.challenge_entries ?? []).reduce((s, e) => s + Number(e.value), 0)
const mine = (c: Challenge, id: string) => (c.challenge_entries ?? []).find((e) => e.client_id === id)?.value ?? null
const isActive = (c: Challenge) => c.ends_on >= today
const open = ref<string | null>(null)

const IDEAS = [
  { title: 'Pajacyki tygodnia', unit: 'powt.', team_target: 1000, description: 'Każde pajacyki na treningu i w domu się liczą.' },
  { title: 'Kilometry drużyny', unit: 'km', team_target: 50, description: 'Bieg, rower, spacer z rodzicami.' },
  { title: 'Deska razem', unit: 's', team_target: 600, description: 'Sumujemy sekundy w desce całej grupy.' },
]

async function create() {
  error.value = ''
  try {
    if (f.title.trim().length < 2) throw new Error('Wpisz nazwę wyzwania.')
    const c = await sport.createChallenge({ ...f, title: f.title.trim(), description: f.description.trim() || null, team_target: Number(f.team_target) })
    list.value.unshift(c)
    open.value = c.id
    creating.value = false
    Object.assign(f, { title: '', description: '' })
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function setValue(c: Challenge, clientId: string, e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(',', '.').trim()
  const v = raw === '' ? null : Number(raw)
  if (v != null && (!Number.isFinite(v) || v < 0)) return
  await sport.setEntry(c.id, clientId, v)
  const rest = (c.challenge_entries ?? []).filter((x) => x.client_id !== clientId)
  c.challenge_entries = v == null ? rest : [...rest, { client_id: clientId, value: v }]
}
async function remove(c: Challenge) {
  if (!confirm(`Usunąć wyzwanie „${c.title}” razem z wpisami?`)) return
  await sport.removeChallenge(c.id)
  list.value = list.value.filter((x) => x.id !== c.id)
}
const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',')
const range = (c: Challenge) => `${new Date(c.starts_on).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} – ${new Date(c.ends_on).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}`
</script>

<template>
  <main class="pb-10">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-bold">Wyzwania drużynowe</h1>
        <p class="text-sm text-muted">Wspólny cel grupy dzieci – bez rankingów</p>
      </div>
      <button class="btn-primary" @click="creating = !creating"><Icon name="plus" class="size-5" />Nowe</button>
    </header>

    <div class="space-y-4 px-4">
      <form v-if="creating" class="card space-y-3 p-4" @submit.prevent="create">
        <div class="flex flex-wrap gap-2">
          <button v-for="i in IDEAS" :key="i.title" type="button" class="chip border-line-strong bg-surface" @click="Object.assign(f, i)">{{ i.title }}</button>
        </div>
        <label class="block"><span class="label">Nazwa</span><input v-model="f.title" class="input" maxlength="80" required /></label>
        <label class="block"><span class="label">Opis (opcjonalnie)</span><input v-model="f.description" class="input" /></label>
        <div class="grid grid-cols-2 gap-3">
          <label><span class="label">Cel drużyny</span><input v-model.number="f.team_target" type="number" min="1" class="input" required /></label>
          <label><span class="label">Jednostka</span><input v-model="f.unit" class="input" maxlength="10" required /></label>
          <label><span class="label">Od</span><input v-model="f.starts_on" type="date" class="input" required /></label>
          <label><span class="label">Do</span><input v-model="f.ends_on" type="date" class="input" required /></label>
        </div>
        <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
        <button class="btn-primary w-full">Utwórz wyzwanie</button>
      </form>

      <p v-if="!list.length && !creating" class="card p-6 text-center text-sm text-muted">Brak wyzwań. Utwórz pierwsze – np. „1000 pajacyków w tydzień” dla całej grupy.</p>

      <article v-for="c in list" :key="c.id" class="card space-y-3 p-4" :class="isActive(c) ? '' : 'opacity-70'">
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <p class="font-semibold">{{ c.title }}</p>
            <p class="text-xs text-muted">{{ range(c) }}{{ isActive(c) ? '' : ' · zakończone' }}{{ c.description ? ` · ${c.description}` : '' }}</p>
          </div>
          <button class="icon-btn -m-2 text-subtle hover:text-danger" :aria-label="`Usuń wyzwanie ${c.title}`" @click="remove(c)"><Icon name="trash" class="size-4" /></button>
        </div>
        <div class="h-3 overflow-hidden rounded-full bg-surface-2" role="img" :aria-label="`${fmt(team(c))} z ${fmt(c.team_target)} ${c.unit}`">
          <div class="h-full rounded-full" :class="team(c) >= c.team_target ? 'bg-success' : 'bg-primary'" :style="{ width: `${Math.min(100, (team(c) / c.team_target) * 100)}%` }" />
        </div>
        <p class="text-sm">
          <strong>{{ fmt(team(c)) }}</strong> / {{ fmt(c.team_target) }} {{ c.unit }}
          <span v-if="team(c) >= c.team_target" class="font-semibold text-success"> · cel osiągnięty!</span>
        </p>
        <button class="text-sm font-semibold text-primary-fg underline" :aria-expanded="open === c.id" @click="open = open === c.id ? null : c.id">
          {{ open === c.id ? 'Zwiń wpisy' : `Wpisz wkład dzieci (${(c.challenge_entries ?? []).length}/${kids.length})` }}
        </button>
        <div v-if="open === c.id" class="space-y-1.5">
          <p v-if="!kids.length" class="text-sm text-muted">Brak klientów z grupy „Dziecko”.</p>
          <label v-for="k in kids" :key="k.id" class="flex items-center gap-3 text-sm">
            <span class="min-w-0 flex-1 truncate">{{ k.full_name }}</span>
            <input :value="mine(c, k.id) ?? ''" inputmode="decimal" class="input !min-h-10 w-24 text-center" :aria-label="`Wkład: ${k.full_name}`" @change="setValue(c, k.id, $event)" />
            <span class="w-10 text-muted">{{ c.unit }}</span>
          </label>
        </div>
      </article>
    </div>
  </main>
</template>
