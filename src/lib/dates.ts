// Pomocnicze funkcje dat dla grafiku. Czas pokazujemy w strefie urządzenia (trenerka i klienci są w Polsce).

/** Data lokalna jako 'YYYY-MM-DD' (bez przesunięcia UTC, które daje toISOString). */
export function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return addDays(x, -((x.getDay() + 6) % 7))
}

/** ISO dzień tygodnia: 1 = poniedziałek … 7 = niedziela. */
export const isoWeekday = (d: Date) => ((d.getDay() + 6) % 7) + 1

export const hm = (iso: string) => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })

export const dayLabel = (d: Date) => d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })

export const shortDay = (d: Date) => d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric' })

export const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b)

/** '18:00:00' → '18:00' */
export const time5 = (t: string | null) => (t ? t.slice(0, 5) : '')

/** Łączy lokalną datę i godzinę w ISO z poprawną strefą. */
export function localIso(day: string, time: string) {
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm).toISOString()
}
