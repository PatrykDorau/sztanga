// Zmiana stałego terminu (sesje cykliczne): propozycje z wolnych okien w kalendarzu, link dla klienta, zatwierdzenie.
import { supabase } from '@/lib/supabase'
import type { useScheduleStore } from '@/stores/schedule'

export const WEEKDAY_PL = ['', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela']

export interface WeeklySlot {
  weekday: number // 1 = poniedziałek … 7 = niedziela
  start_time: string // "HH:MM"
  duration_minutes: number
  gym_id: string | null
  best?: boolean // zaraz przed / po innym treningu na tej samej siłowni (bez dziur w grafiku)
}
export interface RescheduleOffer {
  id: string
  client_id: string | null // null = nowa osoba (jeszcze nie klient)
  prospect_name: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  series_id: string | null
  token: string
  slots: WeeklySlot[]
  note: string | null
  status: 'open' | 'chosen' | 'applied' | 'cancelled'
  chosen: WeeklySlot | null
  preferred?: WeeklySlot[] | null // nowa osoba: terminy „najbardziej mi pasuje”
  backup?: WeeklySlot[] | null // nowa osoba: terminy „mogę też”
  chosen_note: string | null
  chosen_at: string | null
  created_at: string
  expires_at: string | null // po tej dacie link nie działa
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

/**
 * Najlepsze terminy: zaczynają się dokładnie wtedy, gdy kończy się inny trening (sesja albo zajęcia grupowe) na tej samej
 * siłowni, albo kończą się, gdy inny się zaczyna – trening za treningiem, bez dziur. Liczone z najbliższych tygodni:
 * „najlepszy”, gdy tak jest w co najmniej połowie tygodni.
 */
export async function markBest(slots: WeeklySlot[], from: Date, days: number, defaultGym: string | null): Promise<WeeklySlot[]> {
  if (!slots.length) return slots
  const to = new Date(from.getTime() + days * 864e5)
  const [se, gr] = await Promise.all([
    supabase.from('sessions').select('starts_at, ends_at, gym_id').in('status', ['pending', 'confirmed']).gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()),
    supabase.from('group_classes').select('starts_at, ends_at, gym_id').eq('cancelled', false).gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()),
  ])
  const busy = [...((se.data ?? []) as { starts_at: string; ends_at: string; gym_id: string | null }[]), ...((gr.data ?? []) as { starts_at: string; ends_at: string; gym_id: string | null }[])].map((b) => ({
    s: new Date(b.starts_at).getTime(),
    e: new Date(b.ends_at).getTime(),
    gym: b.gym_id ?? defaultGym,
    ...local(b.starts_at),
  }))
  const TOL = 5 * 60000
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  return slots.map((sl) => {
    const gym = sl.gym_id ?? defaultGym
    const start = toMin(sl.start_time)
    const end = start + sl.duration_minutes
    // Ten sam dzień tygodnia: koniec innego treningu = nasz start albo jego start = nasz koniec (na tej samej siłowni).
    const weeks = new Set<string>()
    let total = 0
    for (let i = 0; i < days; i++) if (local(new Date(from.getTime() + i * 864e5).toISOString()).weekday === sl.weekday) total++
    for (const b of busy) {
      if (b.weekday !== sl.weekday || b.gym !== gym) continue
      const bs = toMin(b.time)
      const be = bs + Math.round((b.e - b.s) / 60000)
      if (Math.abs(be - start) * 60000 <= TOL || Math.abs(bs - end) * 60000 <= TOL) weeks.add(new Date(b.s).toISOString().slice(0, 10))
    }
    return { ...sl, best: weeks.size >= Math.max(1, Math.ceil(total / 2)) }
  })
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
export async function createOffer(input: { client_id: string | null; prospect_name?: string | null; series_id: string | null; slots: WeeklySlot[]; note: string | null; expires_at: string }) {
  return ok(await supabase.from('reschedule_offers').insert(input).select('*').single()) as RescheduleOffer
}
export async function setOfferStatus(id: string, status: RescheduleOffer['status']) {
  ok(await supabase.from('reschedule_offers').update({ status, ...(status === 'applied' ? { applied_at: new Date().toISOString() } : {}) }).eq('id', id))
}
export async function setOfferExpiry(id: string, expires_at: string) {
  ok(await supabase.from('reschedule_offers').update({ expires_at }).eq('id', id))
}
export const offerExpired = (o: Pick<RescheduleOffer, 'expires_at' | 'created_at'>) =>
  new Date(o.expires_at ?? new Date(new Date(o.created_at).getTime() + 30 * 864e5).toISOString()).getTime() < Date.now()
export const offerUrl = (o: RescheduleOffer) => `${location.origin}/t/${o.token}`

/** Kto wybrał: klient z bazy albo nowa osoba z linku. */
export const offerWho = (o: RescheduleOffer, clientName?: string | null) => clientName ?? o.contact_name ?? o.prospect_name ?? 'Nowa osoba'

/**
 * Akceptacja wyboru: nowa osoba → nowy klient; stary stały termin (jeśli był) odwołany od dziś, nowa seria od najbliższego
 * wybranego dnia (sesje trafiają do grafiku i Kalendarza Google), propozycja oznaczona jako zrealizowana.
 */
export async function applyOffer(o: RescheduleOffer, schedule: ReturnType<typeof useScheduleStore>, fallbackGym: string | null, picked?: WeeklySlot[]) {
  // Trenerka może przyjąć kilka terminów naraz (np. 2 treningi w tygodniu) – każdy to osobna seria.
  const slots = picked?.length ? picked : o.chosen ? [o.chosen] : []
  if (!slots.length) throw new Error('Brak wybranego terminu.')
  const s = slots[0]
  let clientId = o.client_id
  if (!clientId) {
    const { data, error } = await supabase
      .from('clients')
      .insert({ full_name: (o.contact_name ?? o.prospect_name ?? 'Nowy klient').trim(), phone: o.contact_phone, email: o.contact_email, gym_id: s.gym_id ?? fallbackGym })
      .select('id')
      .single()
    if (error) throw error
    clientId = data.id as string
    ok(await supabase.from('reschedule_offers').update({ client_id: clientId }).eq('id', o.id))
  }
  const old = o.series_id ? ((ok(await supabase.from('session_series').select('*').eq('id', o.series_id).maybeSingle()) as Series | null) ?? null) : null
  if (old) await schedule.cancelSeriesFrom(old.id, new Date().toISOString(), 'Zmiana terminu')
  for (const x of slots)
    await schedule.createSeries({
      client_id: clientId,
      weekday: x.weekday,
      start_time: x.start_time,
      duration_minutes: x.duration_minutes,
      start_date: nextDate(x.weekday),
      gym_id: x.gym_id ?? old?.gym_id ?? fallbackGym,
    })
  await setOfferStatus(o.id, 'applied')
  o.status = 'applied'
  o.client_id = clientId
  return clientId
}

/** Pierwszy dzień (od jutra) o podanym dniu tygodnia – od niego startuje nowa seria. */
export function nextDate(weekday: number) {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() + i * 864e5)
    if (local(d.toISOString()).weekday === weekday) return d.toLocaleDateString('sv-SE', { timeZone: TZ })
  }
  return new Date().toISOString().slice(0, 10)
}
