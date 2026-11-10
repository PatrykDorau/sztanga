// Słowniki wartości używanych w bazie ćwiczeń. W bazie trzymamy klucze, w UI polskie etykiety.
import type { ExerciseLevel } from '@/types'

export const MUSCLES: Record<string, string> = {
  chest: 'Klatka piersiowa',
  shoulders: 'Barki',
  triceps: 'Triceps',
  biceps: 'Biceps',
  forearms: 'Przedramiona',
  lats: 'Najszersze grzbietu',
  'middle back': 'Środek pleców',
  'lower back': 'Dolny odcinek pleców',
  traps: 'Czworoboczne',
  neck: 'Szyja',
  abdominals: 'Brzuch',
  glutes: 'Pośladki',
  quadriceps: 'Czworogłowe uda',
  hamstrings: 'Dwugłowe uda',
  adductors: 'Przywodziciele',
  abductors: 'Odwodziciele',
  calves: 'Łydki',
}

export const EQUIPMENT: Record<string, string> = {
  'body only': 'Masa ciała',
  dumbbell: 'Hantle',
  barbell: 'Sztanga',
  kettlebells: 'Kettlebell',
  cable: 'Wyciąg',
  machine: 'Maszyna',
  bands: 'Gumy',
  'medicine ball': 'Piłka lekarska',
  'exercise ball': 'Piłka gimnastyczna',
  'e-z curl bar': 'Gryf łamany',
  'foam roll': 'Roller',
  trx: 'TRX',
  box: 'Skrzynia',
  other: 'Inne',
}

export const PATTERNS: Record<string, string> = {
  squat: 'Przysiad',
  hinge: 'Zawias biodrowy',
  lunge: 'Wykrok',
  push_h: 'Pchanie poziome',
  push_v: 'Pchanie pionowe',
  pull_h: 'Przyciąganie poziome',
  pull_v: 'Przyciąganie pionowe',
  core: 'Core / stabilizacja',
  carry: 'Noszenie',
  rotation: 'Rotacja',
  plyo: 'Plyometria',
  mobility: 'Mobilność / rozciąganie',
  cardio: 'Kondycja',
  other: 'Inne',
}

export const LEVELS: Record<ExerciseLevel, string> = {
  beginner: 'Początkujący',
  intermediate: 'Średniozaawansowany',
  advanced: 'Zaawansowany',
}

export const CONTRAINDICATIONS: Record<string, string> = {
  knee: 'Kolano',
  lower_back: 'Odcinek lędźwiowy',
  shoulder: 'Bark',
  wrist: 'Nadgarstek',
  elbow: 'Łokieć',
  hip: 'Biodro',
  ankle: 'Staw skokowy',
  neck: 'Odcinek szyjny',
  pregnancy: 'Ciąża',
  hypertension: 'Nadciśnienie',
  diastasis: 'Rozejście mięśni brzucha',
}

export const label = (dict: Record<string, string>, key: string | null | undefined) =>
  key ? (dict[key] ?? key) : ''

export const GROUPS: Record<string, string> = {
  amateur: 'Amator',
  athlete: 'Sportowiec',
  child: 'Dziecko',
}

export const PHASES: Record<string, string> = {
  adaptation: 'Adaptacja',
  hypertrophy: 'Hipertrofia',
  strength: 'Siła',
  power: 'Moc',
  peaking: 'Szczyt formy',
  deload: 'Deload',
}

export const PHASE_COLORS: Record<string, string> = {
  adaptation: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  hypertrophy: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  strength: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  power: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  peaking: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  deload: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
}

export const STATUSES: Record<string, string> = {
  draft: 'Szkic',
  active: 'Aktywny',
  archived: 'Zakończony',
}

export const SESSION_STATUSES: Record<string, string> = {
  pending: 'Do akceptacji',
  confirmed: 'Potwierdzona',
  cancelled: 'Odwołana',
  completed: 'Odbyta',
  no_show: 'Nieobecność',
}

export const WEEKDAYS = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela']
export const WEEKDAYS_SHORT = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd']
