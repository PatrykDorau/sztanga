// Faza 6 – logika bez przeglądarki: gotowość sportowca, obciążenie sesji (sRPE) i ACWR, testy sprawności dzieci, odznaki.

// ===================== Gotowość (ankieta przed treningiem) =====================
export interface Readiness {
  id?: string
  client_id: string
  day: string // RRRR-MM-DD
  sleep: number
  fatigue: number
  soreness: number
  stress: number
  mood: number
  notes: string | null
  source?: 'trainer' | 'link' | 'client'
}
export type Light = 'green' | 'yellow' | 'red'

/** Pytania: 1–5, gdzie 5 = najlepiej. Etykiety skrajne, żeby skala była jednoznaczna dla sportowca. */
export const READINESS_ITEMS = [
  { key: 'sleep', label: 'Sen', low: 'bardzo słaby', high: 'świetny' },
  { key: 'fatigue', label: 'Zmęczenie', low: 'wykończony', high: 'wypoczęty' },
  { key: 'soreness', label: 'Bolesność mięśni', low: 'mocno boli', high: 'nic nie boli' },
  { key: 'stress', label: 'Stres', low: 'bardzo duży', high: 'spokój' },
  { key: 'mood', label: 'Nastrój', low: 'bardzo zły', high: 'świetny' },
] as const
export type ReadinessKey = (typeof READINESS_ITEMS)[number]['key']
const WORST: Record<ReadinessKey, string> = { sleep: 'słaby sen', fatigue: 'duże zmęczenie', soreness: 'bolesność', stress: 'stres', mood: 'zły nastrój' }

/** Wynik 0–100 (średnia z pięciu pytań). */
export const readinessScore = (r: Pick<Readiness, ReadinessKey>) =>
  Math.round(((r.sleep + r.fatigue + r.soreness + r.stress + r.mood) / 5 - 1) * 25)

/**
 * Światło dla trenerki. Czerwone: wynik < 50 albo któraś odpowiedź = 1. Żółte: wynik < 70, odpowiedź = 2
 * albo spadek o ≥ 15 pkt względem własnej średniej z ostatnich 28 dni (min. 5 wpisów) – sportowiec jest porównywany ze sobą.
 */
export function readinessStatus(r: Readiness, history: Readiness[] = []): { light: Light; score: number; reasons: string[]; baseline: number | null } {
  const score = readinessScore(r)
  const items = READINESS_ITEMS.map((i) => [i.key, r[i.key]] as const)
  const ones = items.filter(([, v]) => v === 1).map(([k]) => WORST[k])
  const twos = items.filter(([, v]) => v === 2).map(([k]) => WORST[k])
  const since = new Date(new Date(r.day).getTime() - 28 * 864e5).toISOString().slice(0, 10)
  const past = history.filter((h) => h.client_id === r.client_id && h.day < r.day && h.day >= since)
  const baseline = past.length >= 5 ? Math.round(past.reduce((s, h) => s + readinessScore(h), 0) / past.length) : null
  const drop = baseline != null ? baseline - score : 0
  const reasons = [...ones, ...twos]
  if (drop >= 15) reasons.push(`${drop} pkt poniżej swojej normy`)
  const light: Light = score < 50 || ones.length ? 'red' : score < 70 || twos.length || drop >= 15 ? 'yellow' : 'green'
  return { light, score, reasons, baseline }
}
export const LIGHT_LABEL: Record<Light, string> = { green: 'gotowy', yellow: 'uwaga', red: 'odpuścić / zmodyfikować' }

// ===================== Obciążenie sesji i ACWR =====================
export interface LoadLog {
  started_at: string
  finished_at: string | null
  srpe: number | null
  duration_min: number | null
}
/** Czas sesji: wpisany albo z początku i końca (bez absurdów – maks. 4 h). */
export function durationOf(l: LoadLog): number | null {
  if (l.duration_min) return l.duration_min
  if (!l.finished_at) return null
  const m = Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 60000)
  return m > 0 && m <= 240 ? m : null
}
/** Obciążenie sesji = sRPE (CR-10) × minuty [j.u.]. */
export const sessionLoad = (l: LoadLog) => (l.srpe != null && durationOf(l) ? Math.round(l.srpe * durationOf(l)!) : null)

/** Skala CR-10 (Foster) – opisy dla sportowca. */
export const CR10: Record<number, string> = {
  0: 'odpoczynek',
  1: 'bardzo, bardzo lekko',
  2: 'lekko',
  3: 'umiarkowanie',
  4: 'trochę ciężko',
  5: 'ciężko',
  6: 'ciężko+',
  7: 'bardzo ciężko',
  8: 'bardzo ciężko+',
  9: 'prawie maksymalnie',
  10: 'maksymalnie',
}

export interface AcwrPoint {
  day: string
  load: number
  acute: number
  chronic: number
  ratio: number | null
}
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/**
 * ACWR metodą średnich wykładniczych (EWMA, Williams i in. 2017): ostre 7 dni, przewlekłe 28 dni.
 * Dni bez treningu = obciążenie 0. Stosunek liczony dopiero po 21 dniach od pierwszego zapisu.
 */
export function acwr(logs: LoadLog[], until = new Date()): AcwrPoint[] {
  const byDay = new Map<string, number>()
  for (const l of logs) {
    const v = sessionLoad(l)
    if (v == null) continue
    const d = l.started_at.slice(0, 10)
    byDay.set(d, (byDay.get(d) ?? 0) + v)
  }
  if (!byDay.size) return []
  const first = [...byDay.keys()].sort()[0]
  const la = 2 / (7 + 1)
  const lc = 2 / (28 + 1)
  const out: AcwrPoint[] = []
  let acute = 0
  let chronic = 0
  const start = new Date(first)
  for (let d = new Date(start), i = 0; d <= until; d = new Date(d.getTime() + 864e5), i++) {
    const day = ymd(d)
    const load = byDay.get(day) ?? 0
    acute = load * la + (1 - la) * acute
    chronic = load * lc + (1 - lc) * chronic
    out.push({ day, load, acute, chronic, ratio: i >= 21 && chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null })
  }
  return out
}
export function acwrStatus(ratio: number | null): { light: Light | 'none'; text: string } {
  if (ratio == null) return { light: 'none', text: 'za mało danych (min. 3 tygodnie z sRPE)' }
  if (ratio > 1.5) return { light: 'red', text: 'skok obciążenia – wyższe ryzyko urazu' }
  if (ratio > 1.3) return { light: 'yellow', text: 'obciążenie rośnie szybko' }
  if (ratio < 0.8) return { light: 'yellow', text: 'niedociążenie względem ostatnich tygodni' }
  return { light: 'green', text: 'bezpieczny zakres (0,8–1,3)' }
}

// ===================== Dzieci: testy sprawności =====================
export interface TestDef {
  kind: string
  label: string
  unit: string
  lowerIsBetter?: boolean
  how: string
}
/** Bateria testów co kwartał (proste, bez sprzętu laboratoryjnego). */
export const CHILD_TESTS: TestDef[] = [
  { kind: 'broad_jump', label: 'Skok w dal z miejsca', unit: 'cm', how: 'Najlepsza z 2 prób, mierzone do pięty bliżej linii.' },
  { kind: 'sprint_20m', label: 'Bieg 20 m', unit: 's', lowerIsBetter: true, how: 'Start z wysokiej pozycji, lepsza z 2 prób.' },
  { kind: 'shuttle_4x10', label: 'Bieg wahadłowy 4×10 m', unit: 's', lowerIsBetter: true, how: 'Jedna próba na czas, przenoszenie klocka.' },
  { kind: 'balance_s', label: 'Stanie na jednej nodze', unit: 's', how: 'Oczy otwarte, ręce na biodrach, maks. 60 s, lepsza noga.' },
  { kind: 'situps_30s', label: 'Brzuszki w 30 s', unit: 'powt.', how: 'Ręce skrzyżowane na klatce, kolana ugięte.' },
  { kind: 'sit_reach', label: 'Skłon w siadzie', unit: 'cm', how: 'Najlepsza z 2 prób, kolana proste.' },
]
export const TEST_BY_KIND = Object.fromEntries(CHILD_TESTS.map((t) => [t.kind, t]))
export const TEST_EVERY_DAYS = 91

export interface TestPoint {
  kind: string
  value: number
  measured_on: string
}
/** Zmiana od pierwszego do ostatniego pomiaru (dodatnia = poprawa, także dla czasów). */
export function testProgress(points: TestPoint[], def: TestDef) {
  const p = points.filter((x) => x.kind === def.kind).sort((a, b) => a.measured_on.localeCompare(b.measured_on))
  if (!p.length) return null
  const first = Number(p[0].value)
  const last = Number(p.at(-1)!.value)
  const raw = last - first
  const better = def.lowerIsBetter ? -raw : raw
  return { first, last, count: p.length, change: better, pct: first ? Math.round((better / Math.abs(first)) * 100) : null, lastOn: p.at(-1)!.measured_on }
}

// ===================== Odznaki (dzieci) =====================
export interface Badge {
  key: string
  title: string
  icon: string // emoji – dzieci lubią obrazki
  got: boolean
  hint: string
}
export function badgesFor(input: { sessions: number; tests: TestPoint[]; challenges: { target: number; team: number; mine: number | null }[] }): Badge[] {
  const improved = CHILD_TESTS.filter((d) => (testProgress(input.tests, d)?.change ?? 0) > 0)
  const testDays = new Set(input.tests.filter((t) => TEST_BY_KIND[t.kind]).map((t) => t.measured_on)).size
  const teamWins = input.challenges.filter((c) => c.team >= c.target && (c.mine ?? 0) > 0).length
  const b = (key: string, title: string, icon: string, got: boolean, hint: string): Badge => ({ key, title, icon, got, hint })
  return [
    b('first', 'Pierwszy trening', '🌱', input.sessions >= 1, 'Przyjdź na pierwszy trening'),
    b('s10', '10 treningów', '💪', input.sessions >= 10, `Jeszcze ${Math.max(0, 10 - input.sessions)} treningów`),
    b('s25', '25 treningów', '🏅', input.sessions >= 25, `Jeszcze ${Math.max(0, 25 - input.sessions)} treningów`),
    b('s50', '50 treningów', '🏆', input.sessions >= 50, `Jeszcze ${Math.max(0, 50 - input.sessions)} treningów`),
    b('tested', 'Pierwszy test sprawności', '📏', testDays >= 1, 'Zrób test sprawności'),
    b('improve1', 'Lepszy wynik', '📈', improved.length >= 1, 'Popraw dowolny test'),
    b('improve3', 'Wszechstronny', '⭐', improved.length >= 3, `Popraw 3 testy (masz ${improved.length})`),
    b('team', 'Drużyna wygrywa', '🤝', teamWins >= 1, 'Dołóż się do wyzwania, które drużyna ukończy'),
    b('team3', 'Filar drużyny', '🛡️', teamWins >= 3, `3 ukończone wyzwania (masz ${teamWins})`),
  ]
}
