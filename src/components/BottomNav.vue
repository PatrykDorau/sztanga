<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Icon from './Icon.vue'

const route = useRoute()
const auth = useAuthStore()
// Faza 3 dołoży tu Grafik.
const all = [
  { to: '/', label: 'Start', icon: 'home', match: (p: string) => p === '/', trainer: false },
  { to: '/klienci', label: 'Klienci', icon: 'users', match: (p: string) => p.startsWith('/klienci'), trainer: true },
  { to: '/plany', label: 'Plany', icon: 'clipboard', match: (p: string) => p.startsWith('/plany'), trainer: true },
  { to: '/cwiczenia', label: 'Ćwiczenia', icon: 'dumbbell', match: (p: string) => p.startsWith('/cwiczenia'), trainer: false },
  { to: '/profil', label: 'Profil', icon: 'user', match: (p: string) => p.startsWith('/profil'), trainer: false },
]
const items = computed(() => all.filter((i) => !i.trainer || auth.isTrainer))
const path = computed(() => route.path)
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <ul class="mx-auto flex max-w-2xl">
      <li v-for="it in items" :key="it.to" class="flex-1">
        <RouterLink
          :to="it.to"
          class="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium"
          :class="it.match(path) ? 'text-brand-700 dark:text-brand-500' : 'text-stone-500'"
        >
          <Icon :name="it.icon" class="size-6" />
          {{ it.label }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
