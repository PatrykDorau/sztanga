// Zmiana stałego terminu (sesje cykliczne): propozycje z wolnych okien w kalendarzu, link dla klienta, zatwierdzenie.
import { supabase } from '@/lib/supabase'

export const WEEKDAY_PL = ['', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela']

export interface WeeklySlot {
  weekday: number // 1 = poniedziałek … 7 = niedziela
  start_time: string // "HH:MM"
  duration_minutes: number
  gym_id: string | null
}
export interface RescheduleOffer {
  id: string
  client_id: string
  series_id: string | null
  token: string
  slots: WeeklySlot[]
  note: string | null
  status: 'open' | 'chosen' | 'applied' | 'cancelled'
  chosen: WeeklySlot | null
  chosen_note: string | null
  chosen_at: string | null
  created_at: string
}
export interface Series {
  id: string
  client_id: string
  weekday: number
  start_time: string
  duration_minutes: number
  start_date: string
  end_date: string | null
  gym_id: string | null
}

const TZ = 'Europe/Warsaw'
function local(iso: string) {
  const d = new Date(iso)
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]),
  )
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday as string] ?? 1
  return { weekday: wd, time: `${p.hour}:${p.minute}` }
}

/**
 * Stałe terminy z wolnych okien: ten sam dzień tygodnia i godzina wolne w (prawie) każdym tygodniu okresu.
 * free = wynik free_slots (konkretne daty); occurrences = ile razy dany dzień tygodnia wypada w okresie.
 */
export function weeklyCandidates(free: { starts_at: string; ends_at: string; gym_id: string | null }[], from: Date, days: number, duration: number): WeeklySlot[] {
  const occ = new Map<number, number>()
  for (let i = 0; i < days; i++) {
    const wd = local(new Date(from.getTime() + i * 864e5).toISOString()).weekday
    occ.set(wd, (occ.get(wd) ?? 0) + 1)
  }
  const count = new Map<string, { n: number; gym: string | null }>()
  for (const f of free) {
    if ((new Date(f.ends_at).getTime() - new Date(f.starts_at).getTime()) / 60000 < duration) continue
    const l = local(f.starts_at)
    const k = `${l.weekday}|${l.time}`
    const c = count.get(k) ?? { n: 0, gym: f.gym_id }
    c.n++
    count.set(k, c)
  }
  return [...count.entries()]
    .map(([k, c]) => {
      const [wd, time] = k.split('|')
      return { weekday: Number(wd), start_time: time, duration_minutes: duration, gym_id: c.gym, n: c.n }
    })
    .filter((s) => s.n >= Math.max(2, (occ.get(s.weekday) ?? 0) - 1))
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
    .map(({ n: _n, ...s }) => s)
}

export const slotKey = (s: Pick<WeeklySlot, 'weekday' | 'start_time'>) => `${s.weekday}|${s.start_time}`
export const slotLabel = (s: Pick<WeeklySlot, 'weekday' | 'start_time'>) => `${WEEKDAY_PL[s.weekday]} ${s.start_time}`

function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

export async function clientSeries(clientId: string) {
  const today = new Date().toISOString().slice(0, 10)
  const rows = ok(await supabase.from('session_series').select('*').eq('client_id', clientId).order('weekday')) as Series[]
  return rows.filter((s) => !s.end_date || s.end_date >= today)
}
export async function offers(clientId?: string) {
  let q = supabase.from('reschedule_offers').select('*').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(50)
  if (clientId) q = q.eq('client_id', clientId)
  return ok(await q) as RescheduleOffer[]
}
export async function createOffer(input: { client_id: string; series_id: string | null; slots: WeeklySlot[]; note: string | null }) {
  return ok(await supabase.from('reschedule_offers').insert(input).select('*').single()) as RescheduleOffer
}
export async function setOfferStatus(id: string, status: RescheduleOffer['status']) {
  ok(await supabase.from('reschedule_offers').update({ status, ...(status === 'applied' ? { applied_at: new Date().toISOString() } : {}) }).eq('id', id))
}
export const offerUrl = (o: RescheduleOffer) => `${location.origin}/t/${o.token}`

/** Pierwszy dzień (od jutra) o podanym dniu tygodnia – od niego startuje nowa seria. */
export function nextDate(weekday: number) {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() + i * 864e5)
    if (local(d.toISOString()).weekday === weekday) return d.toLocaleDateString('sv-SE', { timeZone: TZ })
  }
  return new Date().toISOString().slice(0, 10)
}
