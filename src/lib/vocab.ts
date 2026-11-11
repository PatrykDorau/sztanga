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
  'trap bar': 'Trap bar',
  landmine: 'Landmine',
  flywheel: 'Ekscentryk (flywheel, kBox)',
  'conical pulley': 'Wyciąg stożkowy (izoinercyjny)',
  sled: 'Sanki',
  'pull-up bar': 'Drążek',
  'dip bars': 'Poręcze (dipy)',
  'roman chair': 'Ławka rzymska',
  'mini band': 'Mini band',
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

export const MEASUREMENTS: Record<string, { label: string; unit: string }> = {
  weight: { label: 'Masa ciała', unit: 'kg' },
  waist: { label: 'Obwód talii', unit: 'cm' },
  hips: { label: 'Obwód bioder', unit: 'cm' },
  chest: { label: 'Obwód klatki', unit: 'cm' },
  thigh: { label: 'Obwód uda', unit: 'cm' },
  arm: { label: 'Obwód ramienia', unit: 'cm' },
  sit_reach: { label: 'Skłon w siadzie', unit: 'cm' },
  plank: { label: 'Deska', unit: 's' },
  pushups: { label: 'Pompki (max)', unit: 'powt.' },
  broad_jump: { label: 'Skok w dal', unit: 'cm' },
  // testy sprawności dzieci (Faza 6)
  sprint_20m: { label: 'Bieg 20 m', unit: 's' },
  shuttle_4x10: { label: 'Bieg wahadłowy 4×10 m', unit: 's' },
  balance_s: { label: 'Stanie na jednej nodze', unit: 's' },
  situps_30s: { label: 'Brzuszki w 30 s', unit: 'powt.' },
}

/** Kolory wydarzeń Google Calendar (colorId 1–11) – nazwy jak w polskim interfejsie Google. */
export const GCAL_COLORS: Record<number, { name: string; hex: string }> = {
  1: { name: 'Lawenda', hex: '#7986cb' },
  2: { name: 'Szałwia', hex: '#33b679' },
  3: { name: 'Winogrono', hex: '#8e24aa' },
  4: { name: 'Flaming', hex: '#e67c73' },
  5: { name: 'Banan', hex: '#f6bf26' },
  6: { name: 'Mandarynka', hex: '#f4511e' },
  7: { name: 'Paw', hex: '#039be5' },
  8: { name: 'Grafit', hex: '#616161' },
  9: { name: 'Borówka', hex: '#3f51b5' },
  10: { name: 'Bazylia', hex: '#0b8043' },
  11: { name: 'Pomidor', hex: '#d50000' },
}
