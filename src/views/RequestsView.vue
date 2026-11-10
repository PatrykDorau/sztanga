<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '@/stores/schedule'
import type { ConsultationRequest } from '@/types'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const schedule = useScheduleStore()
const error = ref('')
const copied = ref(false)
const link = `${window.location.origin}/konsultacja`

onMounted(() => schedule.loadRequests().catch((e) => (error.value = e.message)))

const STATUS: Record<ConsultationRequest['status'], string> = { new: 'Nowe', contacted: 'Kontakt', converted: 'Klient', rejected: 'Odrzucone' }
const open = computed(() => schedule.requests.filter((r) => r.status === 'new' || r.status === 'contacted'))
const closed = computed(() => schedule.requests.filter((r) => r.status === 'converted' || r.status === 'rejected'))

async function copy() {
  try {
    await navigator.clipboard.writeText(link)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    error.value = 'Nie udało się skopiować – zaznacz link ręcznie.'
  }
}

function toClient(r: ConsultationRequest) {
  router.push({ path: '/klienci/nowy', query: { name: r.full_name, email: r.email ?? '', phone: r.phone ?? '', notes: r.message ?? '', req: r.id } })
}
</script>

<template>
  <main class="pb-8">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <h1 class="text-2xl font-bold">Zgłoszenia</h1>
    </header>
    <div class="space-y-5 px-4">
      <section class="card space-y-2 p-4">
        <p class="font-semibold">Link dla nowych klientów</p>
        <p class="text-sm text-muted">Wyślij go np. na Messengerze – osoba zostawia kontakt bez zakładania konta.</p>
        <div class="flex gap-2">
          <input :value="link" readonly class="input flex-1 text-sm" aria-label="Link do formularza konsultacji" @focus="($event.target as HTMLInputElement).select()" />
          <button class="btn-primary" @click="copy">{{ copied ? 'Skopiowano' : 'Kopiuj' }}</button>
        </div>
      </section>

      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <p v-if="!schedule.requests.length" class="text-center text-muted">Brak zgłoszeń.</p>

      <ul class="space-y-2">
        <li v-for="r in [...open, ...closed]" :key="r.id" class="card space-y-2 p-4" :class="closed.includes(r) ? 'opacity-70' : ''">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-semibold">{{ r.full_name }}</p>
              <p class="text-sm text-muted">{{ new Date(r.created_at).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }) }}</p>
            </div>
            <span class="tag" :class="r.status === 'new' ? '!bg-primary-soft !text-primary-fg' : ''">{{ STATUS[r.status] }}</span>
          </div>
          <div class="flex flex-wrap gap-2 text-sm">
            <a v-if="r.phone" :href="`tel:${r.phone}`" class="btn-ghost !min-h-10">{{ r.phone }}</a>
            <a v-if="r.email" :href="`mailto:${r.email}`" class="btn-ghost !min-h-10 max-w-full truncate">{{ r.email }}</a>
          </div>
          <p v-if="r.preferred_at" class="text-sm">Preferuje: <strong>{{ new Date(r.preferred_at).toLocaleString('pl-PL', { dateStyle: 'full', timeStyle: 'short' }) }}</strong></p>
          <p v-if="r.message" class="text-sm whitespace-pre-line">{{ r.message }}</p>
          <div v-if="r.status === 'new' || r.status === 'contacted'" class="grid grid-cols-3 gap-2 pt-1">
            <button v-if="r.status === 'new'" class="btn-ghost !px-2 text-sm" @click="schedule.setRequestStatus(r.id, 'contacted')">Kontakt</button>
            <button class="btn-primary !px-2 text-sm" :class="r.status !== 'new' ? 'col-span-2' : ''" @click="toClient(r)">Dodaj klienta</button>
            <button class="btn-ghost !px-2 text-sm" @click="schedule.setRequestStatus(r.id, 'rejected')">Odrzuć</button>
          </div>
        </li>
      </ul>
    </div>
  </main>
</template>
