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
const tab = ref<'templates' | 'clients'>('templates')
const q = ref('')
const creating = ref(false)
const newName = ref('')
const newWeeks = ref(4)

onMounted(() => Promise.all([programs.loadList(), clients.load()]))

const list = computed(() =>
  programs.list
    .filter((p) => (tab.value === 'templates' ? p.is_template : !p.is_template))
    .filter((p) => matches(q.value, p.name, clients.byId(p.client_id)?.full_name)),
)

async function create() {
  if (!newName.value.trim()) return
  const p = await programs.create({ name: newName.value.trim(), is_template: true }, Math.max(1, Math.min(52, newWeeks.value)))
  router.push(`/plany/${p.id}`)
}
</script>

<template>
  <main>
    <header class="sticky top-0 z-10 space-y-3 bg-stone-50/95 px-4 pt-6 pb-3 backdrop-blur dark:bg-stone-950/95">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Plany</h1>
        <button v-if="tab === 'templates'" class="btn-primary" @click="creating = !creating"><Icon name="plus" class="size-5" />Szablon</button>
      </div>
      <div class="grid grid-cols-2 rounded-xl bg-stone-200 p-1 dark:bg-stone-800">
        <button class="rounded-lg py-2 text-sm font-medium" :class="tab === 'templates' ? 'bg-white shadow dark:bg-stone-950' : 'text-stone-600 dark:text-stone-400'" @click="tab = 'templates'">Szablony</button>
        <button class="rounded-lg py-2 text-sm font-medium" :class="tab === 'clients' ? 'bg-white shadow dark:bg-stone-950' : 'text-stone-600 dark:text-stone-400'" @click="tab = 'clients'">Plany klientów</button>
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
          <p class="mt-1 text-xs text-stone-500">Możesz też zacząć od 1 tygodnia i kopiować go z progresją.</p>
        </div>
        <button class="btn-primary w-full">Utwórz i otwórz</button>
      </form>

      <div v-if="programs.listLoaded && !list.length && !creating" class="card p-6 text-center text-sm text-stone-500">
        <template v-if="tab === 'templates'">
          Szablon to gotowy program (np. „Full body początkujący”, „Motoryka U12”), który przypisujesz klientom jednym kliknięciem.
        </template>
        <template v-else>Plany klientów tworzysz z karty klienta – z szablonu albo od zera.</template>
      </div>

      <ul class="space-y-2">
        <li v-for="p in list" :key="p.id">
          <RouterLink :to="`/plany/${p.id}`" class="card flex items-center justify-between gap-3 p-3">
            <div class="min-w-0">
              <p class="truncate font-medium">{{ p.name }}</p>
              <p class="truncate text-xs text-stone-500">
                <template v-if="!p.is_template">{{ clients.byId(p.client_id)?.full_name ?? '—' }} · </template>
                zmieniony {{ new Date(p.updated_at).toLocaleDateString('pl-PL') }}
              </p>
            </div>
            <span v-if="!p.is_template" class="tag">{{ label(STATUSES, p.status) }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>
