<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { themePref, type ThemePref } from '@/lib/theme'

const auth = useAuthStore()
const router = useRouter()
const name = ref(auth.profile?.full_name ?? '')
const saved = ref(false)
watch(() => auth.profile, (p) => (name.value = p?.full_name ?? ''))

const ROLE = { trainer: 'Trenerka', client: 'Klient', parent: 'Rodzic' } as const
const THEMES: { key: ThemePref; label: string }[] = [
  { key: 'system', label: 'Jak system' },
  { key: 'light', label: 'Jasny' },
  { key: 'dark', label: 'Ciemny' },
]

async function saveName() {
  if (!auth.profile) return
  await supabase.from('profiles').update({ full_name: name.value.trim() }).eq('id', auth.profile.id)
  await auth.loadProfile()
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}

async function logout() {
  await auth.signOut()
  router.replace('/login')
}
</script>

<template>
  <main class="space-y-4 px-4 pt-6">
    <h1 class="page-title">Profil</h1>

    <section class="card space-y-3 p-4">
      <p class="text-sm text-muted">
        {{ auth.session?.user.email }} · <span class="tag">{{ auth.profile ? ROLE[auth.profile.role] : '—' }}</span>
      </p>
      <div>
        <label class="label" for="name">Imię i nazwisko</label>
        <div class="flex gap-2">
          <input id="name" v-model="name" class="input" />
          <button class="btn-ghost" @click="saveName">{{ saved ? 'Zapisano' : 'Zapisz' }}</button>
        </div>
      </div>
    </section>

    <section class="card p-4">
      <p class="label">Wygląd</p>
      <div class="flex gap-2">
        <button v-for="t in THEMES" :key="t.key" :class="themePref === t.key ? 'chip-on' : 'chip-off'" @click="themePref = t.key">
          {{ t.label }}
        </button>
      </div>
    </section>

    <button class="btn-ghost w-full" @click="logout">Wyloguj</button>
  </main>
</template>
