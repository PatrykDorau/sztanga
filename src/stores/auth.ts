import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const profile = ref<Profile | null>(null)
  const ready = ref(false)

  const isTrainer = computed(() => profile.value?.role === 'trainer')
  const isAdmin = computed(() => !!profile.value?.is_admin)

  async function loadProfile() {
    if (!session.value) {
      profile.value = null
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, role, full_name, is_admin')
      .eq('id', session.value.user.id)
      .maybeSingle()
    profile.value = data as Profile | null
  }

  let initPromise: Promise<void> | null = null
  function init() {
    initPromise ??= (async () => {
      const { data } = await supabase.auth.getSession()
      session.value = data.session
      await loadProfile()
      ready.value = true
      supabase.auth.onAuthStateChange((_event, s) => {
        const changed = s?.user.id !== session.value?.user.id
        session.value = s
        if (changed) void loadProfile()
      })
    })()
    return initPromise
  }

  async function sendMagicLink(email: string) {
    return supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
  }

  async function signInWithPassword(email: string, password: string) {
    const res = await supabase.auth.signInWithPassword({ email, password })
    if (!res.error) {
      session.value = res.data.session
      await loadProfile()
    }
    return res
  }

  async function signOut() {
    await supabase.auth.signOut()
    session.value = null
    profile.value = null
  }

  return { session, profile, ready, isTrainer,
    isAdmin, init, sendMagicLink, signInWithPassword, signOut, loadProfile }
})
