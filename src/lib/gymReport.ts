// Miesięczne zestawienie dla siłowni (recepcji): treningi personalne (data + klient) i zajęcia grupowe
// (data, rodzaj, LP, liczba osób). Bez kwot – recepcja uzupełnia je sama. Kopiowanie jako tabela (TSV) do arkusza.
import { supabase } from '@/lib/supabase'
import type { Gym, Session } from '@/types'
import type { GroupClass } from '@/stores/groupClasses'

export interface PersonalRow {
  id: string
  date: string // dd.mm.rrrr
  at: string
  client: string
  planned: boolean // jeszcze się nie odbył (termin w przyszłości)
}
export interface GroupRow {
  id: string
  date: string
  at: string
  kind: string
  lp: number
  participants: number | null
}

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
export const monthFromKey = (k: string) => {
  const [y, m] = k.split('-').map(Number)
  return new Date(y, m - 1, 1)
}
export const monthLabel = (d: Date) => d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
const dmy = (iso: string) => new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Czy wpis należy do siłowni (brak siłowni = siłownia domyślna). */
export const inGym = (gymId: string | null, g: Gym) => gymId === g.id || (!gymId && g.is_default)

export async function loadMonth(month: Date) {
  const from = month.toISOString()
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString()
  const [s, g] = await Promise.all([
    supabase.from('sessions').select('id, client_id, starts_at, status, gym_id').gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    supabase.from('group_classes').select('id, starts_at, ends_at, gym_id, kind, participants, cancelled, notes, repeat_id').gte('starts_at', from).lt('starts_at', to).order('starts_at'),
  ])
  if (s.error) throw s.error
  if (g.error) throw g.error
  return { sessions: s.data as Pick<Session, 'id' | 'client_id' | 'starts_at' | 'status' | 'gym_id'>[], groups: g.data as GroupClass[] }
}

export function buildReport(data: Awaited<ReturnType<typeof loadMonth>>, gym: Gym, clientName: (id: string) => string) {
  const now = new Date().toISOString()
  const personal: PersonalRow[] = data.sessions
    .filter((s) => inGym(s.gym_id, gym) && (s.status === 'completed' || s.status === 'confirmed'))
    .map((s) => ({ id: s.id, date: dmy(s.starts_at), at: s.starts_at, client: clientName(s.client_id), planned: s.status === 'confirmed' && s.starts_at > now }))
  const groups: GroupRow[] = data.groups
    .filter((c) => inGym(c.gym_id, gym) && !c.cancelled)
    .map((c, i) => ({ id: c.id, date: dmy(c.starts_at), at: c.starts_at, kind: c.kind, lp: i + 1, participants: c.participants }))
  return { personal, groups }
}

/** Tabela do schowka – wklejona w Arkusze Google / Excel rozkłada się na komórki. */
export const tsv = (rows: (string | number | null)[][]) => rows.map((r) => r.map((c) => String(c ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n')
export const personalTsv = (rows: PersonalRow[]) => tsv(rows.map((r) => [r.date, r.client]))
export const groupTsv = (rows: GroupRow[]) => tsv(rows.map((r) => [r.date, r.kind, r.lp, r.participants]))
