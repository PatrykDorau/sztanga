// Mądre wyszukiwanie ćwiczeń: nazwy PL/EN, własne etykiety, frazy potoczne (search_terms), partie mięśniowe, sprzęt i wzorzec.
// Odporne na odmianę („wyciskania” = „wyciskanie”), brak polskich znaków, literówki (1 znak w dłuższych słowach) i skróty (rdl, ohp, bp).
import type { Exercise } from '@/types'
import { EQUIPMENT, MUSCLES, PATTERNS } from '@/lib/vocab'
import { norm } from '@/lib/search'

/** Słowa z zapytania zamieniane na to, czego szukać w danych (potoczne nazwy partii itd.). */
const QUERY_SYN: Record<string, string[]> = {
  klata: ['klatka'],
  klate: ['klatka'],
  bica: ['biceps'],
  bicek: ['biceps'],
  tricek: ['triceps'],
  bary: ['barki'],
  pupa: ['posladki'],
  tylek: ['posladki'],
  kaptury: ['czworoboczne'],
  plecy: ['plecy'],
  nogi: ['nogi'],
  uda: ['uda'],
  abs: ['brzuch'],
  core: ['brzuch'],
  dl: ['martwy'],
  md: ['martwy'],
}

interface Indexed {
  e: Exercise
  name: string[] // słowa nazwy (PL + EN + etykiety) – najwyższa waga
  extra: string[] // frazy, mięsień główny, sprzęt, wzorzec
  minor: string[] // mięśnie pomocnicze – niższa waga
}
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean)

const cache = new WeakMap<Exercise, Indexed>()
function index(e: Exercise): Indexed {
  let x = cache.get(e)
  if (x) return x
  const primary = e.primary_muscles?.length ? e.primary_muscles : e.muscle_groups.slice(0, 1)
  x = {
    e,
    name: words([e.name_pl, e.name_en, ...(e.tags ?? [])].filter(Boolean).join(' ')),
    extra: words(
      [
        e.search_terms,
        ...primary.map((m) => MUSCLES[m] ?? m),
        ...e.equipment.map((q) => EQUIPMENT[q] ?? q),
        e.movement_pattern ? PATTERNS[e.movement_pattern] : '',
      ]
        .filter(Boolean)
        .join(' '),
    ),
    minor: words((e.secondary_muscles ?? []).map((m) => MUSCLES[m] ?? m).join(' ')),
  }
  cache.set(e, x)
  return x
}

/** Odległość edycyjna z limitem (szybkie odrzucenie). */
function within1(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let diff = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++diff > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return diff + (a.length - i) + (b.length - j) <= 1
}

/** Jak dobrze słowo zapytania pasuje do słowa z danych: 3 dokładnie, 2 początek/rdzeń, 1 literówka, 0 brak. */
function wordScore(q: string, w: string) {
  if (w === q) return 3
  if (w.startsWith(q)) return 2
  // rdzeń: odcinamy końcówkę odmiany w dłuższych słowach („wyciskania” → „wyciska”)
  if (q.length >= 6) {
    const stem = q.slice(0, Math.max(4, q.length - 2))
    if (w.startsWith(stem)) return 2
  }
  if (q.length >= 5 && within1(q, w.slice(0, q.length + 1))) return 1
  if (q.length >= 5 && within1(q, w)) return 1
  return 0
}
function best(q: string, list: string[]) {
  let s = 0
  for (const w of list) {
    const v = wordScore(q, w)
    if (v > s) s = v
    if (s === 3) break
  }
  return s
}

/** Ocena ćwiczenia dla zapytania (0 = nie pasuje). Każde słowo zapytania musi gdzieś pasować. */
export function exerciseScore(query: string, e: Exercise) {
  const qs = words(query)
  if (!qs.length) return 1
  const x = index(e)
  let total = 0
  for (const raw of qs) {
    const alts = [raw, ...(QUERY_SYN[raw] ?? [])]
    let s = 0
    for (const q of alts) s = Math.max(s, best(q, x.name) * 2, best(q, x.extra), best(q, x.minor) * 0.4)
    if (!s) return 0
    total += s
  }
  // dokładny początek nazwy PL – na samą górę
  if (norm(e.name_pl).startsWith(norm(query).trim())) total += 10
  // przy remisie: podstawowe ćwiczenia przed wariantami i rozciąganiem
  if (e.movement_pattern === 'mobility' && !/rozcia|stretch|mobil|rolow/.test(norm(query))) total -= 4
  if (e.mechanic === 'compound') total += 0.3
  if (e.video_path) total += 0.3
  if ((e.tags ?? []).length) total += 0.3
  // dopasowane zostaje na liście nawet z karą (tylko niżej)
  return Math.max(0.01, total - e.name_pl.length / 200)
}

/** Filtrowanie i sortowanie po trafności (przy pustym zapytaniu – kolejność wejściowa). */
export function searchExercises<T extends Exercise>(query: string, list: T[]): T[] {
  if (!query.trim()) return list
  return list
    .map((e) => ({ e, s: exerciseScore(query, e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e)
}
