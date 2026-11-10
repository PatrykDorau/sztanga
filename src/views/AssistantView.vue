<script setup lang="ts">
// Asystent nad danymi: pytania w języku naturalnym („kiedy Ania ostatnio robiła martwy ciąg i z jakim ciężarem?”).
// Claude ma tylko narzędzia do odczytu (klienci, plan, historia, rekordy, grafik, frekwencja, analizy ruchu, baza ćwiczeń) i działa uprawnieniami trenerki.
// Otwarty z karty klienta (?client=id) albo z analizy ruchu (?analysis=id) wie, o kim / o czym jest rozmowa.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { askAssistant, pieces, type ChatContext, type ChatMessage } from '@/lib/ai'
import { useClientsStore } from '@/stores/clients'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const route = useRoute()
const clients = useClientsStore()
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const context: ChatContext = {
  client_id: isId(route.query.client) ? route.query.client : null,
  analysis_id: isId(route.query.analysis) ? route.query.analysis : null,
}
const client = computed(() => (context.client_id ? clients.byId(context.client_id) : undefined))
const contextLabel = computed(() => (context.analysis_id ? 'Rozmowa o analizie ruchu' : context.client_id ? `Rozmowa o: ${client.value?.full_name ?? 'kliencie'}` : ''))
// Osobna rozmowa na każdy kontekst – pytania o Anię nie mieszają się z rozmową ogólną.
const KEY = `assistant:chat:${context.analysis_id ?? context.client_id ?? ''}`
const messages = ref<ChatMessage[]>([])
const input = ref('')
const busy = ref(false)
const error = ref('')
const list = ref<HTMLElement>()

onMounted(() => {
  if (context.client_id) clients.load()
  try {
    messages.value = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
  } catch {
    messages.value = []
  }
  scroll()
})
watch(
  messages,
  (m) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(m.slice(-30)))
    } catch {
      // brak pamięci sesji – rozmowa po prostu nie przetrwa odświeżenia
    }
  },
  { deep: true },
)

const EXAMPLES = context.analysis_id
  ? [
      'Omów tę analizę: co poprawić w pierwszej kolejności i co powiedzieć klientowi?',
      'Zaproponuj ćwiczenia korekcyjne z mojej bazy do tych błędów.',
      'Porównaj tę analizę z poprzednimi nagraniami tej osoby – jest postęp?',
    ]
  : context.client_id
    ? [
        'Podsumuj ostatnie 4 tygodnie: frekwencja, postępy w ciężarach, rekordy.',
        'Co wychodzi z analiz ruchu i nad czym pracować na najbliższych treningach?',
        'Co jest w aktualnym planie i gdzie warto dołożyć progresję?',
        'Przygotuj krótkie podsumowanie postępów, które mogę wysłać klientowi.',
      ]
    : [
        'Kogo mam dziś i jutro w grafiku?',
        'Kiedy Ania ostatnio robiła martwy ciąg i z jakim ciężarem?',
        'Którzy klienci mają problem z kolanem?',
        'Ile sesji odbyło się w tym miesiącu i kto najczęściej odwoływał?',
        'U kogo ostatnie analizy ruchu pokazały koślawienie kolan?',
      ]

async function send(text = input.value) {
  const q = text.trim()
  if (!q || busy.value) return
  input.value = ''
  error.value = ''
  messages.value.push({ role: 'user', content: q })
  scroll()
  busy.value = true
  try {
    const { answer } = await askAssistant(messages.value, context)
    messages.value.push({ role: 'assistant', content: answer })
  } catch (e) {
    error.value = (e as Error).message
    messages.value.pop()
    input.value = q
  } finally {
    busy.value = false
    scroll()
  }
}
function scroll() {
  nextTick(() => list.value?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' }))
}
function reset() {
  messages.value = []
  error.value = ''
}
</script>

<template>
  <main class="flex min-h-dvh flex-col pb-40">
    <header class="page-header flex items-center gap-1 px-2 pb-2">
      <button class="icon-btn" aria-label="Wróć" @click="router.back()"><Icon name="back" class="size-6" /></button>
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-bold">Asystent</h1>
        <p class="truncate text-sm text-muted">{{ contextLabel || 'Pytaj o klientów, plany, grafik, rekordy i technikę' }}</p>
      </div>
      <button v-if="messages.length" class="icon-btn" aria-label="Nowa rozmowa" @click="reset"><Icon name="trash" class="size-5" /></button>
    </header>

    <div class="flex-1 space-y-3 px-4">
      <div v-if="!messages.length" class="space-y-2">
        <p class="text-sm text-muted">Na przykład:</p>
        <button v-for="e in EXAMPLES" :key="e" class="card pressable block w-full p-3 text-left text-sm hover:bg-surface-2" @click="send(e)">{{ e }}</button>
      </div>
      <ul ref="list" class="space-y-3" aria-live="polite">
        <li v-for="(m, i) in messages" :key="i" class="flex" :class="m.role === 'user' ? 'justify-end' : ''">
          <p v-if="m.role === 'user'" class="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-on-primary">{{ m.content }}</p>
          <div v-else class="card max-w-[92%] rounded-bl-md px-4 py-3 text-sm leading-relaxed">
            <template v-for="(p, k) in pieces(m.content)" :key="k">
              <br v-if="p.kind === 'br'" />
              <RouterLink v-else-if="p.kind === 'link'" :to="p.to" class="font-semibold text-primary-fg underline underline-offset-2">{{ p.text }}</RouterLink>
              <strong v-else-if="p.kind === 'bold'">{{ p.text }}</strong>
              <template v-else>{{ p.text }}</template>
            </template>
          </div>
        </li>
        <li v-if="busy" class="flex">
          <p class="card animate-pulse px-4 py-3 text-sm text-muted">Sprawdzam dane… zwykle 10–30 s</p>
        </li>
      </ul>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    </div>

    <form
      class="fixed inset-x-0 z-20 mx-auto flex max-w-2xl gap-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur"
      style="bottom: calc(4rem + env(safe-area-inset-bottom))"
      @submit.prevent="send()"
    >
      <label class="sr-only" for="q">Pytanie</label>
      <input id="q" v-model="input" class="input flex-1" placeholder="Zadaj pytanie…" autocomplete="off" :disabled="busy" />
      <button class="btn-primary px-4" :disabled="busy || !input.trim()" aria-label="Wyślij"><Icon name="chevron" class="size-5" /></button>
    </form>
  </main>
</template>
