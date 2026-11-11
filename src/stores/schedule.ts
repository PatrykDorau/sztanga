import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type {
  AvailabilityException,
  AvailabilityRule,
  BookingSettings,
  ConsultationRequest,
  Session,
  SessionStatus,
  WaitlistEntry,
} from '@/types'

const SESSION_COLS =
  'id, client_id, starts_at, ends_at, status, workout_id, series_id, notes, booked_by_client, cancelled_at, cancel_reason, gym_id, gcal_event_id, moved_from, weekly_request'

function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

export const useScheduleStore = defineStore('schedule', () => {
  const sessions = ref<Session[]>([])
  const settings = ref<BookingSettings | null>(null)
  const rules = ref<AvailabilityRule[]>([])
  const exceptions = ref<AvailabilityException[]>([])
  const requests = ref<ConsultationRequest[]>([])
  const waitlist = ref<WaitlistEntry[]>([])

  const sortSessions = () => sessions.value.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  function upsertLocal(rows: Session[]) {
    for (const r of rows) {
      const i = sessions.value.findIndex((s) => s.id === r.id)
      if (i >= 0) sessions.value[i] = r
      else sessions.value.push(r)
    }
    sortSessions()
  }

  /** Sesje w zakresie [from, to) – trenerka widzi wszystkie, klient (RLS) tylko swoje. */
  async function loadRange(from: Date, to: Date) {
    const rows = ok(
      await supabase
        .from('sessions')
        .select(SESSION_COLS)
        .gte('starts_at', from.toISOString())
        .lt('starts_at', to.toISOString())
        .order('starts_at'),
    ) as Session[]
    sessions.value = sessions.value.filter((s) => s.starts_at < from.toISOString() || s.starts_at >= to.toISOString())
    upsertLocal(rows)
    return rows
  }

  async function loadSettings() {
    settings.value = ok(await supabase.from('booking_settings').select('*').eq('id', 1).single()) as BookingSettings
    return settings.value
  }

  async function saveSettings(patch: Partial<BookingSettings>) {
    settings.value = ok(
      await supabase.from('booking_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select('*').single(),
    ) as BookingSettings
  }

  // ===== Dostępność =====
  async function loadAvailability() {
    const [r, e] = await Promise.all([
      supabase.from('availability_rules').select('*').order('weekday').order('start_time'),
      supabase.from('availability_exceptions').select('*').gte('day', new Date().toISOString().slice(0, 10)).order('day'),
    ])
    rules.value = ok(r) as AvailabilityRule[]
    exceptions.value = ok(e) as AvailabilityException[]
  }

  async function addRule(weekday: number, start_time: string, end_time: string) {
    const row = ok(await supabase.from('availability_rules').insert({ weekday, start_time, end_time }).select('*').single()) as AvailabilityRule
    rules.value.push(row)
    rules.value.sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
  }

  async function removeRule(id: string) {
    ok(await supabase.from('availability_rules').delete().eq('id', id))
    rules.value = rules.value.filter((r) => r.id !== id)
  }

  async function addException(input: Omit<AvailabilityException, 'id'>) {
    const row = ok(await supabase.from('availability_exceptions').insert(input).select('*').single()) as AvailabilityException
    exceptions.value.push(row)
    exceptions.value.sort((a, b) => a.day.localeCompare(b.day))
  }

  async function removeException(id: string) {
    ok(await supabase.from('availability_exceptions').delete().eq('id', id))
    exceptions.value = exceptions.value.filter((r) => r.id !== id)
  }

  // ===== Sesje (trenerka) =====
  async function createSession(input: { client_id: string; starts_at: string; ends_at: string; workout_id?: string | null; notes?: string | null; gym_id?: string | null }) {
    const row = ok(await supabase.from('sessions').insert({ ...input, status: 'confirmed' }).select(SESSION_COLS).single()) as Session
    upsertLocal([row])
    return row
  }

  /** Sesja cykliczna: zapis serii i wygenerowanie terminów na 8 tygodni naprzód. */
  async function createSeries(input: { client_id: string; weekday: number; start_time: string; duration_minutes: number; start_date: string; end_date?: string | null; gym_id?: string | null }) {
    const sr = ok(await supabase.from('session_series').insert(input).select('id').single()) as { id: string }
    const n = ok(await supabase.rpc('generate_series_sessions', { sid: sr.id })) as number
    return { id: sr.id, created: n }
  }

  async function updateSession(id: string, patch: Partial<Session>) {
    const row = ok(await supabase.from('sessions').update(patch).eq('id', id).select(SESSION_COLS).single()) as Session
    upsertLocal([row])
    return row
  }

  /** Zwolniony termin – lista oczekujących na ten dzień dostaje informację (klient: "kto pierwszy, ten lepszy"). */
  async function notifyWaitlist(startsAt: string) {
    const d = new Date(startsAt)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    await supabase.from('waitlist').update({ notified_at: new Date().toISOString() }).eq('day', day).is('notified_at', null)
  }

  async function setStatus(id: string, status: SessionStatus, reason?: string) {
    const row = await updateSession(id, {
      status,
      ...(status === 'cancelled' ? { cancelled_at: new Date().toISOString(), cancel_reason: reason ?? null } : {}),
    })
    if (status === 'cancelled') await notifyWaitlist(row.starts_at).catch(() => null)
    return row
  }

  async function removeSession(id: string) {
    ok(await supabase.from('sessions').delete().eq('id', id))
    sessions.value = sessions.value.filter((s) => s.id !== id)
  }

  /** Odwołuje tę i wszystkie przyszłe sesje serii, kończy serię. */
  async function cancelSeriesFrom(seriesId: string, fromIso: string, reason = 'Koniec serii') {
    ok(
      await supabase
        .from('sessions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: reason })
        .eq('series_id', seriesId)
        .gte('starts_at', fromIso)
        .in('status', ['pending', 'confirmed']),
    )
    ok(await supabase.from('session_series').update({ end_date: fromIso.slice(0, 10) }).eq('id', seriesId))
    for (const s of sessions.value)
      if (s.series_id === seriesId && s.starts_at >= fromIso && ['pending', 'confirmed'].includes(s.status)) s.status = 'cancelled'
  }

  // ===== Klient =====
  async function freeSlots(fromDay: string, toDay: string) {
    return ok(await supabase.rpc('free_slots', { from_day: fromDay, to_day: toDay })) as { starts_at: string; ends_at: string; gym_id: string | null }[]
  }

  /** Prośba klienta o termin (zawsze do potwierdzenia); moveFrom = przełożenie istniejącej sesji. */
  async function book(slotIso: string, moveFrom?: string | null, weekly = false) {
    const id = ok(await supabase.rpc('request_slot', { slot: slotIso, move_from: moveFrom ?? null, weekly })) as string
    const row = ok(await supabase.from('sessions').select(SESSION_COLS).eq('id', id).single()) as Session
    upsertLocal([row])
    return row
  }

  async function cancelMine(id: string, reason?: string) {
    ok(await supabase.rpc('cancel_my_session', { sid: id, reason: reason ?? null }))
    const s = sessions.value.find((x) => x.id === id)
    if (s) s.status = 'cancelled'
  }

  async function loadWaitlist() {
    waitlist.value = ok(await supabase.from('waitlist').select('id, client_id, day, notified_at').gte('day', new Date().toISOString().slice(0, 10)).order('day')) as WaitlistEntry[]
  }

  async function joinWaitlist(clientId: string, day: string) {
    const { error } = await supabase.from('waitlist').insert({ client_id: clientId, day })
    if (error && error.code !== '23505') throw error
    await loadWaitlist()
  }

  async function leaveWaitlist(id: string) {
    ok(await supabase.from('waitlist').delete().eq('id', id))
    waitlist.value = waitlist.value.filter((w) => w.id !== id)
  }

  // ===== Zgłoszenia na konsultację =====
  async function loadRequests() {
    requests.value = ok(await supabase.from('consultation_requests').select('*').order('created_at', { ascending: false })) as ConsultationRequest[]
  }

  async function setRequestStatus(id: string, status: ConsultationRequest['status']) {
    ok(await supabase.from('consultation_requests').update({ status }).eq('id', id))
    const r = requests.value.find((x) => x.id === id)
    if (r) r.status = status
  }

  return {
    sessions, settings, rules, exceptions, requests, waitlist,
    loadRange, loadSettings, saveSettings,
    loadAvailability, addRule, removeRule, addException, removeException,
    createSession, createSeries, updateSession, setStatus, removeSession, cancelSeriesFrom,
    freeSlots, book, cancelMine, loadWaitlist, joinWaitlist, leaveWaitlist,
    loadRequests, setRequestStatus,
  }
})
