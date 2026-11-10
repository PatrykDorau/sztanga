<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useClientsStore } from '@/stores/clients'
import { useProgramsStore } from '@/stores/programs'
import { CONTRAINDICATIONS, EQUIPMENT, GROUPS, STATUSES, label } from '@/lib/vocab'
import AssignProgramDialog from '@/components/AssignProgramDialog.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ id: string }>()
const clients = useClientsStore()
const programs = useProgramsStore()
const router = useRouter()
const assigning = ref(false)

onMounted(() => Promise.all([clients.load(), programs.loadList()]))
const c = computed(() => clients.byId(props.id))
const plans = computed(() => programs.list.filter((p) => p.client_id === props.id))
const age = computed(() => {
  if (!c.value?.birth_date) return null
  const b = new Date(c.value.birth_date)
  const n = new Date()
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0)
})

async function newPlan() {
  const p = await programs.create({ name: `Plan – ${c.value!.full_name}`, client_id: props.id, start_date: null }, 1)
  router.push(`/plany/${p.id}`)
}
</script>

<template>
  <main v-if="c" class="pb-6">
    <header class="flex items-center gap-1 px-2 pt-4">
      <button class="p-2" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="min-w-0 flex-1 truncate text-lg font-bold">{{ c.full_name }}</h1>
      <RouterLink :to="`/klienci/${c.id}/edycja`" class="p-2" aria-label="Edytuj"><Icon name="edit" class="size-6" /></RouterLink>
    </header>

    <div class="space-y-4 px-4">
      <div class="flex flex-wrap gap-1.5">
        <span class="tag">{{ label(GROUPS, c.client_group) }}</span>
        <span v-if="age !== null" class="tag">{{ age }} lat</span>
        <span v-if="c.archived" class="tag">Archiwum</span>
      </div>

      <section class="card space-y-3 p-4 text-sm">
        <div v-if="c.goals">
          <p class="text-xs font-medium tracking-wide text-stone-500 uppercase">Cele</p>
          <p class="whitespace-pre-line">{{ c.goals }}</p>
        </div>
        <div v-if="c.limitations.length" class="flex gap-2 rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Icon name="alert" class="size-5 shrink-0" />
          <p><strong>Ograniczenia:</strong> {{ c.limitations.map((x) => label(CONTRAINDICATIONS, x)).join(', ') }}</p>
        </div>
        <div v-if="c.equipment.length">
          <p class="text-xs font-medium tracking-wide text-stone-500 uppercase">Sprzęt</p>
          <p>{{ c.equipment.map((x) => label(EQUIPMENT, x)).join(', ') }}</p>
        </div>
        <div v-if="c.notes">
          <p class="text-xs font-medium tracking-wide text-stone-500 uppercase">Notatki</p>
          <p class="whitespace-pre-line">{{ c.notes }}</p>
        </div>
        <p v-if="c.email || c.phone" class="text-stone-500">{{ [c.email, c.phone].filter(Boolean).join(' · ') }}</p>
        <p v-if="!c.goals && !c.limitations.length && !c.notes" class="text-stone-500">
          Uzupełnij cele i ograniczenia – kreator planu z nich korzysta.
        </p>
      </section>

      <section>
        <div class="mb-2 flex items-center justify-between">
          <h2 class="font-semibold">Plany</h2>
        </div>
        <ul v-if="plans.length" class="mb-3 space-y-2">
          <li v-for="p in plans" :key="p.id">
            <RouterLink :to="`/plany/${p.id}`" class="card flex items-center justify-between gap-3 p-3">
              <div class="min-w-0">
                <p class="truncate font-medium">{{ p.name }}</p>
                <p class="text-xs text-stone-500">{{ p.start_date ? `od ${new Date(p.start_date).toLocaleDateString('pl-PL')}` : 'bez daty startu' }}</p>
              </div>
              <span class="tag" :class="p.status === 'active' ? '!bg-brand-100 !text-brand-900 dark:!bg-brand-900/50 dark:!text-brand-100' : ''">{{ label(STATUSES, p.status) }}</span>
            </RouterLink>
          </li>
        </ul>
        <div class="grid grid-cols-2 gap-2">
          <button class="btn-primary" @click="assigning = true">Z szablonu</button>
          <button class="btn-ghost" @click="newPlan"><Icon name="plus" class="size-4" />Od zera</button>
        </div>
      </section>
    </div>

    <AssignProgramDialog v-if="assigning" :client-id="c.id" @close="assigning = false" @done="(id) => router.push(`/plany/${id}`)" />
  </main>
  <main v-else class="px-4 pt-10 text-center text-stone-500">{{ clients.loaded ? 'Nie znaleziono klienta.' : 'Ładowanie…' }}</main>
</template>
