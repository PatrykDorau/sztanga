// Rozpoznawanie wydarzeń kalendarza trenerki (czysty TS – testowany też lokalnie).
//   "Anna Kowalska (BW)"  → klient + siłownia BW
//   "Zuzanna Kocur 2os"   → klient (dopiski po nazwisku ignorowane przy dopasowaniu)
//   "Free" / "free (FO)"  → wolny termin
//   "Ortodonta", "Trening siłowy" → prywatne

export interface Gym {
  id: string
  code: string
  color_id: number
  is_default: boolean
}

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const SUFFIX = /\s*\(([A-Za-z0-9]{1,4})\)\s*$/

/** Tytuł bez dopisku siłowni i kod siłowni, jeśli był w nawiasie na końcu. */
export function splitTitle(title: string): { base: string; code: string | null } {
  const m = title.match(SUFFIX)
  return m ? { base: title.slice(0, m.index).trim(), code: m[1].toUpperCase() } : { base: title.trim(), code: null }
}

export const isFree = (title: string) => /^free\b/i.test(splitTitle(title).base)

/** Rodziny kolorów Google Calendar (colorId): „niebieski” to Lavender, Peacock albo Blueberry itd. */
const COLOR_FAMILY: Record<number, string> = { 1: 'blue', 7: 'blue', 9: 'blue', 11: 'red', 4: 'red', 6: 'orange', 5: 'yellow', 2: 'green', 10: 'green', 3: 'purple', 8: 'gray' }
export const colorFamily = (id: number | null) => (id == null ? null : (COLOR_FAMILY[id] ?? null))

/** Siłownia: najpierw kod w nawiasie, potem kolor wydarzenia (dokładny, potem ta sama rodzina), na końcu domyślna. */
export function gymFor(title: string, colorId: number | null, gyms: Gym[]): Gym | null {
  const { code } = splitTitle(title)
  const fam = colorFamily(colorId)
  return (
    (code && gyms.find((g) => g.code === code)) ||
    (colorId != null && gyms.find((g) => g.color_id === colorId)) ||
    (fam && gyms.find((g) => colorFamily(g.color_id) === fam)) ||
    gyms.find((g) => g.is_default) ||
    null
  )
}

/** Pierwsze słowa, które nie są imieniem (żeby „Trening Funkcjonalny” albo „Dzień Niepodległości” nie stały się klientem). */
const NOT_PERSON = new Set(
  'trening treningi zajecia zajecie obwod spotkanie konsultacja wizyta szkolenie kurs webinar wyjazd urlop silownia basen masaz fizjoterapia fizjo lekarz dentysta ortodonta dzien urodziny imieniny swieta wigilia sylwester free wolne przerwa obiad lunch odbior zakupy sprzatanie egzamin praca zebranie rozmowa nauka mobility stretching joga yoga pilates crossfit bieg rower mecz turniej zawody'.split(' '),
)

/**
 * Imię i nazwisko z tytułu, jeśli to wygląda na klienta: dwa słowa z wielkiej litery na początku, bez słów-kluczy
 * („Trening …”) i bez nazw/kodów siłowni („Wiktoria Forto”). Dopiski po nazwisku („2os”) są pomijane.
 */
export function personName(title: string, gymWords: string[] = []): string | null {
  const { base } = splitTitle(title)
  if (!looksLikePerson(base)) return null
  const words = base.split(/\s+/).slice(0, 2)
  const n = words.map(norm)
  if (NOT_PERSON.has(n[0]) || n.some((w) => gymWords.includes(w))) return null
  return words.join(' ')
}

/** Wygląda jak "Imię Nazwisko" (min. dwa słowa, każde z wielkiej litery) – kandydat na klienta. */
export function looksLikePerson(base: string) {
  const words = base.split(/\s+/).filter((w) => /^\p{L}/u.test(w))
  return words.length >= 2 && words.slice(0, 2).every((w) => /^\p{Lu}\p{Ll}+(-\p{Lu}\p{Ll}+)?$/u.test(w))
}

export interface ClientRef {
  id: string
  full_name: string
}

/**
 * Dopasowanie tytułu do klienta: alias (ręczne przypisanie) → pełne imię i nazwisko → tytuł zaczynający się
 * od imienia i nazwiska klienta (dopiski typu "2os"). Zwraca: client (id), 'ignored' (oznaczone "to nie klient") albo null.
 */
export function matchClient(title: string, clients: ClientRef[], aliases: Map<string, string | null>): string | 'ignored' | null {
  const key = norm(splitTitle(title).base)
  if (aliases.has(key)) return aliases.get(key) ?? 'ignored'
  const exact = clients.find((c) => norm(c.full_name) === key)
  if (exact) return exact.id
  // Najdłuższe pasujące imię i nazwisko na początku tytułu (żeby "Anna Kowalska-Nowak" nie wygrała z "Anna Kowalska").
  const prefix = clients
    .map((c) => ({ c, n: norm(c.full_name) }))
    .filter(({ n }) => n.split(' ').length >= 2 && (key === n || key.startsWith(n + ' ')))
    .sort((a, b) => b.n.length - a.n.length)[0]
  return prefix ? prefix.c.id : null
}

export const eventTitle = (clientName: string, gymCode: string | null) => (gymCode ? `${clientName} (${gymCode})` : clientName)
