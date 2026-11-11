<script setup lang="ts">
// Panel kredytów Anthropic w Profilu: szacowane saldo, zużycie wg funkcji i dni, aktualizacja salda z konsoli.
import { computed, onMounted, ref } from 'vue'
import { ACTION_LABEL, credits, loadCredits, remaining, remainingPct, setBalance, usd, type UsageRow } from '@/lib/credits'

const editing = ref(false)
const bal = ref('')
const top = ref('')
const busy = ref(false)
const error = ref('')
onMounted(() => loadCredits().catch((e) => (error.value = (e as Error).message)))

function startEdit() {
  bal.value = String(remaining.value ?? '').replace('.', ',')
  top.value = String(credits.value?.topup ?? 5).replace('.', ',')
  editing.value = true
}
async function save() {
  const b = Number(bal.value.replace(',', '.'))
  const t = Number(top.value.replace(',', '.'))
  if (!Number.isFinite(b) || b < 0 || !Number.isFinite(t) || t <= 0) {
    error.value = 'Wpisz saldo i kwotę doładowania jako liczby.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await setBalance(b, t)
    editing.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
const pct = computed(() => Math.round(Math.min(1, remainingPct.value ?? 0) * 100))
const tone = computed(() => (pct.value < 10 ? 'bg-danger' : pct.value < 30 ? 'bg-warn-fg' : 'bg-success'))
const byAction = computed(() => {
  const m = new Map<UsageRow['action'], { n: number; usd: number }>()
  for (const r of credits.value?.rows ?? []) {
    const x = m.get(r.action) ?? { n: 0, usd: 0 }
    x.n++
    x.usd += r.cost_usd
    m.set(r.action, x)
  }
  return [...m.entries()].sort((a, b) => b[1].usd - a[1].usd)
})
const avgAsk = computed(() => {
  const a = (credits.value?.rows ?? []).filter((r) => r.action === 'ask')
  return a.length ? a.reduce((s, r) => s + r.cost_usd, 0) / a.length : null
})
const since = computed(() => (credits.value?.at ? new Date(credits.value.at).toLocaleString('pl-PL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null))
</script>

<template>
  <section class="card space-y-3 p-4 text-sm">
    <p class="label">Kredyty Anthropic (AI)</p>
    <template v-if="credits && credits.balance != null">
      <div class="flex items-end justify-between gap-2">
        <div>
          <p class="font-display text-3xl leading-none font-bold tabular-nums">{{ usd(remaining) }}</p>
          <p class="mt-1 text-xs text-muted">szacowane saldo · {{ pct }}% doładowania {{ usd(credits.topup, 0) }}</p>
        </div>
        <button class="btn-ghost !min-h-9 border border-line-strong text-sm" @click="startEdit">Aktualizuj saldo</button>
      </div>
      <div class="h-2.5 overflow-hidden rounded-full bg-surface-2" role="meter" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" aria-label="Pozostałe kredyty">
        <div class="h-full rounded-full" :class="tone" :style="{ width: `${pct}%` }" />
      </div>
      <p v-if="pct < 10" class="warn-box">Zostało mniej niż 10% kredytów – doładuj konto w konsoli Anthropic, inaczej asystent i generator AI przestaną działać.</p>
      <p class="text-muted">
        Wydane od {{ since }}: <strong class="text-fg">{{ usd(credits.spent, 3) }}</strong> ({{ credits.rows.length }} wywołań)<template v-if="avgAsk != null"> · pytanie do asystenta średnio {{ usd(avgAsk, 3) }}</template>
      </p>
      <ul v-if="byAction.length" class="space-y-1">
        <li v-for="[a, x] in byAction" :key="a" class="flex justify-between gap-2">
          <span>{{ ACTION_LABEL[a] }} <span class="text-muted">· {{ x.n }}×</span></span>
          <span class="tabular-nums">{{ usd(x.usd, 3) }}</span>
        </li>
      </ul>
    </template>
    <p v-else-if="credits" class="text-muted">Wpisz saldo z konsoli Anthropic, żeby śledzić, ile zostało.</p>

    <form v-if="editing || (credits && credits.balance == null)" class="grid grid-cols-2 gap-2 border-t border-line pt-3" @submit.prevent="save">
      <label><span class="label">Saldo teraz (USD)</span><input v-model="bal" inputmode="decimal" class="input" placeholder="np. 3,73" /></label>
      <label><span class="label">Doładowanie (USD)</span><input v-model="top" inputmode="decimal" class="input" placeholder="np. 5" /></label>
      <button class="btn-primary col-span-2" :disabled="busy">Zapisz saldo</button>
    </form>
    <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
    <p class="text-xs text-muted">
      Anthropic nie udostępnia salda przez klucz API – liczymy je sami: saldo wpisane z konsoli minus koszt każdego wywołania (z liczby tokenów i cennika). Dokładne saldo:
      <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener" class="underline">konsola Anthropic → Billing</a>.
    </p>
  </section>
</template>
