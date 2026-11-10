<script setup lang="ts">
// „Zainstaluj aplikację” – przycisk (Android/Chrome) albo instrukcja (iPhone). banner = kafel na Starcie z „Nie teraz”.
import { computed, ref } from 'vue'
import { bannerHidden, canPrompt, hideBanner, isInstalled, isIos, promptInstall, showIosHint } from '@/lib/install'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ banner?: boolean }>()
const hidden = ref(props.banner ? bannerHidden() : false)
const visible = computed(() => !hidden.value && (canPrompt.value || showIosHint.value || (!props.banner && !isInstalled.value)))
function dismiss() {
  hideBanner()
  hidden.value = true
}
</script>

<template>
  <section v-if="!banner && isInstalled" class="card space-y-1 p-4">
    <h2 class="text-lg font-bold">Aplikacja na telefonie</h2>
    <p class="text-sm text-muted">Aplikacja jest zainstalowana – uruchamiasz ją z ikony na ekranie.</p>
  </section>
  <section v-else-if="visible" class="card space-y-3 p-4">
    <div class="flex items-start gap-3">
      <img src="/icon-192.png" alt="" class="size-12 shrink-0 rounded-xl" />
      <div class="min-w-0 flex-1">
        <h2 class="text-lg font-bold">Zainstaluj aplikację</h2>
        <p class="text-sm text-muted">Ikona na ekranie telefonu, pełny ekran bez paska przeglądarki, działa też bez internetu.</p>
      </div>
    </div>
    <button v-if="canPrompt" type="button" class="btn-primary w-full" @click="promptInstall"><Icon name="plus" class="size-5" />Zainstaluj</button>
    <ol v-else-if="isIos" class="list-decimal space-y-1 pl-5 text-sm">
      <li>Otwórz tę stronę w <b>Safari</b>.</li>
      <li>Stuknij <b>Udostępnij</b> (kwadrat ze strzałką w górę) na dole ekranu.</li>
      <li>Wybierz <b>Do ekranu początkowego</b> i potwierdź <b>Dodaj</b>.</li>
    </ol>
    <ol v-else class="list-decimal space-y-1 pl-5 text-sm">
      <li>Otwórz stronę w <b>Chrome</b> na telefonie z Androidem.</li>
      <li>Stuknij menu <b>⋮</b> w prawym górnym rogu.</li>
      <li>Wybierz <b>Zainstaluj aplikację</b> (albo „Dodaj do ekranu głównego”).</li>
    </ol>
    <button v-if="banner" type="button" class="btn-ghost w-full" @click="dismiss">Nie teraz</button>
  </section>
</template>
