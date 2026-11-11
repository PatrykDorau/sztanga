<script setup lang="ts">
// Wybór wartości ze słownika.
//  • Mało opcji (≤ 6) – chipsy do kliknięcia kciukiem.
//  • Dużo opcji – zwarte pole: wybrane jako małe chipsy z ×, reszta w rozwijanej liście z wyszukiwaniem.
//  • custom – można dopisać własną wartość (zapisuje się jako tekst, wyświetla jak wpisano).
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { norm } from '@/lib/search'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ options: Record<string, string>; single?: boolean; scroll?: boolean; custom?: boolean; placeholder?: string; compact?: boolean }>()
const model = defineModel<string[]>({ required: true })

const keys = computed(() => Object.keys(props.options))
// (Vue zamienia brakujący atrybut logiczny na false, więc nie da się odróżnić „nieustawione” – compact tylko wymusza.)
const isCompact = computed(() => props.compact || keys.value.length > 6 || props.custom)
const labelOf = (k: string) => props.options[k] ?? k

// Zmieniamy tablicę w miejscu: przypisanie nowej tablicy dociera do rodzica dopiero po re-renderze,
// więc kilka szybkich kliknięć pod rząd nadpisywało się nawzajem (zostawał tylko ostatni wybór).
function toggle(key: string) {
  const arr = model.value
  const i = arr.indexOf(key)
  if (props.single) arr.splice(0, arr.length, ...(i >= 0 ? [] : [key]))
  else if (i >= 0) arr.splice(i, 1)
  else arr.push(key)
  if (props.single) close()
}

// ----- Lista rozwijana -----
const open = ref(false)
const q = ref('')
const root = ref<HTMLElement>()
const search = ref<HTMLInputElement>()
const shown = computed(() => {
  const n = norm(q.value.trim())
  const all = [...keys.value, ...model.value.filter((k) => !(k in props.options))]
  return n ? all.filter((k) => norm(labelOf(k)).includes(n)) : all
})
const canAdd = computed(() => {
  const t = q.value.trim()
  return props.custom && t.length > 1 && !keys.value.some((k) => norm(labelOf(k)) === norm(t)) && !model.value.some((k) => norm(k) === norm(t))
})
function addCustom() {
  const t = q.value.trim().slice(0, 60)
  if (!t) return
  if (props.single) model.value.splice(0, model.value.length, t)
  else model.value.push(t)
  q.value = ''
  if (props.single) close()
}
function onOutside(e: Event) {
  if (root.value && !root.value.contains(e.target as Node)) close()
}
async function show() {
  open.value = true
  document.addEventListener('pointerdown', onOutside)
  await nextTick()
  search.value?.focus()
}
function close() {
  open.value = false
  q.value = ''
  document.removeEventListener('pointerdown', onOutside)
}
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
function onEnter() {
  if (canAdd.value) addCustom()
  else if (shown.value.length === 1) toggle(shown.value[0])
}
</script>

<template>
  <!-- Chipsy (mało opcji) -->
  <div v-if="!isCompact" class="flex gap-2" :class="scroll ? '-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]' : 'flex-wrap'">
    <button
      v-for="(lbl, key) in options"
      :key="key"
      type="button"
      :class="model.includes(String(key)) ? 'chip-on' : 'chip-off'"
      :aria-pressed="model.includes(String(key))"
      @click="toggle(String(key))"
    >
      {{ lbl }}
    </button>
  </div>

  <!-- Zwarte pole z listą -->
  <div v-else ref="root" class="relative" @keydown.esc="close">
    <div class="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-2 py-1.5">
      <span v-for="k in model" :key="k" class="inline-flex items-center gap-1 rounded-lg bg-primary-soft py-1 pr-1 pl-2 text-sm font-semibold text-primary-fg">
        {{ labelOf(k) }}
        <button type="button" class="rounded p-0.5 hover:bg-primary/20" :aria-label="`Usuń: ${labelOf(k)}`" @click="toggle(k)"><Icon name="x" class="size-3.5" /></button>
      </span>
      <button type="button" class="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:bg-surface-2 hover:text-fg" :aria-expanded="open" @click="open ? close() : show()">
        <Icon name="plus" class="size-4" />{{ model.length ? 'dodaj' : (placeholder ?? 'wybierz') }}
      </button>
    </div>
    <div v-if="open" class="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-lg">
      <div class="border-b border-line p-2">
        <input ref="search" v-model="q" type="search" class="input !min-h-9 text-sm" :placeholder="custom ? 'Szukaj albo wpisz własne…' : 'Szukaj…'" @keydown.enter.prevent="onEnter" />
      </div>
      <ul class="max-h-64 overflow-y-auto py-1" role="listbox" :aria-multiselectable="!single">
        <li v-if="canAdd">
          <button type="button" class="flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm font-semibold text-primary-fg hover:bg-surface-2" @click="addCustom">
            <Icon name="plus" class="size-4" />Dodaj własne: „{{ q.trim() }}”
          </button>
        </li>
        <li v-for="k in shown" :key="k" role="option" :aria-selected="model.includes(k)">
          <button type="button" class="flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-2" @click="toggle(k)">
            <span class="flex size-5 shrink-0 items-center justify-center rounded border" :class="model.includes(k) ? 'border-primary bg-primary text-on-primary' : 'border-line-strong'">
              <Icon v-if="model.includes(k)" name="check" class="size-3.5" />
            </span>
            <span class="min-w-0 flex-1 truncate">{{ labelOf(k) }}</span>
            <span v-if="!(k in options)" class="text-xs text-muted">własne</span>
          </button>
        </li>
        <li v-if="!shown.length && !canAdd" class="px-3 py-2 text-sm text-muted">Brak wyników</li>
      </ul>
      <div class="flex justify-end border-t border-line p-1.5">
        <button type="button" class="btn-ghost !min-h-9 px-3 text-sm" @click="close">Gotowe</button>
      </div>
    </div>
  </div>
</template>
