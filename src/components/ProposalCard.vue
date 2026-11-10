<script setup lang="ts">
// Karta propozycji asystenta: stan przed → po. "Zastosuj…" otwiera okno z pełną listą zmian,
// dopiero "Potwierdzam – zapisz" zapisuje (dwa kliknięcia). Po zapisie: "Cofnij".
import { ref } from 'vue'
import { applyProposal, describe, undoProposal, type Proposal } from '@/lib/planActions'
import { STATUSES, label } from '@/lib/vocab'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ proposal: Proposal }>()
const emit = defineEmits<{ state: [s: NonNullable<Proposal['state']>] }>()

const confirming = ref(false)
const busy = ref(false)
const error = ref('')
const KIND = { update: 'Zmiana', swap: 'Zamiana', add: 'Dodanie', remove: 'Usunięcie' } as const

async function run(fn: (p: Proposal) => Promise<void>, next: NonNullable<Proposal['state']>) {
  busy.value = true
  error.value = ''
  try {
    await fn(props.proposal)
    confirming.value = false
    emit('state', next)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="card space-y-3 border-primary/40 p-4 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <span class="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold tracking-wide text-primary-fg uppercase">Propozycja zmian</span>
      <RouterLink :to="`/plany/${proposal.program.id}`" class="min-w-0 truncate font-semibold underline underline-offset-2">{{ proposal.program.name }}</RouterLink>
      <span class="tag">{{ proposal.program.is_template ? 'Szablon' : label(STATUSES, proposal.program.status) }}</span>
    </div>
    <p v-if="proposal.summary">{{ proposal.summary }}</p>

    <ul class="space-y-2">
      <li v-for="(c, i) in proposal.changes" :key="i" class="rounded-xl bg-surface-2 p-3">
        <p class="text-xs text-muted">{{ KIND[c.type] }} · {{ c.where }}</p>
        <p class="font-semibold" :class="c.type === 'remove' ? 'line-through' : ''">{{ c.exercise }}</p>
        <p class="tabular-nums">{{ describe(c) }}</p>
        <p v-if="c.reason" class="mt-1 text-xs text-muted">{{ c.reason }}</p>
      </li>
    </ul>

    <p v-if="error && !confirming" class="text-danger" role="alert">{{ error }}</p>
    <div v-if="!proposal.state || proposal.state === 'pending'" class="grid grid-cols-2 gap-2">
      <button type="button" class="btn-ghost border border-line-strong" @click="emit('state', 'rejected')">Odrzuć</button>
      <button type="button" class="btn-primary" @click="((error = ''), (confirming = true))">Zastosuj…</button>
    </div>
    <div v-else-if="proposal.state === 'applied'" class="flex flex-wrap items-center gap-3">
      <span class="flex items-center gap-1.5 font-semibold text-success"><Icon name="check" class="size-4" />Zapisano w planie</span>
      <button type="button" class="chip border-line-strong bg-surface" :disabled="busy" @click="run(undoProposal, 'undone')">{{ busy ? 'Cofanie…' : 'Cofnij' }}</button>
      <RouterLink :to="`/plany/${proposal.program.id}`" class="chip border-line-strong bg-surface">Otwórz plan</RouterLink>
    </div>
    <p v-else class="text-muted">{{ proposal.state === 'undone' ? 'Cofnięto – plan jest taki jak przed zmianą.' : 'Odrzucono – nic nie zostało zmienione.' }}</p>

    <!-- Drugie potwierdzenie -->
    <Teleport to="body">
      <div v-if="confirming" class="fixed inset-0 z-[60] flex items-end bg-scrim sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="pc-h" @click.self="!busy && (confirming = false)" @keydown.esc="!busy && (confirming = false)">
        <div class="sheet space-y-4 sm:max-w-md">
          <h2 id="pc-h" class="text-lg font-semibold">Zapisać zmiany w planie?</h2>
          <p class="text-sm">
            Plan: <strong>{{ proposal.program.name }}</strong> · {{ proposal.changes.length }} {{ proposal.changes.length === 1 ? 'zmiana' : proposal.changes.length < 5 ? 'zmiany' : 'zmian' }}
          </p>
          <ul class="max-h-[40vh] space-y-1.5 overflow-y-auto text-sm">
            <li v-for="(c, i) in proposal.changes" :key="i">
              <span class="text-muted">{{ c.where }} ·</span> <strong>{{ c.exercise }}</strong
              ><br /><span class="tabular-nums">{{ describe(c) }}</span>
            </li>
          </ul>
          <p v-if="proposal.program.status === 'active' && !proposal.program.is_template" class="warn-box text-sm">
            <Icon name="alert" class="size-5 shrink-0" />Plan jest aktywny – klient zobaczy zmiany od razu.
          </p>
          <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn-ghost border border-line-strong" :disabled="busy" @click="confirming = false">Anuluj</button>
            <button type="button" class="btn-primary" :disabled="busy" @click="run(applyProposal, 'applied')">{{ busy ? 'Zapisywanie…' : 'Potwierdzam – zapisz' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
