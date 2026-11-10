<script setup lang="ts">
// Wybór wielu (lub jednej) wartości ze słownika jako "chipsy" – wygodne kciukiem na telefonie.
const props = defineProps<{ options: Record<string, string>; single?: boolean; scroll?: boolean }>()
const model = defineModel<string[]>({ required: true })

// Zmieniamy tablicę w miejscu: przypisanie nowej tablicy dociera do rodzica dopiero po re-renderze,
// więc kilka szybkich kliknięć pod rząd nadpisywało się nawzajem (zostawał tylko ostatni wybór).
function toggle(key: string) {
  const arr = model.value
  const i = arr.indexOf(key)
  if (props.single) arr.splice(0, arr.length, ...(i >= 0 ? [] : [key]))
  else if (i >= 0) arr.splice(i, 1)
  else arr.push(key)
}
</script>

<template>
  <div class="flex gap-2" :class="scroll ? '-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]' : 'flex-wrap'">
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
</template>
