<script setup lang="ts">
// Link bez konta (ankieta gotowości / raport dla rodzica): utwórz, skopiuj, udostępnij, wyłącz.
import { onMounted, ref } from 'vue'
import { useSportStore, type ClientLink } from '@/stores/sport'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ clientId: string; purpose: ClientLink['purpose']; title: string; hint: string; shareText: string }>()
const sport = useSportStore()
const link = ref<ClientLink | null>(null)
const busy = ref(false)
const copied = ref(false)
const error = ref('')

onMounted(async () => (link.value = await sport.link(props.clientId, props.purpose).catch(() => null)))

async function create() {
  busy.value = true
  error.value = ''
  try {
    link.value = await sport.link(props.clientId, props.purpose, true)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function share() {
  if (!link.value) return
  const url = sport.linkUrl(link.value)
  if (navigator.share) {
    await navigator.share({ title: props.title, text: props.shareText, url }).catch(() => null)
    return
  }
  await navigator.clipboard.writeText(url)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
async function revoke() {
  if (!link.value || !confirm('Wyłączyć link? Stary link przestanie działać – możesz potem utworzyć nowy.')) return
  await sport.revokeLink(link.value.id)
  link.value = null
}
</script>

<template>
  <div class="card space-y-2 p-4 text-sm">
    <p class="font-semibold">{{ title }}</p>
    <p class="text-muted">{{ hint }}</p>
    <template v-if="link">
      <p class="truncate rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs">{{ sport.linkUrl(link) }}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="chip border-line-strong bg-surface" @click="share"><Icon name="share" class="size-4" />{{ copied ? 'Skopiowano' : 'Wyślij / kopiuj' }}</button>
        <a :href="sport.linkUrl(link)" target="_blank" rel="noopener" class="chip border-line-strong bg-surface">Otwórz</a>
        <button type="button" class="chip border-line-strong bg-surface text-danger" @click="revoke">Wyłącz link</button>
      </div>
    </template>
    <button v-else type="button" class="btn-ghost w-full border border-line-strong" :disabled="busy" @click="create">{{ busy ? 'Tworzenie…' : 'Utwórz link' }}</button>
    <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
  </div>
</template>
