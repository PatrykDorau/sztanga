<script setup lang="ts">
// Podgląd ruchu: film (gdy jest), a jeśli nie ma albo przeglądarka go nie odtworzy – animacja z klatek start/koniec.
// Pod spodem link do filmów z techniką na YouTube (wyszukiwanie po nazwie angielskiej – działa dla każdego ćwiczenia).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ videoSrc?: string | null; images: string[]; nameEn?: string | null; namePl: string }>()
const videoFailed = ref(false)
const frame = ref(0)
const paused = ref(false)
let timer = 0
watch(
  () => props.videoSrc,
  () => (videoFailed.value = false),
)
const showVideo = computed(() => !!props.videoSrc && !videoFailed.value)
function start() {
  clearInterval(timer)
  if (props.images.length > 1) timer = window.setInterval(() => !paused.value && (frame.value = (frame.value + 1) % props.images.length), 900)
}
onMounted(start)
watch(() => props.images, start)
onBeforeUnmount(() => clearInterval(timer))
const yt = computed(() => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${props.nameEn || props.namePl} exercise technique`)}`)
</script>

<template>
  <div class="space-y-2">
    <div v-if="showVideo || images.length" class="relative overflow-hidden rounded-2xl bg-white">
      <video
        v-if="showVideo"
        :src="videoSrc!"
        controls
        playsinline
        loop
        muted
        autoplay
        class="aspect-video w-full bg-black object-contain"
        @error="videoFailed = true"
      />
      <button v-else type="button" class="block w-full" :aria-label="paused ? 'Wznów animację ruchu' : 'Zatrzymaj animację ruchu'" @click="paused = !paused">
        <img v-for="(src, i) in images" :key="src" :src="src" alt="" loading="lazy" class="w-full object-contain" :class="i === frame ? '' : 'absolute inset-0 opacity-0'" />
        <span v-if="images.length > 1" class="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
          {{ paused ? 'pauza' : frame === 0 ? 'start' : 'koniec ruchu' }}
        </span>
      </button>
    </div>
    <a :href="yt" target="_blank" rel="noopener" class="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary-fg underline underline-offset-2">
      <Icon name="video" class="size-4" />Filmy z techniką na YouTube
    </a>
  </div>
</template>
