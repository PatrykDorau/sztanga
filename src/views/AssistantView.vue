<script setup lang="ts">
// Asystent nad danymi: pytania w języku naturalnym („kiedy Ania ostatnio robiła martwy ciąg i z jakim ciężarem?”).
// Claude ma tylko narzędzia do odczytu (klienci, historia, rekordy, frekwencja, ograniczenia) i działa uprawnieniami trenerki.
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { askAssistant, pieces, type ChatMessage } from '@/lib/ai'
import Icon from '@/components/Icon.vue'

const router = useRouter()
const KEY = 'assistant:chat'
const messages = ref<ChatMessage[]>([])
const input = ref('')
const busy = ref(false)
const error = ref('')
const list = ref<HTMLElement>()

onMounted(() => {
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

const EXAMPLES = [
  'Kiedy Ania ostatnio robiła martwy ciąg i z jakim ciężarem?',
  'Którzy klienci mają problem z kolanem?',
  'Ile sesji odbyło się w tym miesiącu i kto najczęściej odwoływał?',
  'Jakie rekordy ma Kuba?',
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
    const { answer } = await askAssistant(messages.value)
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
        <p class="text-sm text-muted">Pytaj o klientów, treningi, rekordy i frekwencję</p>
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
          <p class="card px-4 py-3 text-sm text-muted">Sprawdzam dane…</p>
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
