// „Uzupełnij z Free”: wydarzenia „Free” z Google Calendar (ostatnie 60 dni i przyszłe) zamienione na tygodniowe przedziały
// godzin pracy – ten sam dzień tygodnia i te same godziny. Powtarzające się w co najmniej 2 tygodniach są zaznaczone.
import { supabase } from '@/lib/supabase'

const TZ = 'Europe/Warsaw'
export interface FreeWindow {
  weekday: number // 1 = poniedziałek
  start: string // HH:MM
  end: string
  gym_id: string | null
  weeks: number // w ilu różnych tygodniach się pojawia
  dates: string[] // przykładowe dni (YYYY-MM-DD)
}

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
function local(iso: string) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return { weekday: WD[p.weekday], day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}
/** Poniedziałek tygodnia (klucz tygodnia). */
function weekKey(day: string) {
  const d = new Date(day + 'T12:00:00Z')
  const wd = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - wd * 864e5).toISOString().slice(0, 10)
}

export async function freeWindows(): Promise<FreeWindow[]> {
  const { data, error } = await supabase.from('calendar_events').select('starts_at, ends_at, gym_id').eq('kind', 'free').order('starts_at')
  if (error) throw error
  const groups = new Map<string, FreeWindow & { wk: Set<string> }>()
  for (const e of (data ?? []) as { starts_at: string; ends_at: string; gym_id: string | null }[]) {
    const a = local(e.starts_at)
    const b = local(e.ends_at)
    if (a.day !== b.day && b.time !== '00:00') continue // przez północ – pomijamy
    const end = a.day !== b.day ? '24:00' : b.time
    if (end <= a.time) continue
    const key = `${a.weekday}|${a.time}|${end}|${e.gym_id ?? ''}`
    const g = groups.get(key) ?? { weekday: a.weekday, start: a.time, end, gym_id: e.gym_id, weeks: 0, dates: [], wk: new Set<string>() }
    g.wk.add(weekKey(a.day))
    if (g.dates.length < 4) g.dates.push(a.day)
    groups.set(key, g)
  }
  return [...groups.values()]
    .map(({ wk, ...g }) => ({ ...g, weeks: wk.size }))
    .sort((x, y) => x.weekday - y.weekday || x.start.localeCompare(y.start))
}

/** Czy przedział jest już w całości w istniejących godzinach pracy tego dnia. */
export function covered(w: Pick<FreeWindow, 'weekday' | 'start' | 'end'>, rules: { weekday: number; start_time: string; end_time: string }[]) {
  return rules.some((r) => r.weekday === w.weekday && r.start_time.slice(0, 5) <= w.start && r.end_time.slice(0, 5) >= w.end)
}
