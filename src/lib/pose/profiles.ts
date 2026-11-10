// Ćwiczenia analizowane z kamery: co liczy powtórzenia, co mierzymy i kiedy flagujemy.
// Progi to wartości startowe – trenerka kalibruje je w aplikacji (tabela analysis_settings).

export type ExerciseKey = 'squat' | 'deadlift' | 'pushup'
export type View = 'front' | 'side' | 'oblique' | 'unknown'

export interface MetricDef {
  key: string
  label: string // pełna nazwa
  short: string // nagłówek kolumny
  unit: '°' | 's' | '%'
  views: View[] // z jakiego ujęcia pomiar jest wiarygodny
  tol: number // minimalny rozrzut przy porównaniu (żeby 1° różnicy nie świeciło na czerwono)
  decimals: number
  help: string
}

export interface FlagDef {
  key: string
  metric: string
  op: '<' | '>'
  value: number // domyślny próg
  label: string // treść flagi
}

export interface Profile {
  key: ExerciseKey
  name: string
  beta: boolean
  signal: 'knee' | 'hip' | 'elbow' // kąt, którego dolina = powtórzenie
  minRange: number // minimalny zakres kąta [°], żeby uznać ruch za powtórzenie
  anchor: 'ankles' | 'wrists' // punkt stały przy porównaniu sylwetek
  facing: 'feet' | 'head'
  trace: 'hip' | 'wrist' | 'shoulder' // tor rysowany na porównaniu
  traceLabel: string
  phases: [string, string] // nazwy faz: w dół / w górę
  hint: string // jak ustawić telefon
  metrics: MetricDef[]
  flags: FlagDef[]
}

const tempo = (down: string, up: string): MetricDef[] => [
  { key: 'ecc', label: `Czas fazy ${down}`, short: 'w dół', unit: 's', views: ['front', 'side', 'oblique', 'unknown'], tol: 0.25, decimals: 1, help: 'Od ruszenia z góry do najniższego punktu.' },
  { key: 'pause', label: 'Pauza w dole', short: 'pauza', unit: 's', views: ['front', 'side', 'oblique', 'unknown'], tol: 0.2, decimals: 1, help: 'Jak długo kąt utrzymuje się blisko minimum.' },
  { key: 'con', label: `Czas fazy ${up}`, short: 'w górę', unit: 's', views: ['front', 'side', 'oblique', 'unknown'], tol: 0.2, decimals: 1, help: 'Od najniższego punktu do powrotu na górę.' },
]

export const PROFILES: Record<ExerciseKey, Profile> = {
  squat: {
    key: 'squat',
    name: 'Przysiad',
    beta: false,
    signal: 'knee',
    minRange: 35,
    anchor: 'ankles',
    facing: 'feet',
    trace: 'hip',
    traceLabel: 'tor bioder',
    phases: ['opuszczania', 'wstawania'],
    hint: 'Telefon na wysokości bioder, 2–3 m od klienta, cała sylwetka w kadrze. Z przodu: kolana i asymetria. Z boku: głębokość i pochylenie tułowia.',
    metrics: [
      { key: 'depth_knee', label: 'Kąt w kolanie w dole', short: 'kolano w dole', unit: '°', views: ['front', 'side', 'oblique', 'unknown'], tol: 6, decimals: 0, help: 'Najmniejszy kąt biodro–kolano–kostka. Mniej = głębiej.' },
      { key: 'depth_hip', label: 'Kąt w biodrze w dole', short: 'biodro w dole', unit: '°', views: ['side', 'oblique'], tol: 6, decimals: 0, help: 'Najmniejszy kąt bark–biodro–kolano.' },
      { key: 'trunk', label: 'Pochylenie tułowia w dole', short: 'pochylenie', unit: '°', views: ['side', 'oblique'], tol: 5, decimals: 0, help: 'Odchylenie linii biodra–barki od pionu.' },
      { key: 'valgus', label: 'Rozstaw kolan / kostek w dole', short: 'kolana/kostki', unit: '%', views: ['front'], tol: 6, decimals: 0, help: 'Odległość między kolanami względem kostek. Poniżej 100% kolana schodzą do środka.' },
      { key: 'asym', label: 'Asymetria kolan w dole', short: 'asymetria L/P', unit: '°', views: ['front'], tol: 4, decimals: 0, help: 'Różnica kąta lewego i prawego kolana.' },
      { key: 'shift', label: 'Przesunięcie bioder w bok', short: 'biodra w bok', unit: '%', views: ['front'], tol: 3, decimals: 0, help: 'Środek bioder względem środka stóp, w % szerokości bioder.' },
      ...tempo('opuszczania', 'wstawania'),
    ],
    flags: [
      { key: 'valgus', metric: 'valgus', op: '<', value: 85, label: 'możliwe koślawienie kolan' },
      { key: 'depth', metric: 'depth_knee', op: '>', value: 110, label: 'płytki przysiad' },
      { key: 'asym', metric: 'asym', op: '>', value: 12, label: 'asymetria lewa/prawa' },
      { key: 'shift', metric: 'shift', op: '>', value: 10, label: 'przesunięcie bioder w bok' },
      { key: 'trunk', metric: 'trunk', op: '>', value: 50, label: 'duże pochylenie tułowia' },
      { key: 'ecc', metric: 'ecc', op: '<', value: 0.6, label: 'opuszczanie bez kontroli' },
    ],
  },
  deadlift: {
    key: 'deadlift',
    name: 'Martwy ciąg',
    beta: true,
    signal: 'hip',
    minRange: 40,
    anchor: 'ankles',
    facing: 'feet',
    trace: 'wrist',
    traceLabel: 'tor sztangi (dłonie)',
    phases: ['opuszczania', 'podnoszenia'],
    hint: 'Telefon z boku na wysokości bioder, 2–3 m od klienta, sztanga i cała sylwetka w kadrze.',
    metrics: [
      { key: 'hip_bottom', label: 'Kąt w biodrze w dole', short: 'biodro w dole', unit: '°', views: ['side', 'oblique'], tol: 6, decimals: 0, help: 'Najmniejszy kąt bark–biodro–kolano.' },
      { key: 'knee_bottom', label: 'Kąt w kolanie w dole', short: 'kolano w dole', unit: '°', views: ['side', 'oblique'], tol: 6, decimals: 0, help: 'Kąt kolana w najniższym punkcie bioder.' },
      { key: 'trunk', label: 'Pochylenie tułowia w dole', short: 'pochylenie', unit: '°', views: ['side', 'oblique'], tol: 5, decimals: 0, help: 'Odchylenie pleców od pionu w dole.' },
      { key: 'lockout', label: 'Wyprost bioder na górze', short: 'wyprost', unit: '°', views: ['side', 'oblique'], tol: 4, decimals: 0, help: 'Największy kąt w biodrze po powtórzeniu; ok. 175–180° = pełny wyprost.' },
      { key: 'bar_drift', label: 'Odejście dłoni od linii stóp', short: 'tor sztangi', unit: '%', views: ['side', 'oblique'], tol: 4, decimals: 0, help: 'Największa pozioma odległość dłoni od środka stopy, w % długości tułowia.' },
      ...tempo('opuszczania', 'podnoszenia'),
    ],
    flags: [
      { key: 'lockout', metric: 'lockout', op: '<', value: 165, label: 'niepełny wyprost bioder' },
      { key: 'bar_drift', metric: 'bar_drift', op: '>', value: 20, label: 'sztanga odchodzi od nóg' },
    ],
  },
  pushup: {
    key: 'pushup',
    name: 'Pompka',
    beta: true,
    signal: 'elbow',
    minRange: 35,
    anchor: 'wrists',
    facing: 'head',
    trace: 'shoulder',
    traceLabel: 'tor barków',
    phases: ['opuszczania', 'wypychania'],
    hint: 'Telefon z boku na wysokości podłogi/łokci, 1,5–2 m od klienta, cała sylwetka w kadrze.',
    metrics: [
      { key: 'elbow_bottom', label: 'Kąt w łokciu w dole', short: 'łokieć w dole', unit: '°', views: ['side', 'oblique', 'front', 'unknown'], tol: 6, decimals: 0, help: 'Najmniejszy kąt bark–łokieć–nadgarstek. Mniej = głębiej.' },
      { key: 'body_line', label: 'Odchylenie linii ciała w dole', short: 'linia ciała', unit: '°', views: ['side', 'oblique'], tol: 4, decimals: 0, help: 'Odchylenie bark–biodro–kostka od prostej (biodra opadają lub są uniesione).' },
      ...tempo('opuszczania', 'wypychania'),
    ],
    flags: [
      { key: 'depth', metric: 'elbow_bottom', op: '>', value: 110, label: 'niepełny zakres ruchu' },
      { key: 'body_line', metric: 'body_line', op: '>', value: 15, label: 'linia ciała niestabilna' },
    ],
  },
}

export const EXERCISE_KEYS = Object.keys(PROFILES) as ExerciseKey[]

export type Thresholds = Partial<Record<ExerciseKey, Record<string, number>>>

export const thresholdFor = (th: Thresholds, ex: ExerciseKey, flag: FlagDef) => th[ex]?.[flag.key] ?? flag.value

export const VIEW_LABEL: Record<View, string> = { front: 'z przodu', side: 'z boku', oblique: 'pod kątem', unknown: 'nieznane ujęcie' }

export function fmtMetric(m: MetricDef, v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(m.decimals).replace('.', ',')}${m.unit === 's' ? ' s' : m.unit}`
}
