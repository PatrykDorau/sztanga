// Siłownie i Google Calendar: połączenie, stan synchronizacji, blokady z kalendarza, lista do przypisania.
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
// Ten sam moduł co w Edge Function – klucz aliasu liczony identycznie po obu stronach.
import { norm as titleNorm, splitTitle } from '../../supabase/functions/_shared/titles'
import type { CalendarBlock, Gym, GoogleStatus } from '@/types'

function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

export interface CancelledEvent {
  gcal_event_id: string
  title: string | null
  starts_at: string | null
  ends_at: string | null
  restore_free: boolean
  reason: 'cancelled' | 'deleted' | null
  action: null
}

/** Klucz aliasu tytułu wydarzenia (jak w gcal-sync). */
export const aliasKey = (title: string) => titleNorm(splitTitle(title).base)

export const useCalendarStore = defineStore('calendar', () => {
  const gyms = ref<Gym[]>([])
  const status = ref<GoogleStatus | null>(null)
  const blocks = ref<CalendarBlock[]>([])
  const syncing = ref(false)
  /** Tytuł wydarzenia, z którego trenerka tworzy nowego klienta (wypełnia formularz, potem staje się aliasem). */
  const pendingAlias = ref<string | null>(null)

  const defaultGym = computed(() => gyms.value.find((g) => g.is_default) ?? gyms.value[0] ?? null)
  const gymById = (id: string | null | undefined) => gyms.value.find((g) => g.id === id) ?? null

  async function loadGyms() {
    gyms.value = ok(await supabase.from('gyms').select('id, name, code, color_id, is_default, equipment, machines').order('created_at')) as Gym[]
  }

  async function saveGym(input: Omit<Gym, 'id'>, id?: string) {
    if (input.is_default) await supabase.from('gyms').update({ is_default: false }).neq('id', id ?? '00000000-0000-0000-0000-000000000000')
    const q = id ? supabase.from('gyms').update(input).eq('id', id) : supabase.from('gyms').insert(input)
    ok(await q)
    await loadGyms()
  }

  async function removeGym(id: string) {
    ok(await supabase.from('gyms').delete().eq('id', id))
    gyms.value = gyms.value.filter((g) => g.id !== id)
  }

  async function loadStatus() {
    const rows = ok(await supabase.rpc('google_status')) as GoogleStatus[]
    status.value = rows[0] ?? null
  }

  /** Wydarzenia z kalendarza (Free / Zajęte / do przypisania) w zakresie – tylko dla trenerki. */
  async function loadBlocks(from: Date, to: Date) {
    blocks.value = ok(
      await supabase
        .from('calendar_events')
        .select('gcal_event_id, kind, title, starts_at, ends_at, all_day, color_id, gym_id')
        .lt('starts_at', to.toISOString())
        .gt('ends_at', from.toISOString())
        .order('starts_at'),
    ) as CalendarBlock[]
  }

  async function unmatched() {
    return ok(
      await supabase
        .from('calendar_events')
        .select('gcal_event_id, kind, title, starts_at, ends_at, all_day, color_id, gym_id')
        .eq('kind', 'unmatched')
        .order('starts_at'),
    ) as CalendarBlock[]
  }

  /** Wydarzenia oznaczone w Google jako „ODWOŁANE · …” – czekają na decyzję trenerki. */
  async function cancelledEvents() {
    return ok(
      await supabase.from('gcal_cancelled').select('gcal_event_id, title, starts_at, ends_at, restore_free, reason, action').is('action', null).order('starts_at', { ascending: true }),
    ) as CancelledEvent[]
  }
  /** Decyzja: usuń z Google (albo przywróć „Free”) / zostaw w kalendarzu jako odwołane. Wykonuje się przy synchronizacji. */
  async function decideCancelled(ids: string[], action: 'delete' | 'keep') {
    if (!ids.length) return
    ok(await supabase.from('gcal_cancelled').update({ action }).in('gcal_event_id', ids))
    await syncNow()
  }

  async function connect() {
    const { data, error } = await supabase.functions.invoke('gcal-auth', { body: { return_to: window.location.origin } })
    if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message)
    window.location.href = data.url
  }

  async function syncNow() {
    syncing.value = true
    try {
      const { error } = await supabase.functions.invoke('gcal-sync', { body: { reason: 'manual' } })
      if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message)
      await loadStatus()
    } finally {
      syncing.value = false
    }
  }

  async function calendars() {
    const { data, error } = await supabase.functions.invoke('gcal-sync', { body: { action: 'calendars' } })
    if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message)
    return data.calendars as { id: string; name: string; primary: boolean; color: string }[]
  }

  /** Synchronizowane kalendarze (siłownia każdego, który jest główny). */
  async function syncedCalendars() {
    return ok(await supabase.rpc('google_calendars_list')) as { calendar_id: string; name: string | null; gym_id: string | null; is_main: boolean; imported: boolean }[]
  }
  async function setCalendars(cals: { id: string; name: string; gym_id: string | null }[], main: string) {
    ok(await supabase.rpc('google_set_calendars', { cals, main }))
    await loadStatus()
    await syncNow()
  }

  async function setCalendar(id: string) {
    ok(await supabase.rpc('google_set_calendar', { cal: id }))
    await syncNow()
  }

  async function disconnect() {
    ok(await supabase.rpc('google_disconnect'))
    await loadStatus()
  }

  /** Przypisanie tytułu z kalendarza do klienta (albo "to nie klient") i ponowna synchronizacja. */
  async function assign(title: string, clientId: string | null) {
    ok(await supabase.from('client_aliases').upsert({ alias_norm: aliasKey(title), client_id: clientId }))
    // wymuś ponowny import tych wydarzeń: pełny import z mapowaniem
    await syncNow()
  }

  return { pendingAlias, gyms, status, blocks, syncing, defaultGym, gymById, loadGyms, saveGym, removeGym, loadStatus, loadBlocks, unmatched, cancelledEvents, decideCancelled, connect, syncNow, calendars, syncedCalendars, setCalendars, setCalendar, disconnect, assign }
})
