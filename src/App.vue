<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import BottomNav from '@/components/BottomNav.vue'

const route = useRoute()
// Przed rozpoznaniem pierwszego adresu trasa jest pusta – bez tego pasek migał na stronach publicznych.
const showNav = computed(() => route.matched.length > 0 && !route.meta.public && !route.meta.bare)
</script>

<template>
  <div class="mx-auto min-h-dvh max-w-2xl" :class="showNav ? 'pb-24' : ''">
    <RouterView v-slot="{ Component }">
      <component :is="Component" v-if="Component" />
      <!-- Zanim trasa się rozpozna (logowanie, doładowanie ekranu) – wskaźnik zamiast pustej strony -->
      <div v-else class="flex min-h-dvh items-center justify-center" role="status" aria-label="Ładowanie">
        <span class="size-8 animate-spin rounded-full border-[3px] border-line-strong border-t-primary" />
      </div>
    </RouterView>
  </div>
  <BottomNav v-if="showNav" />
</template>
