<script setup lang="ts">
// Wybór wielu (lub jednej) wartości ze słownika jako "chipsy" – wygodne kciukiem na telefonie.
const props = defineProps<{ options: Record<string, string>; single?: boolean; scroll?: boolean }>()
const model = defineModel<string[]>({ required: true })

function toggle(key: string) {
  const has = model.value.includes(key)
  if (props.single) model.value = has ? [] : [key]
  else model.value = has ? model.value.filter((k) => k !== key) : [...model.value, key]
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
