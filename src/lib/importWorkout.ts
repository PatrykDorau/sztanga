// Import treningu: tekst, zrzut ekranu/zdjęcie albo dyktowanie → Claude (funkcja „ai”, action import) → lista ćwiczeń
// → dopasowanie do bazy (najpierw etykiety trenerki) → szkic planu do zapisania.
import { supabase } from '@/lib/supabase'
import { exerciseScore, searchExercises } from '@/lib/exerciseSearch'
import type { Exercise } from '@/types'

export interface ParsedExercise {
  name: string
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

/** Najlepsze dopasowanie z bazy (etykiety trenerki mają pierwszeństwo) albo null, gdy nic sensownego. */
export function matchExercise(name: string, all: Exercise[], favorites: Set<string>) {
  const list = searchExercises(name, all, favorites)
  const best = list[0]
  if (!best) return null
  return exerciseScore(name, best, favorites) >= 4 ? best : null
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
