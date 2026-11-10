<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import { useClientsStore } from '@/stores/clients'
import { useCalendarStore } from '@/stores/calendar'
import { splitTitle } from '../../supabase/functions/_shared/titles'
import { CONTRAINDICATIONS, EQUIPMENT, GROUPS } from '@/lib/vocab'
import type { ClientGroup } from '@/types'
import ChipSelect from '@/components/ChipSelect.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ id?: string }>()
const clients = useClientsStore()
const router = useRouter()
const route = useRoute()
const schedule = useScheduleStore()
const calendar = useCalendarStore()

const form = reactive({
  full_name: '',
  email: '',
  phone: '',
  group: ['amateur'] as string[],
  birth_date: '',
  goals: '',
  limitations: [] as string[],
  equipment: [] as string[],
  notes: '',
  archived: false,
  gym_id: '' as string,
})
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  await clients.load()
  const c = clients.byId(props.id)
  if (!c) {
    // Nowy klient ze zgłoszenia na konsultację – dane pobierane z bazy po id (nie z adresu URL).
    if (route.query.req) {
      if (!schedule.requests.length) await schedule.loadRequests().catch(() => null)
      const r = schedule.requests.find((x) => x.id === route.query.req)
      if (r) Object.assign(form, { full_name: r.full_name, email: r.email ?? '', phone: r.phone ?? '', notes: r.message ?? '' })
    }
    // Nowy klient z wydarzenia w Google Calendar (lista "Do przypisania").
    if (calendar.pendingAlias) form.full_name = splitTitle(calendar.pendingAlias).base
    return
  }
  Object.assign(form, {
    full_name: c.full_name,
    email: c.email ?? '',
    phone: c.phone ?? '',
    group: [c.client_group],
    birth_date: c.birth_date ?? '',
    goals: c.goals ?? '',
    limitations: [...c.limitations],
    equipment: [...c.equipment],
    notes: c.notes ?? '',
    archived: c.archived,
    gym_id: c.gym_id ?? '',
  })
})

async function submit() {
  busy.value = true
  error.value = ''
  try {
    const c = await clients.save(
      {
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        client_group: (form.group[0] ?? 'amateur') as ClientGroup,
        birth_date: form.birth_date || null,
        goals: form.goals.trim() || null,
        limitations: form.limitations,
        equipment: form.equipment,
        notes: form.notes.trim() || null,
        archived: form.archived,
        gym_id: form.gym_id || null,
      },
      props.id,
    )
    if (route.query.req) await schedule.setRequestStatus(String(route.query.req), 'converted').catch(() => null)
    if (calendar.pendingAlias && !props.id) {
      // Tytuł z kalendarza (np. "Zuzanna Kocur 2os") wskazuje teraz na nowego klienta – import go podłączy.
      const alias = calendar.pendingAlias
      calendar.pendingAlias = null
      await calendar.assign(alias, c.id).catch(() => null)
    }
    router.replace(`/klienci/${c.id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.id || !confirm('Usunąć klienta razem z jego planami? Tego nie da się cofnąć. Jeśli tylko skończyliście współpracę, użyj archiwum.')) return
  await clients.remove(props.id)
  router.replace('/klienci')
}
</script>

<template>
  <main class="pb-6">
    <header class="flex items-center gap-1 px-2 pt-4">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-lg font-bold">{{ id ? 'Edytuj klienta' : 'Nowy klient' }}</h1>
    </header>
    <form class="space-y-5 px-4" @submit.prevent="submit">
      <div>
        <label class="label" for="n">Imię i nazwisko</label>
        <input id="n" v-model="form.full_name" class="input" required />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label" for="e">E-mail</label>
          <input id="e" v-model="form.email" type="email" class="input" />
        </div>
        <div>
          <label class="label" for="p">Telefon</label>
          <input id="p" v-model="form.phone" type="tel" class="input" />
        </div>
      </div>
      <div>
        <p class="label">Grupa</p>
        <ChipSelect v-model="form.group" :options="GROUPS" single />
      </div>
      <div v-if="calendar.gyms.length">
        <label class="label" for="gym">Siłownia</label>
        <select id="gym" v-model="form.gym_id" class="input">
          <option value="">—</option>
          <option v-for="g in calendar.gyms" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
      </div>
      <div>
        <label class="label" for="b">Data urodzenia</label>
        <input id="b" v-model="form.birth_date" type="date" class="input" />
      </div>
      <div>
        <label class="label" for="g">Cele</label>
        <textarea id="g" v-model="form.goals" rows="3" class="input py-2" placeholder="np. siła, redukcja, powrót po kontuzji kolana" />
      </div>
      <div>
        <p class="label">Ograniczenia / kontuzje</p>
        <ChipSelect v-model="form.limitations" :options="CONTRAINDICATIONS" />
        <p class="mt-1 text-xs text-muted">Kreator ostrzeże, gdy dodasz ćwiczenie z pasującym przeciwwskazaniem.</p>
      </div>
      <div>
        <p class="label">Dostępny sprzęt</p>
        <ChipSelect v-model="form.equipment" :options="EQUIPMENT" />
      </div>
      <div>
        <label class="label" for="no">Notatki</label>
        <textarea id="no" v-model="form.notes" rows="3" class="input py-2" />
      </div>
      <label v-if="id" class="flex items-center gap-2 text-sm">
        <input v-model="form.archived" type="checkbox" class="size-5 accent-primary" /> Klient w archiwum
      </label>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy">{{ id ? 'Zapisz' : 'Dodaj klienta' }}</button>
      <button v-if="id" type="button" class="btn-danger w-full" @click="remove"><Icon name="trash" class="size-4" />Usuń klienta</button>
    </form>
  </main>
</template>
