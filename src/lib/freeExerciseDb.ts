// Import startowej bazy z free-exercise-db (https://github.com/yuhonas/free-exercise-db, domena publiczna / Unlicense).
// Partie, sprzęt i poziom mapujemy na nasze klucze; nazwy PL zostają do przetłumaczenia
// (prosty słownik poniżej tłumaczy najczęstsze, resztę trenerka poprawia lub zrobi to AI w fazie 5).
import { supabase } from './supabase'
import type { ExerciseLevel } from '@/types'

const SRC = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main'

interface FreeExercise {
  id: string
  name: string
  force: string | null
  level: 'beginner' | 'intermediate' | 'expert'
  mechanic: string | null
  equipment: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  instructions: string[]
  category: string
  images: string[]
}

const LEVEL: Record<FreeExercise['level'], ExerciseLevel> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  expert: 'advanced',
}

// Kolejność ma znaczenie: dłuższe frazy przed krótszymi.
const NAME_PL: [RegExp, string][] = [
  [/^barbell back squat$|^barbell squat$/i, 'Przysiad ze sztangą'],
  [/^goblet squat$/i, 'Przysiad goblet'],
  [/^barbell deadlift$/i, 'Martwy ciąg'],
  [/^romanian deadlift.*$/i, 'Martwy ciąg rumuński'],
  [/^barbell bench press.*$/i, 'Wyciskanie sztangi na ławce płaskiej'],
  [/^dumbbell bench press$/i, 'Wyciskanie hantli na ławce płaskiej'],
  [/^pushups?$/i, 'Pompki'],
  [/^pullups?$/i, 'Podciąganie nachwytem'],
  [/^chin-?up$/i, 'Podciąganie podchwytem'],
  [/^plank$/i, 'Deska (plank)'],
  [/^dumbbell lunges?$/i, 'Wykroki z hantlami'],
  [/^barbell hip thrust$/i, 'Hip thrust ze sztangą'],
  [/^kettlebell swing.*$/i, 'Swing kettlebell'],
]

function namePl(en: string) {
  return NAME_PL.find(([re]) => re.test(en))?.[1] ?? en
}

function pattern(e: FreeExercise): string | null {
  const n = e.name.toLowerCase()
  if (e.category === 'stretching') return 'mobility'
  if (e.category === 'cardio') return 'cardio'
  if (e.category === 'plyometrics') return 'plyo'
  if (/lunge|split squat|step-?up/.test(n)) return 'lunge'
  if (/squat|leg press/.test(n)) return 'squat'
  if (/deadlift|good morning|hip thrust|glute bridge|swing|hyperextension/.test(n)) return 'hinge'
  if (/carry|farmer/.test(n)) return 'carry'
  if (/row/.test(n)) return 'pull_h'
  if (/pull-?up|chin-?up|pulldown/.test(n)) return 'pull_v'
  if (/overhead|military|shoulder press|push press|handstand/.test(n)) return 'push_v'
  if (/bench press|push-?up|dip|chest press|fly/.test(n)) return 'push_h'
  if (/twist|woodchop|rotation/.test(n)) return 'rotation'
  if (e.primaryMuscles.includes('abdominals')) return 'core'
  return null
}

export async function fetchFreeExerciseDb(): Promise<FreeExercise[]> {
  const res = await fetch(`${SRC}/dist/exercises.json`)
  if (!res.ok) throw new Error(`Nie udało się pobrać bazy (${res.status})`)
  return res.json()
}

export async function importFreeExerciseDb(items: FreeExercise[], onProgress: (done: number) => void) {
  const rows = items.map((e) => ({
    name_pl: namePl(e.name),
    name_en: e.name,
    muscle_groups: [...new Set([...e.primaryMuscles, ...e.secondaryMuscles])],
    equipment: e.equipment ? [e.equipment] : [],
    movement_pattern: pattern(e),
    level: LEVEL[e.level] ?? 'beginner',
    cues: e.instructions.join('\n') || null,
    image_url: e.images[0] ? `${SRC}/exercises/${e.images[0]}` : null,
    source: 'free-exercise-db',
    external_id: e.id,
  }))
  const BATCH = 200
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from('exercises')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'source,external_id', ignoreDuplicates: true })
    if (error) throw error
    onProgress(Math.min(rows.length, i + BATCH))
  }
  return rows.length
}
