<script setup lang="ts">
// Frekwencja klienta z grafiku: odbyte, nieobecności (oznaczone w grafiku jako „nie przyszedł”) i odwołane – ostatnie 6 miesięcy.
import { computed, onMounted, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ clientId: string; compact?: boolean }>()
interface Row {
  id: string
  starts_at: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  cancel_reason: string | null
}
const rows = ref<Row[]>([])
const loaded = ref(false)

async function load() {
  const since = new Date(Date.now() - 183 * 864e5).toISOString()
  const { data } = await supabase
    .from('sessions')
    .select('id, starts_at, status, cancel_reason')
    .eq('client_id', props.clientId)
    .gte('starts_at', since)
    .lt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: false })
  rows.value = (data ?? []) as Row[]
  loaded.value = true
}
onMounted(load)
watch(() => props.clientId, load)

const done = computed(() => rows.value.filter((r) => r.status === 'completed' || r.status === 'confirmed').length)
const noShow = computed(() => rows.value.filter((r) => r.status === 'no_show'))
const cancelled = computed(() => rows.value.filter((r) => r.status === 'cancelled'))
const rate = computed(() => {
  const all = done.value + noShow.value.length
  return all ? Math.round((done.value / all) * 100) : null
})
const date = (d: string) => new Date(d).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })
const hour = (d: string) => new Date(d).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
defineExpose({ load })
</script>

<template>
  <section v-if="loaded" class="space-y-2">
    <h2 class="text-xl font-bold">Frekwencja <span class="text-sm font-normal text-muted">(6 mies.)</span></h2>
    <div class="grid grid-cols-3 gap-2">
      <div class="card p-3">
        <p class="font-display text-3xl leading-none font-bold tabular-nums">{{ done }}</p>
        <p class="mt-1 text-xs text-muted">obecności{{ rate != null ? ` · ${rate}%` : '' }}</p>
      </div>
      <div class="card p-3" :class="noShow.length ? 'border-danger/50' : ''">
        <p class="font-display text-3xl leading-none font-bold tabular-nums" :class="noShow.length ? 'text-danger' : ''">{{ noShow.length }}</p>
        <p class="mt-1 text-xs text-muted">nie przyszedł(a)</p>
      </div>
      <div class="card p-3">
        <p class="font-display text-3xl leading-none font-bold tabular-nums">{{ cancelled.length }}</p>
        <p class="mt-1 text-xs text-muted">odwołane</p>
      </div>
    </div>
    <ul v-if="noShow.length && !compact" class="space-y-1 text-sm">
      <li v-for="r in noShow.slice(0, 6)" :key="r.id" class="flex items-center gap-2">
        <Icon name="x" class="size-4 shrink-0 text-danger" />
        <span>Nieobecność: {{ date(r.starts_at) }}, {{ hour(r.starts_at) }}</span>
      </li>
    </ul>
    <p v-else-if="!rows.length" class="text-sm text-muted">Brak sesji w grafiku w ostatnich 6 miesiącach.</p>
  </section>
</template>
