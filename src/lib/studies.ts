// Badania (testy sprawności w kolejnych terminach) – dla jednego klienta, grupy klientów albo drużyny.
// Testy z jednostką i kierunkiem (więcej = lepiej albo mniej = lepiej), wyniki per osoba i termin,
// wyłączenie osoby ze średniej w danym terminie, wklejanie wyników z arkusza.
import { supabase } from '@/lib/supabase'
import { norm } from '@/lib/search'

export interface StudyTest {
  key: string
  label: string
  unit: string
  higher: boolean // true: więcej = lepiej; false: mniej = lepiej (np. sprint)
}
export interface Study {
  id: string
  name: string
  team: string | null
  tests: StudyTest[]
  notes: string | null
  created_at: string
  updated_at: string
}
export interface StudyAthlete {
  id: string
  study_id: string
  name: string
  position: string | null
  client_id: string | null
  sort: number
}
export interface StudySession {
  id: string
  study_id: string
  day: string
  label: string | null
}
export interface StudyEntry {
  session_id: string
  athlete_id: string
  vals: Record<string, number>
  excluded: boolean
  note: string | null
}
export interface StudyFull extends Study {
  athletes: StudyAthlete[]
  sessions: StudySession[]
  entries: StudyEntry[]
}

/** Gotowe testy do wyboru (można dodać własny). */
export const TEST_PRESETS: StudyTest[] = [
  { key: 'cmj', label: 'CMJ', unit: 'cm', higher: true },
  { key: 'sj', label: 'SJ', unit: 'cm', higher: true },
  { key: 'dj_rsi', label: 'Drop jump RSI', unit: '', higher: true },
  { key: 'broad', label: 'Skok w dal z miejsca', unit: 'cm', higher: true },
  { key: 'sprint10', label: 'Sprint 10 m', unit: 's', higher: false },
  { key: 'sprint20', label: 'Sprint 20 m', unit: 's', higher: false },
  { key: 'dyn_force', label: 'Dynamometr – siła', unit: 'N', higher: true },
  { key: 'dyn_asym', label: 'Dynamometr – asymetria', unit: '%', higher: false },
  { key: 'grip', label: 'Siła chwytu', unit: 'kg', higher: true },
  { key: 'plank', label: 'Deska', unit: 's', higher: true },
]

const ok = <T>(r: { data: T; error: unknown }) => {
  if (r.error) throw r.error
  return r.data
}

export async function listStudies() {
  return ok(await supabase.from('studies').select('*, study_athletes(client_id), study_sessions(day)').order('updated_at', { ascending: false })) as (Study & {
    study_athletes: { client_id: string | null }[]
    study_sessions: { day: string }[]
  })[]
}

export async function loadStudy(id: string): Promise<StudyFull> {
  const [s, a, se] = await Promise.all([
    supabase.from('studies').select('*').eq('id', id).single(),
    supabase.from('study_athletes').select('*').eq('study_id', id).order('sort').order('name'),
    supabase.from('study_sessions').select('*').eq('study_id', id).order('day'),
  ])
  const sessions = ok(se) as StudySession[]
  const entries = sessions.length ? (ok(await supabase.from('study_entries').select('*').in('session_id', sessions.map((x) => x.id))) as StudyEntry[]) : []
  return { ...(ok(s) as Study), athletes: ok(a) as StudyAthlete[], sessions, entries }
}

export async function createStudy(input: { name: string; team: string | null; tests: StudyTest[]; athletes: { name: string; position: string | null; client_id: string | null }[] }) {
  const s = ok(await supabase.from('studies').insert({ name: input.name, team: input.team, tests: input.tests }).select('id').single()) as { id: string }
  if (input.athletes.length) ok(await supabase.from('study_athletes').insert(input.athletes.map((a, i) => ({ ...a, study_id: s.id, sort: i }))))
  ok(await supabase.from('study_sessions').insert({ study_id: s.id, day: new Date().toISOString().slice(0, 10) }))
  return s.id
}

export const updateStudy = async (id: string, patch: Partial<Pick<Study, 'name' | 'team' | 'tests' | 'notes'>>) =>
  ok(await supabase.from('studies').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id))
export const deleteStudy = async (id: string) => ok(await supabase.from('studies').delete().eq('id', id))

export async function addAthletes(studyId: string, list: { name: string; position: string | null; client_id: string | null }[], startSort: number) {
  return ok(await supabase.from('study_athletes').insert(list.map((a, i) => ({ ...a, study_id: studyId, sort: startSort + i }))).select('*')) as StudyAthlete[]
}
export const updateAthlete = async (id: string, patch: Partial<Pick<StudyAthlete, 'name' | 'position'>>) => ok(await supabase.from('study_athletes').update(patch).eq('id', id))
export const removeAthlete = async (id: string) => ok(await supabase.from('study_athletes').delete().eq('id', id))

export const addSession = async (studyId: string, day: string, label: string | null) =>
  ok(await supabase.from('study_sessions').insert({ study_id: studyId, day, label }).select('*').single()) as StudySession
export const updateSession = async (id: string, patch: Partial<Pick<StudySession, 'day' | 'label'>>) => ok(await supabase.from('study_sessions').update(patch).eq('id', id))
export const removeSession = async (id: string) => ok(await supabase.from('study_sessions').delete().eq('id', id))

export async function saveEntry(e: StudyEntry) {
  ok(await supabase.from('study_entries').upsert({ ...e, updated_at: new Date().toISOString() }))
}

// ===================== Liczby =====================
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const fmt = (v: number | null | undefined, d = 1) => (v == null ? '—' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ','))
export const entryOf = (s: StudyFull, sessionId: string, athleteId: string) => s.entries.find((e) => e.session_id === sessionId && e.athlete_id === athleteId)
export const valueOf = (s: StudyFull, sessionId: string, athleteId: string, key: string) => num(entryOf(s, sessionId, athleteId)?.vals[key])

/** Średnia testu w terminie (bez osób wyłączonych i pustych pól). */
export function average(s: StudyFull, sessionId: string, key: string, athletes = s.athletes) {
  const vals = athletes.map((a) => (entryOf(s, sessionId, a.id)?.excluded ? null : valueOf(s, sessionId, a.id, key))).filter((v): v is number => v != null)
  return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null
}
/** Zmiana w % z terminu A do B; dodatnia = poprawa (uwzględnia testy „mniej = lepiej”). */
export function improvement(a: number | null, b: number | null, higher: boolean) {
  if (a == null || b == null || a === 0) return null
  const pct = ((b - a) / Math.abs(a)) * 100
  return higher ? pct : -pct
}

// ===================== Wklejanie z arkusza =====================
/**
 * Wiersze z arkusza (kolumny rozdzielone tabulatorem, średnikiem albo kilkoma spacjami):
 * Nazwisko [Pozycja] wynik1 wynik2 … – wyniki w kolejności testów badania; „x” albo puste = brak.
 * Nazwiska dopasowujemy do zawodników (także samo nazwisko); nowe osoby są dodawane.
 */
export function parsePaste(text: string, tests: StudyTest[]) {
  const rows: { name: string; position: string | null; vals: Record<string, number> }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const cells = (line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.split(/\s{2,}/)).map((c) => c.trim())
    const isNum = (c: string) => /^-?\d+([.,]\d+)?$/.test(c)
    const name = cells[0]
    if (!name || isNum(name) || /^(nazwisko|imi|zawodni|średnia|srednia)/i.test(name)) continue
    let i = 1
    let position: string | null = null
    if (cells[1] && !isNum(cells[1]) && !/^x$/i.test(cells[1])) {
      position = cells[1]
      i = 2
    }
    const vals: Record<string, number> = {}
    tests.forEach((t, k) => {
      const c = cells[i + k]
      if (c && isNum(c)) vals[t.key] = Number(c.replace(',', '.'))
    })
    rows.push({ name, position, vals })
  }
  return rows
}
export function matchAthlete(athletes: StudyAthlete[], name: string) {
  const n = norm(name).trim()
  return athletes.find((a) => norm(a.name).trim() === n) ?? athletes.find((a) => norm(a.name).split(/\s+/).includes(n) || n.split(/\s+/).includes(norm(a.name).split(/\s+/).at(-1) ?? ''))
}

export function toCsv(s: StudyFull) {
  const head = ['Nazwisko', 'Pozycja', ...s.sessions.flatMap((se) => s.tests.map((t) => `${t.label} ${se.day}${t.unit ? ` [${t.unit}]` : ''}`))]
  const lines = s.athletes.map((a) => [a.name, a.position ?? '', ...s.sessions.flatMap((se) => s.tests.map((t) => fmt(valueOf(s, se.id, a.id, t.key), 2).replace('—', '')))])
  lines.push(['Średnia', '', ...s.sessions.flatMap((se) => s.tests.map((t) => fmt(average(s, se.id, t.key), 2).replace('—', '')))])
  return [head, ...lines].map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n')
}
