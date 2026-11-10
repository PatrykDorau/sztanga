<script setup lang="ts">
// Wnioski dla trenerki: najpierw krótko – co poprawić i co powiedzieć ćwiczącemu; szczegóły (co widać, liczby, nad czym pracować) po rozwinięciu.
import { computed, ref } from 'vue'
import { SEVERITY_LABEL, type Coaching, type Finding } from '@/lib/pose/coaching'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ coaching: Coaching; active?: string | null }>()
const emit = defineEmits<{ show: [f: Finding] }>()

const open = ref(new Set<string>())
const more = ref(false)
function toggle(k: string) {
  const s = new Set(open.value)
  if (s.has(k)) s.delete(k)
  else s.add(k)
  open.value = s
}
// Na start najwyżej 3 najważniejsze uwagi – resztę trenerka rozwija sama.
const TOP = 3
const shown = computed(() => (more.value ? props.coaching.findings : props.coaching.findings.slice(0, TOP)))
const hidden = computed(() => props.coaching.findings.length - TOP)

const tone: Record<Finding['severity'], { bar: string; tag: string }> = {
  high: { bar: 'bg-danger', tag: 'bg-danger-soft text-danger' },
  medium: { bar: 'bg-primary', tag: 'bg-primary-soft text-primary-fg' },
  low: { bar: 'bg-line-strong', tag: 'bg-surface-2 text-muted' },
}
</script>

<template>
  <section class="space-y-3" aria-labelledby="coach-h">
    <div>
      <h2 id="coach-h" class="text-xl font-bold">Wnioski</h2>
      <p class="mt-0.5 font-semibold" :class="coaching.findings.length ? '' : 'text-success'">{{ coaching.headline }}</p>
    </div>

    <ul v-if="shown.length" class="space-y-2">
      <li v-for="f in shown" :key="f.key" class="card relative overflow-hidden p-4 pl-5" :class="active === f.key ? 'ring-2 ring-primary' : ''">
        <span class="absolute inset-y-0 left-0 w-1.5" :class="tone[f.severity].bar" />
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase" :class="tone[f.severity].tag">{{ SEVERITY_LABEL[f.severity] }}</span>
          <span class="text-xs text-muted">{{ f.repsText }}</span>
        </div>
        <h3 class="mt-1.5 text-base leading-snug font-bold">{{ f.title }}</h3>
        <p class="mt-2 border-l-2 border-line-strong pl-3 text-[15px] leading-snug">
          <span class="block text-[11px] font-semibold tracking-wide text-muted uppercase">Powiedz</span>
          „{{ f.cue }}”
        </p>

        <div v-if="open.has(f.key)" class="mt-3 space-y-2 text-sm">
          <p><span class="block text-[11px] font-semibold tracking-wide text-muted uppercase">Co widać</span>{{ f.obs }}</p>
          <p><span class="block text-[11px] font-semibold tracking-wide text-muted uppercase">Nad czym popracować</span>{{ f.fix }}</p>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="chip border-line-strong bg-surface" @click="emit('show', f)"><Icon name="video" class="size-4" />Pokaż na nagraniu</button>
          <button type="button" class="chip border-line-strong bg-surface" :aria-expanded="open.has(f.key)" @click="toggle(f.key)">
            {{ open.has(f.key) ? 'Zwiń' : 'Szczegóły' }}
          </button>
        </div>
      </li>
    </ul>
    <button v-if="hidden > 0" type="button" class="btn-ghost w-full border border-line-strong" @click="more = !more">
      {{ more ? 'Pokaż tylko najważniejsze' : `Pozostałe uwagi (${hidden})` }}
    </button>

    <div v-if="coaching.good.length" class="card p-4">
      <p class="text-[11px] font-semibold tracking-wide text-muted uppercase">Co wygląda dobrze</p>
      <ul class="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        <li v-for="g in coaching.good" :key="g" class="flex items-start gap-2"><Icon name="check" class="mt-0.5 size-4 shrink-0 text-success" />{{ g }}</li>
      </ul>
    </div>

    <p v-for="n in coaching.notes" :key="n" class="flex items-start gap-2 text-sm text-muted"><Icon name="alert" class="mt-0.5 size-4 shrink-0" />{{ n }}</p>
    <p class="text-xs text-muted">
      Wskazania z pomiarów szkieletu wg Twoich progów (<RouterLink to="/analiza/progi" class="underline">ustawienia</RouterLink>) – potwierdź na nagraniu, decyzja należy do Ciebie.
    </p>
  </section>
</template>
