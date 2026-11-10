<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const mode = ref<'link' | 'password'>('link')
const busy = ref(false)
const sent = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  busy.value = true
  try {
    if (mode.value === 'link') {
      const { error: e } = await auth.sendMagicLink(email.value.trim())
      if (e) throw e
      sent.value = true
    } else {
      const { error: e } = await auth.signInWithPassword(email.value.trim(), password.value)
      if (e) throw e
      await router.replace((route.query.next as string) || '/')
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh flex-col justify-center px-6 py-10">
    <div class="mb-8 flex items-center gap-3">
      <img src="/icon.svg" alt="" class="size-12" />
      <div>
        <h1 class="text-2xl font-bold">Trener</h1>
        <p class="text-sm text-stone-500">Plany, grafik i postępy w jednym miejscu</p>
      </div>
    </div>

    <div v-if="sent" class="card p-5">
      <h2 class="mb-1 font-semibold">Sprawdź skrzynkę</h2>
      <p class="text-sm text-stone-600 dark:text-stone-400">
        Wysłaliśmy link logowania na <strong>{{ email }}</strong>. Otwórz go na tym urządzeniu.
      </p>
      <button class="btn-ghost mt-4 w-full" @click="sent = false">Wróć</button>
    </div>

    <form v-else class="card space-y-4 p-5" @submit.prevent="submit">
      <div>
        <label class="label" for="email">E-mail</label>
        <input id="email" v-model="email" type="email" required autocomplete="email" class="input" placeholder="ty@example.com" />
      </div>
      <div v-if="mode === 'password'">
        <label class="label" for="pw">Hasło</label>
        <input id="pw" v-model="password" type="password" required autocomplete="current-password" class="input" />
      </div>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy">
        {{ busy ? 'Chwila…' : mode === 'link' ? 'Wyślij link logowania' : 'Zaloguj' }}
      </button>
      <button type="button" class="w-full text-sm text-stone-500 underline" @click="mode = mode === 'link' ? 'password' : 'link'">
        {{ mode === 'link' ? 'Zaloguj hasłem' : 'Zaloguj linkiem z e-maila' }}
      </button>
    </form>
  </main>
</template>
