<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { STATUSES, label } from '@/lib/vocab'
import { matches } from '@/lib/search'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const programs = useProgramsStore()
const clients = useClientsStore()
const tab = ref<'templates' | 'clients' | 'single'>('templates')
const q = ref('')
const creating = ref(false)
const newName = ref('')
const newWeeks = ref(4)

onMounted(() => Promise.all([programs.loadList(), clients.load()]))

const list = computed(() =>
  programs.list
    .filter((p) => (tab.value === 'single' ? p.kind === 'single' : p.kind !== 'single' && (tab.value === 'templates' ? p.is_template : !p.is_template)))
    .filter((p) => matches(q.value, p.name, clients.byId(p.client_id)?.full_name)),
)

async function create() {
  if (!newName.value.trim()) return
  const p = await programs.create({ name: newName.value.trim(), is_template: true }, Math.max(1, Math.min(52, newWeeks.value)))
  router.push(`/plany/${p.id}`)
}
// Pojedynczy trening: jedna jednostka – dla klienta (od razu aktywny) albo jako gotowiec do wielokrotnego użycia.
const singleClient = ref('')
async function createSingle() {
  const name = newName.value.trim()
  if (!name) return
  const p = await programs.create(
    { name, kind: 'single', is_template: !singleClient.value, client_id: singleClient.value || null, ...(singleClient.value ? { status: 'active' as const } : {}) },
    1,
    name,
  )
  router.push(`/plany/${p.id}`)
}
</script>

<template>
  <main>
    <header class="page-header space-y-3 px-4 pb-3">
      <div class="flex items-center justify-between">
        <h1 class="page-title">Plany</h1>
        <div class="flex gap-2">
          <RouterLink to="/plany/import" class="icon-btn border border-line-strong" aria-label="Import treningu (tekst, zdjęcie, dyktowanie)" title="Import treningu"><Icon name="download" class="size-5" /></RouterLink>
          <RouterLink to="/plany/ai" class="btn-ghost border border-line-strong"><Icon name="star" class="size-5" />Generator</RouterLink>
          <button v-if="tab === 'templates'" class="btn-primary" @click="creating = !creating"><Icon name="plus" class="size-5" />Szablon</button>
          <button v-if="tab === 'single'" class="btn-primary" @click="creating = !creating"><Icon name="plus" class="size-5" />Trening</button>
        </div>
      </div>
      <div class="grid grid-cols-3 rounded-xl bg-surface-2 p-1">
        <button class="rounded-lg py-2 text-sm font-medium" :class="tab === 'templates' ? 'bg-surface shadow text-fg' : 'text-muted'" @click="(tab = 'templates'), (creating = false)">Szablony</button>
        <button class="rounded-lg py-2 text-sm font-medium" :class="tab === 'clients' ? 'bg-surface shadow text-fg' : 'text-muted'" @click="(tab = 'clients'), (creating = false)">Klientów</button>
        <button class="rounded-lg py-2 text-sm font-medium" :class="tab === 'single' ? 'bg-surface shadow text-fg' : 'text-muted'" @click="(tab = 'single'), (creating = false)">Pojedyncze</button>
      </div>
      <input v-model="q" type="search" class="input" placeholder="Szukaj…" />
    </header>

    <section class="space-y-3 px-4">
      <form v-if="creating && tab === 'templates'" class="card space-y-3 p-4" @submit.prevent="create">
        <div>
          <label class="label" for="tn">Nazwa szablonu</label>
          <input id="tn" v-model="newName" class="input" placeholder="np. Full body początkujący" v-focus />
        </div>
        <div>
          <label class="label" for="tw">Liczba tygodni</label>
          <input id="tw" v-model.number="newWeeks" type="number" min="1" max="52" class="input" />
          <p class="mt-1 text-xs text-muted">Możesz też zacząć od 1 tygodnia i kopiować go z progresją.</p>
        </div>
        <button class="btn-primary w-full">Utwórz i otwórz</button>
      </form>

      <form v-if="creating && tab === 'single'" class="card space-y-3 p-4" @submit.prevent="createSingle">
        <div>
          <label class="label" for="sn">Nazwa treningu</label>
          <input id="sn" v-model="newName" class="input" placeholder="np. Full body – sanki i landmine" v-focus />
        </div>
        <div>
          <label class="label" for="sc">Dla kogo</label>
          <select id="sc" v-model="singleClient" class="input">
            <option value="">Gotowiec – do użycia u różnych klientów</option>
            <option v-for="c in clients.all.filter((x) => !x.archived)" :key="c.id" :value="c.id">{{ c.full_name }}</option>
          </select>
          <p class="mt-1 text-xs text-muted">Pojedynczy trening przypiszesz do konkretnej sesji w grafiku (karta sesji → „Trening”).</p>
        </div>
        <button class="btn-primary w-full">Utwórz i otwórz</button>
      </form>

      <div v-if="programs.listLoaded && !list.length && !creating" class="card p-6 text-center text-sm text-muted">
        <template v-if="tab === 'templates'">
          Szablon to gotowy program (np. „Full body początkujący”, „Motoryka U12”), który przypisujesz klientom jednym kliknięciem.
        </template>
        <template v-else-if="tab === 'single'">Pojedynczy trening to jedna jednostka bez całego planu – np. trening próbny, zastępstwo albo jednorazowa sesja. Utwórz go przyciskiem „+ Trening” albo w generatorze.</template>
        <template v-else>Plany klientów tworzysz z karty klienta – z szablonu albo od zera.</template>
      </div>

      <ul class="space-y-2">
        <li v-for="p in list" :key="p.id">
          <RouterLink :to="`/plany/${p.id}`" class="card flex items-center justify-between gap-3 p-3">
            <div class="min-w-0">
              <p class="truncate font-medium">{{ p.name }}</p>
              <p class="truncate text-xs text-muted">
                <template v-if="p.kind === 'single'">{{ p.client_id ? clients.byId(p.client_id)?.full_name ?? '—' : 'gotowiec' }} · </template>
                <template v-else-if="!p.is_template">{{ clients.byId(p.client_id)?.full_name ?? '—' }} · </template>
                zmieniony {{ new Date(p.updated_at).toLocaleDateString('pl-PL') }}
              </p>
            </div>
            <span class="flex shrink-0 items-center gap-1">
              <span v-if="!p.is_template" class="tag">{{ label(STATUSES, p.status) }}</span>
              <Icon name="chevron" class="size-4 text-subtle" />
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>
