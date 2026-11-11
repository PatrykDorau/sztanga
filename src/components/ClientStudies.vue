<script setup lang="ts">
// Badania klienta na jego karcie: ostatni wynik każdego testu i zmiana od pierwszego terminu.
import { onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { fmt, improvement, num, type StudyTest } from '@/lib/studies'
import Icon from './Icon.vue'

const props = defineProps<{ clientId: string }>()
interface Row {
  id: string
  name: string
  tests: { t: StudyTest; first: number | null; last: number | null; d: number | null }[]
  sessions: number
}
const rows = ref<Row[]>([])
onMounted(async () => {
  const { data } = await supabase
    .from('study_athletes')
    .select('id, studies(id, name, tests), study_entries(vals, study_sessions(day))')
    .eq('client_id', props.clientId)
  rows.value = ((data ?? []) as unknown as { studies: { id: string; name: string; tests: StudyTest[] }; study_entries: { vals: Record<string, number>; study_sessions: { day: string } }[] }[]).map((a) => {
    const entries = [...a.study_entries].sort((x, y) => x.study_sessions.day.localeCompare(y.study_sessions.day))
    return {
      id: a.studies.id,
      name: a.studies.name,
      sessions: entries.length,
      tests: a.studies.tests.map((t) => {
        const vals = entries.map((e) => num(e.vals[t.key])).filter((v): v is number => v != null)
        const first = vals[0] ?? null
        const last = vals.at(-1) ?? null
        return { t, first, last, d: vals.length > 1 ? improvement(first, last, t.higher) : null }
      }),
    }
  })
})
</script>

<template>
  <section v-if="rows.length" class="space-y-2">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-bold">Badania</h2>
      <RouterLink to="/badania" class="text-sm font-semibold text-primary-fg">Wszystkie</RouterLink>
    </div>
    <RouterLink v-for="r in rows" :key="r.id" :to="`/badania/${r.id}`" class="card pressable block space-y-1.5 p-3 hover:bg-surface-2">
      <p class="flex items-center gap-2 font-semibold"><span class="min-w-0 flex-1 truncate">{{ r.name }}</span><Icon name="chevron" class="size-4 text-subtle" /></p>
      <p v-for="x in r.tests.filter((y) => y.last != null)" :key="x.t.key" class="flex items-center gap-2 text-sm">
        <span class="min-w-0 flex-1 truncate text-muted">{{ x.t.label }}</span>
        <span class="font-semibold tabular-nums">{{ fmt(x.last, 2) }}{{ x.t.unit ? ` ${x.t.unit}` : '' }}</span>
        <span v-if="x.d != null" class="w-16 text-right text-xs font-semibold tabular-nums" :class="x.d >= 1 ? 'text-success' : x.d <= -1 ? 'text-danger' : 'text-muted'">{{ x.d >= 1 ? '▲' : x.d <= -1 ? '▼' : '•' }} {{ x.d > 0 ? '+' : '' }}{{ fmt(x.d, 1) }}%</span>
      </p>
      <p v-if="!r.tests.some((y) => y.last != null)" class="text-sm text-muted">Brak wyników.</p>
    </RouterLink>
  </section>
</template>
