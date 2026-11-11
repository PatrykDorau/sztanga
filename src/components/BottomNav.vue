<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Icon from './Icon.vue'
import { loadMyView, myProgressAny, myView } from '@/lib/clientView'

const route = useRoute()
const auth = useAuthStore()
// Max 5 pozycji (ui-ux-pro-max: bottom-nav-limit). Profil jest w nagłówku Startu.
type Item = { to: string; label: string; icon: string; match: (p: string) => boolean }
const TRAINER: Item[] = [
  { to: '/', label: 'Start', icon: 'home', match: (p) => p === '/' || p.startsWith('/profil') },
  { to: '/grafik', label: 'Grafik', icon: 'calendar', match: (p) => p.startsWith('/grafik') },
  { to: '/klienci', label: 'Klienci', icon: 'users', match: (p) => p.startsWith('/klienci') },
  { to: '/plany', label: 'Plany', icon: 'clipboard', match: (p) => p.startsWith('/plany') },
  { to: '/cwiczenia', label: 'Ćwiczenia', icon: 'dumbbell', match: (p) => p.startsWith('/cwiczenia') },
]
// Klient: pozycje zależne od tego, co trenerka udostępniła (Widok klienta).
const CLIENT = computed<Item[]>(() =>
  [
    { to: '/', label: 'Start', icon: 'home', match: (p: string) => p === '/' || p.startsWith('/profil') },
    myView('sessions') && { to: '/terminy', label: 'Terminy', icon: 'calendar', match: (p: string) => p.startsWith('/terminy') },
    myProgressAny.value && { to: '/postepy', label: 'Postępy', icon: 'chart', match: (p: string) => p.startsWith('/postepy') },
    myView('exercises') && { to: '/cwiczenia', label: 'Ćwiczenia', icon: 'dumbbell', match: (p: string) => p.startsWith('/cwiczenia') },
  ].filter(Boolean) as Item[],
)
watch(
  () => auth.profile?.id,
  (id) => id && !auth.isTrainer && loadMyView(true),
  { immediate: true },
)
const items = computed(() => (auth.isTrainer ? TRAINER : CLIENT.value))
const path = computed(() => route.path)
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <ul class="mx-auto flex max-w-2xl" aria-label="Nawigacja główna">
      <li v-for="it in items" :key="it.to" class="flex-1">
        <!-- Aktywna zakładka: kolor + podświetlenie ikony + pogrubienie (nie tylko kolor). -->
        <RouterLink
          :to="it.to"
          class="pressable flex h-16 flex-col items-center justify-center gap-1 text-xs"
          :class="it.match(path) ? 'font-bold text-fg' : 'font-medium text-muted'"
          :aria-current="it.match(path) ? 'page' : undefined"
        >
          <span class="flex h-7 w-12 items-center justify-center rounded-full transition-colors" :class="it.match(path) ? 'bg-primary text-on-primary' : ''">
            <Icon :name="it.icon" class="size-5" />
          </span>
          {{ it.label }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
