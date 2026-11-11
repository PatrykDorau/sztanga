import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/types'

const COLUMNS = 'id, user_id, full_name, email, phone, client_group, birth_date, goals, limitations, equipment, notes, archived, gym_id, client_view, created_at'
export type ClientInput = Omit<Client, 'id' | 'created_at' | 'user_id'>

export const useClientsStore = defineStore('clients', () => {
  const all = ref<Client[]>([])
  const loaded = ref(false)

  async function load(force = false) {
    if (loaded.value && !force) return
    const { data, error } = await supabase.from('clients').select(COLUMNS).order('full_name')
    if (error) throw error
    all.value = data as Client[]
    loaded.value = true
  }

  // Klient spoza wczytanej listy (np. utworzony przed chwilą przez synchronizację z Google Calendar) –
  // odśwież listę w tle (najwyżej co 10 s), nazwisko pojawi się samo.
  let lastRefresh = 0
  function refreshSoon() {
    if (!loaded.value || Date.now() - lastRefresh < 10_000) return
    lastRefresh = Date.now()
    void load(true).catch(() => null)
  }
  const byId = (id: string | null | undefined) => {
    if (!id) return undefined
    const c = all.value.find((x) => x.id === id)
    if (!c) refreshSoon()
    return c
  }

  async function save(input: ClientInput, id?: string) {
    const q = id
      ? supabase.from('clients').update(input).eq('id', id).select(COLUMNS).single()
      : supabase.from('clients').insert(input).select(COLUMNS).single()
    const { data, error } = await q
    if (error) throw error
    const row = data as Client
    const i = all.value.findIndex((c) => c.id === row.id)
    if (i >= 0) all.value[i] = row
    else all.value.push(row)
    all.value.sort((a, b) => a.full_name.localeCompare(b.full_name, 'pl'))
    return row
  }

  async function remove(id: string) {
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) throw error
    all.value = all.value.filter((c) => c.id !== id)
  }

  return { all, loaded, load, byId, save, remove }
})
