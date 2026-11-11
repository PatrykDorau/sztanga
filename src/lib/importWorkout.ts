// Import treningu: tekst, zrzut ekranu/zdjęcie albo dyktowanie → Claude (funkcja „ai”, action import) → lista ćwiczeń
// → dopasowanie do bazy (najpierw etykiety trenerki) → szkic planu do zapisania.
import { supabase } from '@/lib/supabase'
import { wordScore } from '@/lib/exerciseSearch'
import { norm } from '@/lib/search'
import type { Exercise } from '@/types'

export interface ParsedExercise {
  name: string
  en?: string // angielska nazwa (od Claude, do dopasowania)
  alt?: string[] // nazwy zastępcze
  section: string | null
  group: string | null
  sets: number | null
  reps: string | null
  load: string | null
  tempo: string | null
  rest_sec: number | null
  notes: string | null
}
export interface ParsedWorkout {
  name: string
  exercises: ParsedExercise[]
}
export interface ParsedPlan {
  name: string
  workouts: ParsedWorkout[]
  warnings: string[]
}

/** Zmniejszenie zdjęcia (max 1600 px, JPEG) – szybciej i taniej, a tabela pozostaje czytelna. */
export async function shrinkImage(file: Blob): Promise<{ media_type: string; data: string }> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k)
  c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const url = c.toDataURL('image/jpeg', 0.85)
  return { media_type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) }
}

export async function parseWorkout(input: { text?: string; image?: { media_type: string; data: string } }): Promise<ParsedPlan> {
  const { data, error } = await supabase.functions.invoke('ai', { body: { action: 'import', ...input } })
  if (error) throw new Error((await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message)
  return data as ParsedPlan
}

// ===================== Dopasowanie do bazy: propozycje z procentem zgodności =====================
// Nie wymagamy, żeby pasowało każde słowo („Windmille z piłką/ciężar” ma pasować do „Kettlebell Windmill”).
// Liczymy dwie rzeczy: jaka część słów z treningu pasuje do ćwiczenia (pokrycie) i jaka część nazwy ćwiczenia
// została wyjaśniona słowami z treningu (precyzja). Pytamy o: nazwę trenerki, angielską nazwę od Claude i nazwy zastępcze.
const STOP = new Set(['z', 'ze', 'do', 'na', 'w', 'we', 'i', 'oraz', 'od', 'u', 'po', 'przez', 'dla', 'a', 'the', 'with', 'of', 'to', 'and', 'on', 'in', 'for', 'or'])
/** Slang i skróty trenerki → słowa, jakie są w bazie. */
const SYN: Record<string, string[]> = {
  iso: ['izometria', 'izometryczne', 'isometric', 'hold', 'utrzymanie'],
  izometria: ['izometryczne', 'isometric', 'hold', 'utrzymanie'],
  izometryczny: ['izometria', 'isometric', 'hold'],
  boku: ['boczne', 'bokiem', 'lateral', 'side'],
  bok: ['boczne', 'bokiem', 'lateral', 'side'],
  boczne: ['bokiem', 'lateral', 'side'],
  pilka: ['ball'],
  pilke: ['ball'],
  pilki: ['ball'],
  pileczka: ['ball', 'pilka'],
  pileczki: ['ball', 'pilka'],
  sciana: ['wall'],
  sciany: ['wall'],
  sciane: ['wall'],
  skoki: ['skok', 'jump', 'hop', 'przeskoki', 'bound'],
  skok: ['jump', 'hop', 'bound'],
  wykrok: ['lunge', 'split'],
  wykroki: ['lunge', 'split'],
  przysiad: ['squat'],
  martwy: ['deadlift'],
  wyciskanie: ['press'],
  wioslowanie: ['row'],
  windmill: ['wiatrak'],
  windmille: ['windmill', 'wiatrak'],
  kettlem: ['kettlebell'],
  kettle: ['kettlebell'],
  hantlem: ['dumbbell'],
  hantlami: ['dumbbell'],
  sztanga: ['barbell'],
  sztangi: ['barbell'],
  guma: ['band'],
  gumy: ['band'],
  gumie: ['band'],
  jednonoz: ['single', 'leg', 'jednej', 'nodze'],
  rdl: ['rumunski', 'romanian', 'martwy'],
  sl: ['jednonoz', 'single', 'jednej'],
  chodzenie: ['chod', 'walk', 'marsz'],
  chod: ['walk', 'marsz'],
  kbox: ['ekscentryk', 'ekscentryku', 'flywheel'],
  kboxie: ['ekscentryk', 'ekscentryku', 'flywheel', 'kbox'],
  ekscentryk: ['ekscentryku', 'flywheel', 'kbox'],
  ekscentryku: ['flywheel', 'kbox'],
  flywheel: ['ekscentryk', 'kbox'],
  izoinercyjny: ['stozkowy', 'conical', 'flywheel'],
  stozkowy: ['stozkowym', 'conical'],
  drazku: ['drazek', 'pull'],
  porecze: ['poreczach', 'dip'],
  poreczach: ['porecze', 'dip'],
  sanki: ['sanie', 'san', 'sled'],
  saniami: ['sanki', 'sled'],
  trapbar: ['trap', 'bar'],
}
const toks = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w))
const WEIGHT: Record<number, number> = { 3: 1, 2: 0.85, 1: 0.6, 0: 0 }

interface Cand {
  e: Exercise
  names: string[][] // słowa nazwy PL, EN i każdej etykiety
  bag: string[] // wszystkie słowa nazw + fraz wyszukiwania
  tags: string[]
}
const candCache = new WeakMap<Exercise, Cand>()
function cand(e: Exercise): Cand {
  let c = candCache.get(e)
  if (!c) {
    // precyzję liczymy tylko na nazwie PL/EN – jednowyrazowa etykieta („stabilizacja”) nie może dać 100% „wyjaśnienia” nazwy
    const names = [e.name_pl, e.name_en ?? ''].map(toks).filter((x) => x.length)
    const tagWords = (e.tags ?? []).flatMap(toks)
    c = { e, names, bag: [...names.flat(), ...tagWords, ...toks(e.search_terms ?? '')], tags: (e.tags ?? []).map((t) => toks(t).join(' ')) }
    candCache.set(e, c)
  }
  return c
}
/** Dopasowanie słowa zapytania (z synonimami) do listy słów: 0–1. */
function hit(q: string, list: string[]) {
  let s = 0
  for (const a of [q, ...(SYN[q] ?? [])]) for (const w of list) s = Math.max(s, WEIGHT[wordScore(a, w)] * (a === q ? 1 : 0.95))
  return s
}
/** Zgodność 0–100 jednego wariantu nazwy z ćwiczeniem. */
function scoreQuery(q: string[], c: Cand) {
  if (!q.length) return 0
  if (c.tags.includes(q.join(' '))) return 100
  const cover = q.reduce((s, w) => s + hit(w, c.bag), 0) / q.length
  // precyzja: najlepiej wyjaśniona nazwa ćwiczenia (PL albo EN albo etykieta)
  let prec = 0
  for (const n of c.names) {
    const p = n.reduce((s, w) => s + Math.max(...q.map((x) => Math.max(WEIGHT[wordScore(x, w)], ...(SYN[x] ?? []).map((a) => WEIGHT[wordScore(a, w)] * 0.95)))), 0) / n.length
    prec = Math.max(prec, p)
  }
  return Math.round(100 * (0.6 * cover + 0.4 * prec))
}

export interface Suggestion {
  e: Exercise
  pct: number
}
/** Do 3 propozycji z bazy z procentem zgodności (najlepsza pierwsza). */
export function suggestExercises(p: Pick<ParsedExercise, 'name' | 'en' | 'alt'>, all: Exercise[], favorites: Set<string>): Suggestion[] {
  // Warianty po „/”: „Windmille z piłką/ciężar” → „Windmille z piłką”, „Windmille z ciężar”;
  // „Ergometr wioślarski/bieżnia/rower” → „Ergometr bieżnia”… (samego „piłką” nie szukamy – to nie ćwiczenie).
  const parts: [string, number][] = [[p.name, 1]]
  const slash = p.name.match(/^(.*?)(\S+(?:\s*\/\s*\S+)+)(.*)$/)
  if (slash) {
    const [, pre, alts, post] = slash
    for (const a of alts.split('/').map((x) => x.trim())) parts.push([`${pre}${a}${post}`, 1])
  }
  const all3: [string[], number][] = [...parts.map(([x, w]): [string[], number] => [toks(x), w]), [toks(p.en ?? ''), 0.97], ...(p.alt ?? []).map((x): [string[], number] => [toks(x), 0.93])]
  const queries = all3.filter(([q]) => q.some((w) => w.length > 2))
  const out: Suggestion[] = []
  for (const e of all) {
    const c = cand(e)
    let pct = 0
    for (const [q, w] of queries) pct = Math.max(pct, scoreQuery(q, c) * w)
    if (pct >= 35) out.push({ e, pct: Math.min(100, Math.round(pct + (favorites.has(e.id) ? 3 : 0))) })
  }
  return out.sort((a, b) => b.pct - a.pct || a.e.name_pl.length - b.e.name_pl.length).slice(0, 3)
}

/** Najlepsze dopasowanie (zgodność ≥ 70%) albo null – dla zgodności ze starszym kodem. */
export function matchExercise(name: string, all: Exercise[], favorites: Set<string>): Exercise | null {
  if (/\s\+\s|\soraz\s/.test(name)) return null
  const best = suggestExercises({ name, en: '', alt: [] }, all, favorites)[0]
  return best && best.pct >= 70 ? best.e : null
}

// ----- Dyktowanie (Web Speech API – w przeglądarce, za darmo, po polsku) -----
type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}
export const speechSupported = () => typeof window !== 'undefined' && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition)
export function startDictation(onText: (finalText: string, interim: string) => void, onEnd: (err?: string) => void) {
  const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }
  const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
  if (!Ctor) throw new Error('Ta przeglądarka nie obsługuje dyktowania – użyj Chrome albo Safari.')
  const rec = new Ctor()
  rec.lang = 'pl-PL'
  rec.continuous = true
  rec.interimResults = true
  rec.onresult = (e) => {
    let fin = ''
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) fin += r[0].transcript
      else interim += r[0].transcript
    }
    onText(fin, interim)
  }
  rec.onerror = (e) => onEnd(e.error === 'not-allowed' ? 'Brak dostępu do mikrofonu.' : e.error === 'no-speech' ? undefined : `Błąd dyktowania: ${e.error}`)
  rec.onend = () => onEnd()
  rec.start()
  return () => rec.stop()
}
