// Ćwiczenia analizowane z kamery: co liczy powtórzenia, co mierzymy i kiedy flagujemy.
// Progi to wartości startowe – trenerka kalibruje je w aplikacji (tabela analysis_settings).

/** Szczegółowe profile (squat, deadlift, pushup, press) + ogólne profile pozostałych rodzin ruchu. */
export type ExerciseKey =
  | 'squat'
  | 'deadlift'
  | 'pushup'
  | 'press'
  | 'lunge'
  | 'hip_thrust'
  | 'bench'
  | 'pullup'
  | 'pulldown'
  | 'row'
  | 'curl'
  | 'triceps'
  | 'lateral_raise'
  | 'front_raise'
  | 'fly'
  | 'calf'
  | 'crunch'
  | 'leg_raise'
  | 'knee_ext'
  | 'knee_flex'
export type View = 'front' | 'back' | 'side' | 'oblique' | 'unknown'
/** Ujęcia do wyboru przed nagraniem (auto = wykrycie z sylwetki; „z tyłu” trzeba wskazać – model go nie odróżni od przodu). */
export const VIEW_CHOICES: View[] = ['front', 'side', 'back', 'oblique']

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
  signal: 'knee' | 'hip' | 'elbow' | 'shoulder' | 'spread' | 'heel' // kąt (albo %), którego dolina = powtórzenie
  invert?: boolean // wartość rośnie przy wysiłku (unoszenie ramion, wspięcia) – sygnał = 180 − wartość
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

const DETAILED: Record<'squat' | 'deadlift' | 'pushup' | 'press', Profile> = {
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
      { key: 'valgus', label: 'Rozstaw kolan / kostek (najmniejszy w dolnej połowie ruchu)', short: 'kolana/kostki', unit: '%', views: ['front'], tol: 6, decimals: 0, help: 'Odległość między kolanami względem kostek. Poniżej 100% kolana schodzą do środka.' },
      { key: 'asym', label: 'Asymetria kolan w dole', short: 'asymetria L/P', unit: '°', views: ['front'], tol: 4, decimals: 0, help: 'Różnica kąta lewego i prawego kolana.' },
      { key: 'shift', label: 'Przesunięcie bioder w bok', short: 'biodra w bok', unit: '%', views: ['front'], tol: 3, decimals: 0, help: 'Środek bioder względem środka stóp, w % szerokości bioder.' },
      { key: 'hip_rise', label: 'Biodra przed barkami przy wstawaniu', short: 'biodra pierwsze', unit: '°', views: ['side', 'oblique'], tol: 3, decimals: 0, help: 'O ile stopni tułów pochyla się bardziej w pierwszej połowie wstawania. Dużo = biodra wstają szybciej niż barki.' },
      { key: 'back', label: 'Skrócenie tułowia (plecy)', short: 'plecy', unit: '%', views: ['side'], tol: 3, decimals: 0, help: 'O ile skraca się odcinek bark–biodro względem pozycji wyprostowanej. Pośredni znak zaokrąglenia pleców – model nie widzi kręgosłupa.' },
      { key: 'heel_lift', label: 'Uniesienie pięt', short: 'pięty', unit: '%', views: ['side'], tol: 5, decimals: 0, help: 'O ile pięta unosi się względem palców, w % długości stopy.' },
      ...tempo('opuszczania', 'wstawania'),
    ],
    flags: [
      { key: 'valgus', metric: 'valgus', op: '<', value: 85, label: 'możliwe koślawienie kolan' },
      { key: 'depth', metric: 'depth_knee', op: '>', value: 110, label: 'płytki przysiad' },
      { key: 'asym', metric: 'asym', op: '>', value: 12, label: 'asymetria lewa/prawa' },
      { key: 'shift', metric: 'shift', op: '>', value: 10, label: 'przesunięcie bioder w bok' },
      { key: 'trunk', metric: 'trunk', op: '>', value: 50, label: 'duże pochylenie tułowia' },
      { key: 'ecc', metric: 'ecc', op: '<', value: 0.6, label: 'opuszczanie bez kontroli' },
      { key: 'hip_rise', metric: 'hip_rise', op: '>', value: 10, label: 'biodra wstają pierwsze' },
      { key: 'back', metric: 'back', op: '>', value: 12, label: 'możliwe zaokrąglenie pleców' },
      { key: 'heel_lift', metric: 'heel_lift', op: '>', value: 22, label: 'możliwe odrywanie pięt' },
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
      { key: 'hip_rise', label: 'Biodra przed barkami przy ruszaniu', short: 'biodra pierwsze', unit: '°', views: ['side', 'oblique'], tol: 3, decimals: 0, help: 'O ile stopni tułów pochyla się bardziej w pierwszej połowie podnoszenia. Dużo = kolana prostują się, zanim ruszy tułów.' },
      { key: 'back', label: 'Skrócenie tułowia (plecy)', short: 'plecy', unit: '%', views: ['side'], tol: 3, decimals: 0, help: 'O ile skraca się odcinek bark–biodro względem pozycji wyprostowanej. Pośredni znak zaokrąglenia pleców – model nie widzi kręgosłupa.' },
      ...tempo('opuszczania', 'podnoszenia'),
    ],
    flags: [
      { key: 'lockout', metric: 'lockout', op: '<', value: 165, label: 'niepełny wyprost bioder' },
      { key: 'bar_drift', metric: 'bar_drift', op: '>', value: 20, label: 'sztanga odchodzi od nóg' },
      { key: 'hip_rise', metric: 'hip_rise', op: '>', value: 8, label: 'biodra wstają za szybko' },
      { key: 'back', metric: 'back', op: '>', value: 10, label: 'możliwe zaokrąglenie pleców' },
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
  press: {
    key: 'press',
    name: 'Wyciskanie nad głowę',
    beta: true,
    signal: 'elbow',
    minRange: 40,
    anchor: 'ankles',
    facing: 'feet',
    trace: 'wrist',
    traceLabel: 'tor dłoni',
    phases: ['opuszczania', 'wyciskania'],
    hint: 'Telefon na wysokości klatki, 2–3 m od klienta, cała sylwetka z rękami w górze w kadrze. Z przodu: symetria rąk. Z boku: odchylanie tułowia.',
    metrics: [
      { key: 'elbow_bottom', label: 'Kąt w łokciu w dole', short: 'łokieć w dole', unit: '°', views: ['front', 'side', 'oblique', 'unknown'], tol: 8, decimals: 0, help: 'Najmniejszy kąt bark–łokieć–nadgarstek.' },
      { key: 'lockout', label: 'Wyprost łokci na górze', short: 'wyprost', unit: '°', views: ['front', 'side', 'oblique', 'unknown'], tol: 5, decimals: 0, help: 'Największy kąt w łokciu po wyciśnięciu; ok. 170–180° = pełny wyprost.' },
      { key: 'wrist_asym', label: 'Różnica wysokości dłoni', short: 'asymetria rąk', unit: '%', views: ['front'], tol: 4, decimals: 0, help: 'Największa różnica wysokości nadgarstków podczas wyciskania, w % szerokości barków.' },
      { key: 'lean', label: 'Odchylenie tułowia', short: 'odchylenie', unit: '°', views: ['side', 'oblique'], tol: 4, decimals: 0, help: 'Największe odchylenie linii biodra–barki od pionu.' },
      ...tempo('opuszczania', 'wyciskania'),
    ],
    flags: [
      { key: 'wrist_asym', metric: 'wrist_asym', op: '>', value: 12, label: 'asymetria pracy ramion' },
      { key: 'lockout', metric: 'lockout', op: '<', value: 160, label: 'niepełny wyprost łokci' },
      { key: 'lean', metric: 'lean', op: '>', value: 15, label: 'odchylanie tułowia' },
    ],
  },
}

// ===================== Ogólne profile rodzin ruchu =====================
// Liczą powtórzenia, tempo, wartość w punkcie zwrotnym i zakres ruchu stawu, który pracuje.
// Szczegółowe porównanie ze wzorcem (wszystkie stawy) robi families.ts → comparePattern.
interface GenericSpec {
  name: string
  signal: Profile['signal']
  invert?: boolean
  minRange: number
  rangeFlag: number // minimalny zakres ruchu, poniżej – „niepełny zakres”
  turnLabel: string
  unit?: '°' | '%'
  phases: [string, string]
  hint: string
  anchor?: Profile['anchor']
  facing?: Profile['facing']
  trace?: Profile['trace']
}
function generic(key: ExerciseKey, g: GenericSpec): Profile {
  const unit = g.unit ?? '°'
  const all: View[] = ['front', 'side', 'oblique', 'unknown']
  const trace = g.trace ?? 'wrist'
  return {
    key,
    name: g.name,
    beta: true,
    signal: g.signal,
    invert: g.invert,
    minRange: g.minRange,
    anchor: g.anchor ?? 'ankles',
    facing: g.facing ?? 'feet',
    trace,
    traceLabel: trace === 'hip' ? 'tor bioder' : trace === 'shoulder' ? 'tor barków' : 'tor dłoni',
    phases: g.phases,
    hint: g.hint,
    metrics: [
      { key: 'turn', label: g.turnLabel, short: 'punkt zwrotny', unit, views: all, tol: 6, decimals: 0, help: 'Wartość kąta (albo rozstawu) w najdalszym punkcie ruchu.' },
      { key: 'range', label: 'Zakres ruchu', short: 'zakres', unit, views: all, tol: 6, decimals: 0, help: 'Różnica między pozycją startową a punktem zwrotnym.' },
      { key: 'trunk_move', label: 'Ruch tułowia', short: 'tułów', unit: '°', views: all, tol: 4, decimals: 0, help: 'O ile zmienia się pochylenie tułowia w powtórzeniu – w ćwiczeniach izolowanych powinno być małe.' },
      ...tempo(g.phases[0], g.phases[1]),
    ],
    flags: [{ key: 'range', metric: 'range', op: '<', value: g.rangeFlag, label: 'niepełny zakres ruchu' }],
  }
}
const SIDE = 'Telefon z boku, 2–3 m od ćwiczącego, cała sylwetka w kadrze.'
const GENERIC: Record<Exclude<ExerciseKey, keyof typeof DETAILED>, Profile> = {
  lunge: generic('lunge', { name: 'Wykrok', signal: 'knee', minRange: 35, rangeFlag: 55, turnLabel: 'Kąt w kolanie w dole', phases: ['opuszczania', 'wstawania'], hint: SIDE, trace: 'hip' }),
  hip_thrust: generic('hip_thrust', { name: 'Hip thrust', signal: 'hip', minRange: 30, rangeFlag: 45, turnLabel: 'Kąt w biodrze w dole', phases: ['opuszczania', 'wypychania'], hint: SIDE, trace: 'hip' }),
  bench: generic('bench', { name: 'Wyciskanie leżąc', signal: 'elbow', minRange: 35, rangeFlag: 55, turnLabel: 'Kąt w łokciu w dole', phases: ['opuszczania', 'wyciskania'], hint: 'Telefon z boku ławki na wysokości ławki, 1,5–2 m, cała sylwetka z rękami w kadrze.', anchor: 'wrists', facing: 'head' }),
  pullup: generic('pullup', { name: 'Podciąganie', signal: 'elbow', minRange: 40, rangeFlag: 70, turnLabel: 'Kąt w łokciu na górze', phases: ['podciągania', 'opuszczania'], hint: 'Telefon z tyłu albo z boku, 3 m od drążka, cała sylwetka z drążkiem w kadrze.', anchor: 'wrists', facing: 'head', trace: 'shoulder' }),
  pulldown: generic('pulldown', { name: 'Ściąganie drążka', signal: 'elbow', minRange: 35, rangeFlag: 60, turnLabel: 'Kąt w łokciu na dole', phases: ['ściągania', 'oddawania'], hint: 'Telefon z tyłu albo z boku, 2–3 m, ręce z drążkiem w kadrze.', anchor: 'ankles' }),
  row: generic('row', { name: 'Wiosłowanie', signal: 'elbow', minRange: 30, rangeFlag: 50, turnLabel: 'Kąt w łokciu przy przyciągnięciu', phases: ['przyciągania', 'oddawania'], hint: SIDE }),
  curl: generic('curl', { name: 'Uginanie ramion', signal: 'elbow', minRange: 50, rangeFlag: 85, turnLabel: 'Kąt w łokciu na górze', phases: ['uginania', 'opuszczania'], hint: SIDE }),
  triceps: generic('triceps', { name: 'Prostowanie ramion', signal: 'elbow', minRange: 40, rangeFlag: 60, turnLabel: 'Kąt w łokciu przy zgięciu', phases: ['zginania', 'prostowania'], hint: SIDE }),
  lateral_raise: generic('lateral_raise', { name: 'Unoszenie bokiem', signal: 'shoulder', invert: true, minRange: 35, rangeFlag: 55, turnLabel: 'Uniesienie ramienia na górze', phases: ['unoszenia', 'opuszczania'], hint: 'Telefon z przodu, 2–3 m, cała sylwetka z rękami w kadrze.' }),
  front_raise: generic('front_raise', { name: 'Unoszenie przodem', signal: 'shoulder', invert: true, minRange: 35, rangeFlag: 55, turnLabel: 'Uniesienie ramienia na górze', phases: ['unoszenia', 'opuszczania'], hint: SIDE }),
  fly: generic('fly', { name: 'Rozpiętki', signal: 'spread', minRange: 60, rangeFlag: 120, turnLabel: 'Rozstaw dłoni przy złączeniu', unit: '%', phases: ['złączania', 'rozpinania'], hint: 'Telefon z przodu albo z góry, cała sylwetka z rękami w kadrze.' }),
  calf: generic('calf', { name: 'Wspięcia na palce', signal: 'heel', invert: true, minRange: 12, rangeFlag: 20, turnLabel: 'Uniesienie pięty (% długości stopy)', unit: '%', phases: ['wspinania', 'opuszczania'], hint: 'Telefon z boku na wysokości stóp, 1,5–2 m, całe stopy w kadrze.', trace: 'hip' }),
  crunch: generic('crunch', { name: 'Spięcia brzucha', signal: 'hip', minRange: 15, rangeFlag: 22, turnLabel: 'Kąt w biodrze przy spięciu', phases: ['spinania', 'opuszczania'], hint: 'Telefon z boku na wysokości podłogi, 1,5–2 m.', facing: 'head', trace: 'shoulder' }),
  leg_raise: generic('leg_raise', { name: 'Unoszenie nóg', signal: 'hip', minRange: 40, rangeFlag: 60, turnLabel: 'Kąt w biodrze na górze', phases: ['unoszenia', 'opuszczania'], hint: SIDE, trace: 'hip' }),
  knee_ext: generic('knee_ext', { name: 'Prostowanie nóg', signal: 'knee', minRange: 35, rangeFlag: 55, turnLabel: 'Kąt w kolanie przy zgięciu', phases: ['opuszczania', 'prostowania'], hint: 'Telefon z boku maszyny, 1,5–2 m.' }),
  knee_flex: generic('knee_flex', { name: 'Uginanie nóg', signal: 'knee', minRange: 35, rangeFlag: 55, turnLabel: 'Kąt w kolanie przy zgięciu', phases: ['uginania', 'prostowania'], hint: 'Telefon z boku maszyny, 1,5–2 m.' }),
}
export const PROFILES: Record<ExerciseKey, Profile> = { ...DETAILED, ...GENERIC }

export const EXERCISE_KEYS = Object.keys(PROFILES) as ExerciseKey[]
/** Podpis wartości sygnału na odtwarzaczu (np. „kolano 92°”). */
export const SIGNAL_LABEL: Record<Profile['signal'], string> = { knee: 'kolano', hip: 'biodro', elbow: 'łokieć', shoulder: 'bark', spread: 'rozstaw dłoni', heel: 'pięta' }

export type Thresholds = Partial<Record<ExerciseKey, Record<string, number>>>

export const thresholdFor = (th: Thresholds, ex: ExerciseKey, flag: FlagDef) => th[ex]?.[flag.key] ?? flag.value

export const VIEW_LABEL: Record<View, string> = { front: 'z przodu', back: 'z tyłu', side: 'z boku', oblique: 'pod kątem', unknown: 'nieznane ujęcie' }

export function fmtMetric(m: MetricDef, v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(m.decimals).replace('.', ',')}${m.unit === 's' ? ' s' : m.unit}`
}
