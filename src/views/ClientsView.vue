<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { GROUPS, label } from '@/lib/vocab'
import { matches } from '@/lib/search'
import Icon from '@/components/Icon.vue'

const clients = useClientsStore()
const programs = useProgramsStore()
const q = ref('')
const group = ref<string | null>(null)
const showArchived = ref(false)

onMounted(() => Promise.all([clients.load(), programs.loadList()]))

const activeProgram = (clientId: string) =>
  programs.list.find((p) => p.client_id === clientId && p.status === 'active') ??
  programs.list.find((p) => p.client_id === clientId && p.status === 'draft')

const results = computed(() =>
  clients.all.filter(
    (c) =>
      c.archived === showArchived.value &&
      (!group.value || c.client_group === group.value) &&
      matches(q.value, c.full_name, c.email, c.goals),
  ),
)
const initials = (n: string) => n.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()
</script>

<template>
  <main>
    <header class="sticky top-0 z-10 space-y-3 bg-stone-50/95 px-4 pt-6 pb-3 backdrop-blur dark:bg-stone-950/95">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Klienci</h1>
        <RouterLink to="/klienci/nowy" class="btn-primary"><Icon name="plus" class="size-5" />Dodaj</RouterLink>
      </div>
      <input v-model="q" type="search" class="input" placeholder="Szukaj klienta…" />
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        <button :class="!group ? 'chip-on' : 'chip-off'" @click="group = null">Wszyscy</button>
        <button v-for="(l, k) in GROUPS" :key="k" :class="group === k ? 'chip-on' : 'chip-off'" @click="group = String(k)">{{ l }}</button>
        <button :class="showArchived ? 'chip-on' : 'chip-off'" @click="showArchived = !showArchived">Archiwum</button>
      </div>
    </header>

    <section class="px-4">
      <div v-if="clients.loaded && !clients.all.length" class="card p-6 text-center">
        <p class="mb-1 font-semibold">Nie masz jeszcze klientów</p>
        <p class="mb-4 text-sm text-stone-500">Dodaj klienta, żeby przypisać mu plan.</p>
        <RouterLink to="/klienci/nowy" class="btn-primary">Dodaj pierwszego klienta</RouterLink>
      </div>
      <p v-else-if="clients.loaded && !results.length" class="py-10 text-center text-stone-500">Brak klientów do pokazania.</p>
      <ul class="space-y-2">
        <li v-for="c in results" :key="c.id">
          <RouterLink :to="`/klienci/${c.id}`" class="card flex items-center gap-3 p-3">
            <span class="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-900 dark:bg-brand-900/50 dark:text-brand-100">
              {{ initials(c.full_name) }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ c.full_name }}</p>
              <p class="truncate text-xs text-stone-500">
                {{ label(GROUPS, c.client_group) }} · {{ activeProgram(c.id)?.name ?? 'brak planu' }}
              </p>
            </div>
            <Icon v-if="c.limitations.length" name="alert" class="size-4 text-amber-500" />
          </RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>
