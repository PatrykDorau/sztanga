// Rodziny ruchu: jeden wzorzec na grupę ćwiczeń o tej samej mechanice (przysiad, zawias biodrowy, wiosłowanie…).
// Wzorzec to sylwetka 2D w dwóch pozycjach (start i punkt zwrotny) – z niego powstaje:
//  1) animowany ludzik na karcie ćwiczenia,
//  2) „podpis” ruchu: które stawy pracują i w jakim zakresie (do automatycznego rozpoznania nagrania),
//  3) porównanie powtórzeń klienta ze wzorcem (zakresy ruchu stawów).
// Kąty stawów z kamery liczymy w 3D, więc nie zależą od ujęcia – porównujemy zakresy, nie piksele.
// Czysty TS, bez przeglądarki.
import { norm } from '@/lib/search'
import type { Exercise } from '@/types'
import type { ExerciseKey } from './profiles'
import { mean, percentile, type Rep, type Series } from './analysis'

export type FamilyKey =
  | 'squat'
  | 'lunge'
  | 'hinge'
  | 'hip_thrust'
  | 'bench'
  | 'ohp'
  | 'landmine_press'
  | 'pushup'
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

// ===================== Kinematyka ludzika =====================
export type P = [number, number] // metry, x = do przodu (w prawo), y = w górę, podłoga y = 0
const L = { shin: 0.45, thigh: 0.45, trunk: 0.55, arm: 0.3, fore: 0.27, neck: 0.24 }

/** Sylwetka do narysowania. Z boku: jedna strona (+ druga noga przy wykroku). Z przodu: obie strony. */
export interface Fig {
  view: 'side' | 'front'
  armSide?: boolean // ramię pracuje w bok – na rysunku z boku kąt łokcia jest spłaszczony
  head: P
  shoulder: P
  elbow: P
  wrist: P
  hip: P
  knee: P
  ankle: P
  heel: P
  toe: P
  // druga strona (z przodu) albo druga noga (wykrok)
  shoulder2?: P
  elbow2?: P
  wrist2?: P
  hip2?: P
  knee2?: P
  ankle2?: P
  heel2?: P
  toe2?: P
}

const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]]
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k]
const lenP = (a: P) => Math.hypot(a[0], a[1])
const dir = (deg: number): P => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)]

/**
 * Dwa odcinki od a w stronę celu c; zgięcie po stronie wskazanej przez hint. Zwraca staw środkowy i koniec kończyny.
 * Cel poza zasięgiem = kończyna prosta w jego stronę (koniec nie „dociąga się” do celu – długości zawsze się zgadzają).
 */
function limb(a: P, c: P, l1: number, l2: number, hint: P): [P, P] {
  const v = sub(c, a)
  const raw = lenP(v) || 1e-6
  const u: P = [v[0] / raw, v[1] / raw]
  if (raw >= l1 + l2 - 1e-6) return [add(a, mul(u, l1)), add(a, mul(u, l1 + l2))]
  const d = Math.max(Math.abs(l1 - l2) + 1e-6, raw)
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x))
  const n: P = [-u[1], u[0]]
  const s = n[0] * hint[0] + n[1] * hint[1] >= 0 ? 1 : -1
  return [add(add(a, mul(u, x)), mul(n, h * s)), c]
}
const ik = (a: P, c: P, l1: number, l2: number, hint: P) => limb(a, c, l1, l2, hint)[0]

/** Ustawienie z boku – liczby, żeby dało się płynnie przechodzić między pozycjami. */
interface SideKey {
  hip: P
  trunk?: number // pochylenie tułowia: 0 = pion, 90 = do przodu poziomo, −90 = do tyłu
  shoulder?: P // zamiast trunk, gdy barki są w stałym miejscu (ławka, podłoga)
  ankle: P
  ankle2?: P // druga noga (wykrok)
  wrist?: P // dłoń w miejscu stałym (drążek, podłoga)
  wristRel?: P // dłoń względem barku
  kneeHint: P
  kneeHint2?: P // druga noga, gdy zgina się inaczej (półklęk: przednie kolano w górę, tylne w dół)
  elbowHint: P
  toeFloor?: number // 1 = palce na podłodze (wspięcia)
  /** Ramię odwiedzone w bok (sztanga na plecach, podciąganie, ściąganie) – rysunek z boku spłaszcza ruch w płaszczyźnie czołowej. */
  armSide?: number
}
interface FrontKey {
  hipY: number
  shoulderY: number
  wristR: P // prawa dłoń (lewa = lustro)
  elbowHint: P
}

function sideFig(k: SideKey): Fig {
  const shoulder = k.shoulder ?? add(k.hip, mul(dir(k.trunk ?? 0), L.trunk))
  const up = sub(shoulder, k.hip)
  const head = add(shoulder, mul(up, L.neck / (lenP(up) || 1)))
  const [knee, ankle] = limb(k.hip, k.ankle, L.thigh, L.shin, k.kneeHint)
  const [elbow, wrist] = limb(shoulder, k.wrist ?? add(shoulder, k.wristRel ?? [0, -0.56]), L.arm, L.fore, k.elbowHint)
  const foot = (a: P): [P, P] => (k.toeFloor ? [[a[0] - 0.05, a[1] - 0.07], [a[0] + 0.15, 0.01]] : [[a[0] - 0.05, a[1] - 0.07], [a[0] + 0.15, a[1] - 0.07]])
  const [heel, toe] = foot(ankle)
  const f: Fig = { view: 'side', head, shoulder, elbow, wrist, hip: k.hip, knee, ankle, heel, toe, armSide: !!k.armSide }
  if (k.ankle2) {
    const [knee2, ankle2] = limb(k.hip, k.ankle2, L.thigh, L.shin, k.kneeHint2 ?? k.kneeHint)
    f.knee2 = knee2
    f.ankle2 = ankle2
    ;[f.heel2, f.toe2] = [
      [ankle2[0] - 0.05, ankle2[1] - 0.06],
      [ankle2[0] + 0.13, Math.max(0.01, ankle2[1] - 0.11)],
    ]
  }
  return f
}

function frontFig(k: FrontKey): Fig {
  const shoulder: P = [0.19, k.shoulderY]
  const hip: P = [0.11, k.hipY]
  const ankle: P = [0.14, k.hipY - Math.sqrt(0.81 - 0.0009)] // noga prosta
  const [elbow, wrist] = limb(shoulder, k.wristR, L.arm, L.fore, k.elbowHint)
  const knee = ik(hip, ankle, L.thigh, L.shin, [1, 0])
  const m = (p: P): P => [-p[0], p[1]]
  return {
    view: 'front',
    head: [0, k.shoulderY + 0.24],
    shoulder,
    elbow,
    wrist,
    hip,
    knee,
    ankle,
    heel: [0.14, 0.01],
    toe: [0.2, 0.01],
    shoulder2: m(shoulder),
    elbow2: m(elbow),
    wrist2: m(wrist),
    hip2: m(hip),
    knee2: m(knee),
    ankle2: m(ankle),
    heel2: [-0.14, 0.01],
    toe2: [-0.2, 0.01],
  }
}

function lerpKey<T extends object>(a: T, b: T, f: number): T {
  const out: Record<string, unknown> = {}
  for (const [k, va] of Object.entries(a)) {
    const vb = (b as Record<string, unknown>)[k]
    if (typeof va === 'number' && typeof vb === 'number') out[k] = va + (vb - va) * f
    else if (Array.isArray(va) && Array.isArray(vb)) out[k] = [va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f]
    else out[k] = va
  }
  return out as T
}

// ===================== Rekwizyty i warianty =====================
export type Variant = 'barbell' | 'dumbbell' | 'kettlebell' | 'cable' | 'machine' | 'band' | 'body'
export function variantOf(equipment: string[] | null | undefined): Variant {
  const q = equipment ?? []
  if (q.includes('barbell') || q.includes('e-z curl bar')) return 'barbell'
  if (q.includes('cable')) return 'cable'
  if (q.includes('machine')) return 'machine'
  if (q.includes('dumbbell')) return 'dumbbell'
  if (q.includes('kettlebells')) return 'kettlebell'
  if (q.includes('bands')) return 'band'
  return 'body'
}

export interface Props2 {
  bench?: [number, number, number] // x0, x1, wysokość
  seat?: [number, number, number]
  bar?: [number, number, number] // drążek: x0, x1, y
  pulley?: P // punkt zaczepienia linki
  pulley2?: P
  lever?: P // landmine: punkt oparcia sztangi na podłodze (sztanga od punktu do dłoni)
}

export interface Family {
  key: FamilyKey
  name: string
  profile: ExerciseKey // profil analizy (pomiary, flagi)
  view: 'front' | 'side' | 'back' // zalecane ujęcie do nagrania
  /** true = ruch od pozycji 0 do 1 to faza koncentryczna (z wysiłkiem) – dla tempa animacji. */
  effortTo1?: boolean
  pose: (phase: number, v: Variant) => Fig
  props?: (v: Variant) => Props2
  /** Poprawki podpisu, gdy rysunek 2D zniekształca kąty 3D (np. rozpiętki – ruch w poziomie widziany z przodu). */
  sigFix?: { rom?: Partial<Record<JointKey, number>>; spreadRom?: number }
}

/** Przejście po łuku (promień i kąt), żeby ręka / noga nie skracała się w połowie ruchu. */
function polar(u: P, v: P, f: number): P {
  const r = lenP(u) + (lenP(v) - lenP(u)) * f
  const a0 = Math.atan2(u[1], u[0])
  let d = Math.atan2(v[1], v[0]) - a0
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  const a = a0 + d * f
  return [Math.cos(a) * r, Math.sin(a) * r]
}
const same = (a?: P, b?: P) => !!a && !!b && a[0] === b[0] && a[1] === b[1]
const shoulderOf = (k: SideKey) => k.shoulder ?? add(k.hip, mul(dir(k.trunk ?? 0), L.trunk))
function lerpSide(a: SideKey, b: SideKey, f: number): SideKey {
  const k = lerpKey(a, b, f)
  if (a.wristRel && b.wristRel) k.wristRel = polar(a.wristRel, b.wristRel, f)
  else if (a.wrist && b.wrist && !same(a.wrist, b.wrist)) k.wrist = add(shoulderOf(k), polar(sub(a.wrist, shoulderOf(a)), sub(b.wrist, shoulderOf(b)), f))
  if (!same(a.ankle, b.ankle)) k.ankle = add(k.hip, polar(sub(a.ankle, a.hip), sub(b.ankle, b.hip), f))
  return k
}
const side = (a: SideKey, b: SideKey) => (f: number) => sideFig(lerpSide(a, b, f))
const front = (a: FrontKey, b: FrontKey) => (f: number) => {
  const k = lerpKey(a, b, f)
  k.wristR = add([0.19, k.shoulderY], polar(sub(a.wristR, [0.19, a.shoulderY]), sub(b.wristR, [0.19, b.shoulderY]), f))
  return frontFig(k)
}
const A0: P = [0, 0.08] // kostka stojąc
const STAND = { ankle: A0, kneeHint: [1, 0] as P }

// Ręce zależnie od sprzętu przy ruchach nóg
const legArms = (v: Variant): Pick<SideKey, 'wristRel' | 'elbowHint' | 'armSide'> =>
  v === 'barbell'
    ? { wristRel: [-0.2, 0.0], elbowHint: [-0.3, -1], armSide: 1 } // sztanga na plecach (łokcie w dół i w bok)
    : v === 'kettlebell' || v === 'dumbbell'
      ? { wristRel: [0.2, -0.14], elbowHint: [0, -1] } // goblet / hantel przy klatce
      : v === 'body'
        ? { wristRel: [0.55, 0], elbowHint: [0, -1] } // ręce przed sobą
        : { wristRel: [0.02, -0.56], elbowHint: [0, -1] }
const hangArms = { wristRel: [0.02, -0.56] as P, elbowHint: [0, -1] as P }

export const FAMILIES: Record<FamilyKey, Family> = {
  squat: {
    key: 'squat',
    name: 'Przysiad',
    profile: 'squat',
    view: 'side',
    pose: (f, v) => side({ ...STAND, hip: [-0.02, 0.985], trunk: 2, ...legArms(v) }, { ...STAND, hip: [-0.25, 0.66], trunk: 40, ...legArms(v) })(f),
  },
  lunge: {
    key: 'lunge',
    name: 'Wykrok / przysiad jednonóż',
    profile: 'lunge',
    view: 'side',
    pose: (f, v) => {
      const arms = v === 'barbell' ? legArms(v) : hangArms
      return side(
        { hip: [0, 0.92], trunk: 4, ankle: [0.36, 0.08], ankle2: [-0.42, 0.12], kneeHint: [1, 0], ...arms },
        { hip: [-0.02, 0.52], trunk: 6, ankle: [0.36, 0.08], ankle2: [-0.42, 0.12], kneeHint: [1, 0], ...arms },
      )(f)
    },
  },
  hinge: {
    key: 'hinge',
    name: 'Zawias biodrowy (martwy ciąg)',
    profile: 'deadlift',
    view: 'side',
    pose: (f) => side({ ...STAND, hip: [-0.03, 0.985], trunk: 2, wristRel: [0, -0.56], elbowHint: [-1, 0] }, { ...STAND, hip: [-0.4, 0.82], trunk: 70, wristRel: [0, -0.57], elbowHint: [-1, 0] })(f),
  },
  hip_thrust: {
    key: 'hip_thrust',
    name: 'Wypychanie bioder (hip thrust)',
    profile: 'hip_thrust',
    view: 'side',
    pose: (f) =>
      side(
        { hip: [0.05, 0.52], shoulder: [-0.48, 0.47], ankle: [0.3, 0.08], kneeHint: [0, 1], wristRel: [0.45, 0.12], elbowHint: [0, -1] },
        { hip: [-0.12, 0.2], shoulder: [-0.48, 0.47], ankle: [0.3, 0.08], kneeHint: [0, 1], wristRel: [0.34, -0.12], elbowHint: [0, -1] },
      )(f),
    props: () => ({ bench: [-0.8, -0.3, 0.42] }),
  },
  bench: {
    key: 'bench',
    name: 'Wyciskanie leżąc',
    profile: 'bench',
    view: 'side',
    pose: (f) =>
      side(
        { hip: [0.12, 0.53], shoulder: [-0.42, 0.55], ankle: [0.5, 0.08], kneeHint: [1, 1], wrist: [-0.4, 1.12], elbowHint: [0.3, -1] },
        { hip: [0.12, 0.53], shoulder: [-0.42, 0.55], ankle: [0.5, 0.08], kneeHint: [1, 1], wrist: [-0.32, 0.68], elbowHint: [0.3, -1] },
      )(f),
    props: () => ({ bench: [-0.8, 0.25, 0.45] }),
    // Łokcie odwiedzione w bok: w 3D kąt biodro–bark–łokieć zmienia się mniej niż na rysunku z boku.
    sigFix: { rom: { shoulder: 35 } },
  },
  ohp: {
    key: 'ohp',
    name: 'Wyciskanie nad głowę',
    profile: 'press',
    view: 'front',
    pose: (f) => side({ ...STAND, hip: [0, 0.985], trunk: 0, wristRel: [0.04, 0.56], elbowHint: [0.5, -1] }, { ...STAND, hip: [0, 0.985], trunk: 0, wristRel: [0.2, 0.1], elbowHint: [0.5, -1] })(f),
  },
  landmine_press: {
    key: 'landmine_press',
    name: 'Wyciskanie landmine (z półklęku do wstania)',
    profile: 'press',
    view: 'side',
    effortTo1: true,
    // Start: półklęk (tylne kolano przy podłodze), koniec sztangi przy barku. Ruch: wstanie i wyciśnięcie wzdłuż sztangi.
    pose: (f) =>
      side(
        { hip: [-0.05, 0.55], trunk: 4, ankle: [0.4, 0.08], ankle2: [-0.6, 0.1], kneeHint: [1, 1], kneeHint2: [0.3, -1], wristRel: [0.18, -0.04], elbowHint: [0.2, -1] },
        { hip: [-0.02, 0.93], trunk: 6, ankle: [0.3, 0.08], ankle2: [-0.3, 0.12], kneeHint: [1, 0], kneeHint2: [1, 0], wristRel: [0.42, 0.36], elbowHint: [0.2, -1] },
      )(f),
    props: () => ({ lever: [1.55, 0.04] }),
  },
  pushup: {
    key: 'pushup',
    name: 'Pompka',
    profile: 'pushup',
    view: 'side',
    pose: (f) =>
      side(
        { hip: [0.249, 0.398], shoulder: [0.77, 0.58], ankle: [-0.6, 0.1], wrist: [0.8, 0.02], kneeHint: [0, -1], elbowHint: [-0.6, 1] },
        { hip: [0.293, 0.143], shoulder: [0.84, 0.17], ankle: [-0.6, 0.1], wrist: [0.8, 0.02], kneeHint: [0, -1], elbowHint: [-0.6, 1] },
      )(f),
  },
  pullup: {
    key: 'pullup',
    name: 'Podciąganie na drążku',
    profile: 'pullup',
    view: 'back',
    effortTo1: true,
    pose: (f) =>
      side(
        { hip: [0, 1.14], shoulder: [0, 1.69], ankle: [0.02, 0.235], wrist: [0.02, 2.25], kneeHint: [1, 0], elbowHint: [0.5, -1], armSide: 1 },
        { hip: [-0.04, 1.47], shoulder: [-0.03, 2.02], ankle: [0.0, 0.565], wrist: [0.02, 2.25], kneeHint: [1, 0], elbowHint: [0.5, -1], armSide: 1 },
      )(f),
    props: () => ({ bar: [-0.3, 0.35, 2.25] }),
  },
  pulldown: {
    key: 'pulldown',
    name: 'Ściąganie drążka (wyciąg górny)',
    profile: 'pulldown',
    view: 'back',
    effortTo1: true,
    pose: (f) =>
      side(
        { hip: [0, 0.55], trunk: -8, ankle: [0.45, 0.08], kneeHint: [1, 1], wristRel: [0.03, 0.565], elbowHint: [-0.3, -1], armSide: 1 },
        { hip: [0, 0.55], trunk: -8, ankle: [0.45, 0.08], kneeHint: [1, 1], wristRel: [0.08, 0.15], elbowHint: [-0.3, -1], armSide: 1 },
      )(f),
    props: () => ({ seat: [-0.25, 0.2, 0.5], pulley: [0, 2.3] }),
  },
  row: {
    key: 'row',
    name: 'Wiosłowanie',
    profile: 'row',
    view: 'side',
    effortTo1: true,
    pose: (f, v) =>
      v === 'cable' || v === 'machine' || v === 'band'
        ? side(
            { hip: [0, 0.35], trunk: 10, ankle: [0.78, 0.18], kneeHint: [0, 1], wristRel: [0.55, -0.05], elbowHint: [-1, 0] },
            { hip: [0, 0.35], trunk: -5, ankle: [0.78, 0.18], kneeHint: [0, 1], wristRel: [0.12, -0.25], elbowHint: [-1, 0] },
          )(f)
        : side(
            { ...STAND, hip: [-0.28, 0.86], trunk: 68, wristRel: [0, -0.55], elbowHint: [-0.3, 1] },
            { ...STAND, hip: [-0.28, 0.86], trunk: 68, wristRel: [-0.12, -0.22], elbowHint: [-0.3, 1] },
          )(f),
    props: (v) => (v === 'cable' || v === 'machine' || v === 'band' ? { seat: [-0.25, 0.2, 0.3], pulley: [1.05, 0.25] } : {}),
  },
  curl: {
    key: 'curl',
    name: 'Uginanie ramion (biceps)',
    profile: 'curl',
    view: 'side',
    effortTo1: true,
    pose: (f) => side({ ...STAND, hip: [0, 0.985], trunk: 0, wristRel: [0.04, -0.56], elbowHint: [-0.2, -1] }, { ...STAND, hip: [0, 0.985], trunk: 0, wristRel: [0.14, -0.07], elbowHint: [-0.2, -1] })(f),
    props: (v) => (v === 'cable' ? { pulley: [0.45, 0.15] } : {}),
  },
  triceps: {
    key: 'triceps',
    name: 'Prostowanie ramion (triceps)',
    profile: 'triceps',
    view: 'side',
    pose: (f, v) =>
      v === 'cable' || v === 'machine' || v === 'band'
        ? side({ ...STAND, hip: [0, 0.985], trunk: 8, wristRel: [0.06, -0.56], elbowHint: [-0.2, -1] }, { ...STAND, hip: [0, 0.985], trunk: 8, wristRel: [0.22, -0.18], elbowHint: [-0.2, -1] })(f)
        : side({ ...STAND, hip: [0, 0.985], trunk: 0, wristRel: [0.03, 0.56], elbowHint: [0.3, 1] }, { ...STAND, hip: [0, 0.985], trunk: 0, wristRel: [-0.12, 0.18], elbowHint: [0.3, 1] })(f),
    props: (v) => (v === 'cable' || v === 'machine' || v === 'band' ? { pulley: [0.35, 2.2] } : {}),
  },
  lateral_raise: {
    key: 'lateral_raise',
    name: 'Unoszenie ramion bokiem',
    profile: 'lateral_raise',
    view: 'front',
    effortTo1: true,
    pose: (f) => front({ hipY: 0.97, shoulderY: 1.52, wristR: [0.25, 0.97], elbowHint: [0, -1] }, { hipY: 0.97, shoulderY: 1.52, wristR: [0.74, 1.5], elbowHint: [0, -1] })(f),
  },
  front_raise: {
    key: 'front_raise',
    name: 'Unoszenie ramion przodem',
    profile: 'front_raise',
    view: 'side',
    effortTo1: true,
    pose: (f) => side({ ...STAND, hip: [0, 0.985], trunk: 0, wristRel: [0.03, -0.56], elbowHint: [0, -1] }, { ...STAND, hip: [0, 0.985], trunk: 0, wristRel: [0.56, 0.02], elbowHint: [0, -1] })(f),
  },
  fly: {
    key: 'fly',
    name: 'Rozpiętki',
    profile: 'fly',
    view: 'front',
    effortTo1: true,
    pose: (f) => front({ hipY: 0.97, shoulderY: 1.52, wristR: [0.72, 1.5], elbowHint: [0, -1] }, { hipY: 0.97, shoulderY: 1.52, wristR: [0.1, 1.25], elbowHint: [0, -1] })(f),
    props: (v) => (v === 'cable' ? { pulley: [0.95, 2.0], pulley2: [-0.95, 2.0] } : {}),
    // W 3D ramię zostaje na wysokości barku i idzie do przodu: kąt biodro–bark–łokieć prawie stały, łokieć lekko ugięty.
    sigFix: { rom: { shoulder: 12, elbow: 15 }, spreadRom: 260 },
  },
  calf: {
    key: 'calf',
    name: 'Wspięcia na palce',
    profile: 'calf',
    view: 'side',
    effortTo1: true,
    pose: (f) =>
      side({ ankle: [0, 0.08], hip: [0, 0.985], trunk: 0, kneeHint: [1, 0], toeFloor: 1, ...hangArms }, { ankle: [0, 0.17], hip: [0, 1.075], trunk: 0, kneeHint: [1, 0], toeFloor: 1, ...hangArms })(f),
  },
  crunch: {
    key: 'crunch',
    name: 'Spięcia brzucha',
    profile: 'crunch',
    view: 'side',
    effortTo1: true,
    pose: (f) =>
      side(
        { hip: [0, 0.12], shoulder: [-0.55, 0.13], ankle: [0.42, 0.08], kneeHint: [0, 1], wristRel: [-0.14, 0.06], elbowHint: [0, 1] },
        { hip: [0, 0.12], shoulder: [-0.48, 0.36], ankle: [0.42, 0.08], kneeHint: [0, 1], wristRel: [-0.1, 0.13], elbowHint: [0, 1] },
      )(f),
  },
  leg_raise: {
    key: 'leg_raise',
    name: 'Unoszenie nóg',
    profile: 'leg_raise',
    view: 'side',
    effortTo1: true,
    pose: (f) =>
      side(
        { hip: [0, 1.14], shoulder: [0, 1.69], ankle: [0.02, 0.235], wrist: [0.02, 2.25], kneeHint: [1, 0], elbowHint: [0, -1] },
        { hip: [0, 1.14], shoulder: [0, 1.69], ankle: [0.9, 1.12], wrist: [0.02, 2.25], kneeHint: [1, 0], elbowHint: [0, -1] },
      )(f),
    props: () => ({ bar: [-0.3, 0.35, 2.25] }),
  },
  knee_ext: {
    key: 'knee_ext',
    name: 'Prostowanie nóg (maszyna)',
    profile: 'knee_ext',
    view: 'side',
    pose: (f) =>
      side(
        { hip: [0, 0.55], trunk: -5, ankle: [0.9, 0.6], kneeHint: [1, 1], wristRel: [0.2, -0.45], elbowHint: [0, -1] },
        { hip: [0, 0.55], trunk: -5, ankle: [0.47, 0.11], kneeHint: [1, 1], wristRel: [0.2, -0.45], elbowHint: [0, -1] },
      )(f),
    props: () => ({ seat: [-0.25, 0.42, 0.5] }),
  },
  knee_flex: {
    key: 'knee_flex',
    name: 'Uginanie nóg (maszyna)',
    profile: 'knee_flex',
    view: 'side',
    effortTo1: true,
    pose: (f) =>
      side(
        { hip: [0, 0.55], trunk: -5, ankle: [0.9, 0.55], kneeHint: [1, 1], wristRel: [0.2, -0.45], elbowHint: [0, -1] },
        { hip: [0, 0.55], trunk: -5, ankle: [0.32, 0.14], kneeHint: [1, 1], wristRel: [0.2, -0.45], elbowHint: [0, -1] },
      )(f),
    props: () => ({ seat: [-0.25, 0.42, 0.5] }),
  },
}
// ===================== Wersja na jednej nodze =====================
/** Ćwiczenie na jednej nodze (martwy ciąg jednonóż itp.) – rozpoznane z nazwy. */
export function isOneLeg(e: Pick<Exercise, 'name_pl' | 'name_en'> | null | undefined) {
  if (!e) return false
  return /jednej nodze|jednonoz|na jedna noge|single.?leg|one.?leg|1.?leg/.test(norm(`${e.name_pl ?? ''} ${e.name_en ?? ''}`))
}
/** Rodziny, w których wersja jednonóż ma wolną nogę wyprostowaną w tył (przedłużenie tułowia). */
const ONE_LEG_FAMILIES: FamilyKey[] = ['hinge']
export const supportsOneLeg = (fam: FamilyKey) => ONE_LEG_FAMILIES.includes(fam)

/** Dorysowanie wolnej nogi: w linii z tułowiem (lekko za biodrem, gdy stoi prosto), stopa nad podłogą. */
function withFreeLeg(f: Fig): Fig {
  const t = sub(f.hip, f.shoulder)
  const n = lenP(t) || 1
  const [x, y] = [t[0] / n, t[1] / n] // od barku przez biodro – przedłużenie tułowia
  const a = (10 * Math.PI) / 180 // obrót o 10° w tył, żeby noga nie zlewała się z nogą podporową
  const u: P = [x * Math.cos(a) + y * Math.sin(a), y * Math.cos(a) - x * Math.sin(a)]
  const ankle2 = add(f.hip, mul(u, L.thigh + L.shin - 0.02))
  ankle2[1] = Math.max(ankle2[1], 0.16) // stopa w powietrzu
  const [knee2, a2] = limb(f.hip, ankle2, L.thigh, L.shin, [0, -1])
  const toeDir: P = [-u[1], u[0]] // stopa prostopadle do nogi (stojąc: palce do przodu, w tyle: palce w dół)
  return { ...f, knee2, ankle2: a2, heel2: add(a2, mul(toeDir, -0.05)), toe2: add(a2, mul(toeDir, 0.15)) }
}
/** Sylwetka do rysowania – z wolną nogą, gdy ćwiczenie jest na jednej nodze. */
export function poseFor(fam: FamilyKey, phase: number, v: Variant, oneLeg = false): Fig {
  const f = FAMILIES[fam].pose(phase, v)
  return oneLeg && supportsOneLeg(fam) ? withFreeLeg(f) : f
}

export const FAMILY_KEYS = Object.keys(FAMILIES) as FamilyKey[]
/** Rodzina dla zapisanej analizy (klucz profilu: deadlift → zawias, press → wyciskanie nad głowę…). */
export const familyForProfile = (k: ExerciseKey): FamilyKey => FAMILY_KEYS.find((f) => FAMILIES[f].profile === k) ?? 'squat'
export const isFamily = (k: string | null | undefined): k is FamilyKey => !!k && k in FAMILIES

// ===================== Przypisanie ćwiczenia do rodziny =====================
type Rule = [RegExp, FamilyKey | null]
// Kolejność ma znaczenie: bardziej szczegółowe przed ogólnymi. Nazwy znormalizowane (bez polskich znaków).
const RULES: Rule[] = [
  [/stretch|smr|foam|roll(er|ing)|rozciag|rolowan|mobiliz|yoga|pose\b/, null],
  [/treadmill|running|jogging|bike|bicycl|elliptical|stair|rowing, stationary|ski machine|jumping jack|rope jump|skakank|pajacyk|sprint|carry|farmer|walk\b|spacer|plank|deska|hold\b|wall sit|krzeselko|isometric|izometr/, null],
  [/wrist|forearm|finger|nadgarst|przedrami|shrug|szrugs|neck|szyj/, null],
  [/calf|donkey|wspiec|lydk/, 'calf'],
  [/leg extension|prostowanie nog/, 'knee_ext'],
  [/leg curl|hamstring curl|nordic|uginanie nog|glute.?ham/, 'knee_flex'],
  [/hip thrust|glute bridge|butt lift|bridge|most(ek)? biodr|unoszenie bioder|wypychanie bioder/, 'hip_thrust'],
  [/deadlift|\brdl\b|good morning|stiff.?leg|pull.?through|swing|hyperextension|back extension|martwy|dzien dobry|wyprost(y)? tulowia|wymach/, 'hinge'],
  [/lunge|split squat|step.?up|bulgarian|pistol|wykrok|wejsci|bulgar|jednonoz.*przysiad|przysiad.*jednonoz/, 'lunge'],
  [/squat|leg press|hack|przysiad|suwnic.*nog|wypychanie.*suwnic|suwnica|thruster/, 'squat'],
  [/crunch|sit.?up|situp|v-up|jackknife|brzuszk|spiec|scyzoryk/, 'crunch'],
  [/leg raise|knee raise|knee tuck|toes to bar|unoszenie nog|unoszenie kolan|podciaganie kolan/, 'leg_raise'],
  [/push.?up|press.?up|pompk(?!i na porecz)/, 'pushup'],
  [/landmine.*press|wyciskanie landmine|landmine/, 'landmine_press'],
  [/military|shoulder press|overhead|arnold|push press|behind the neck|seated dumbbell press|nad glowe|zolniersk|za glowe|landmine press/, 'ohp'],
  [/lateral raise|side lateral|laterals|raise.*side|bokiem|odwodzenie ramion/, 'lateral_raise'],
  [/front raise|front.*raise|przodem/, 'front_raise'],
  [/rear delt|reverse fly|reverse flye|face pull|odwrotne rozpietk|tylne aktony|tyl bark/, 'row'],
  [/fly|flye|crossover|butterfly|pec deck|rozpietk|krzyzowanie/, 'fly'],
  [/upright row|wzdluz tulowia/, null],
  [/inverted row|australian|australijsk/, 'row'],
  [/pull.?up|chin.?up|chins|muscle.?up|podciaganie (nachwytem|podchwytem|neutral|szerok|wask|na drazku)|^podciaganie$/, 'pullup'],
  [/pulldown|pull down|sciaganie/, 'pulldown'],
  [/\brow\b|rows|rowing|wioslow/, 'row'],
  [/tricep|pushdown|push.?down|skull|french|kickback|dip|prostowanie ramion|prostowanie ramienia|francusk|porecz/, 'triceps'],
  [/curl|uginanie ramion|uginanie ramienia|uginanie hantl|mlotk|biceps|modlitewnik/, 'curl'],
  [/bench press|chest press|floor press|incline.*press|decline.*press|dumbbell press|wyciskanie.*(lawce|lezac|klatk|maszyn|hantli)|wyciskanie sztangi/, 'bench'],
]

/** Rodzina z nazwy i mięśni (automatycznie). null = nietypowe ćwiczenie bez wzorca. */
export function autoFamily(e: Pick<Exercise, 'name_pl' | 'name_en' | 'primary_muscles' | 'muscle_groups' | 'force' | 'mechanic'>): FamilyKey | null {
  const n = `${norm(e.name_en)} | ${norm(e.name_pl)}`
  for (const [re, fam] of RULES) if (re.test(n)) return fam
  // Mobilność, kondycja, skoki, „inne” – bez wzorca z samego mięśnia (rozciąganie barków to nie wyciskanie).
  if (['mobility', 'cardio', 'plyo', 'other', 'carry', 'rotation'].includes((e as { movement_pattern?: string | null }).movement_pattern ?? '')) return null
  const m =e.primary_muscles?.[0] ?? e.muscle_groups?.[0]
  const push = e.force === 'push'
  const pull = e.force === 'pull'
  if (m === 'quadriceps') return 'squat'
  if (m === 'hamstrings' || (m === 'glutes' && pull)) return 'hinge'
  if (m === 'glutes') return 'hip_thrust'
  if (m === 'chest') return push ? 'bench' : 'fly'
  // Barki: wielostawowe = wyciskanie, izolowane = unoszenie
  if (m === 'shoulders') return e.mechanic === 'isolation' && !push ? 'lateral_raise' : 'ohp'
  if (m === 'lats') return 'pulldown'
  if (m === 'middle back') return 'row'
  if (m === 'biceps') return 'curl'
  if (m === 'triceps') return 'triceps'
  if (m === 'calves') return 'calf'
  if (m === 'abdominals') return 'crunch'
  return null
}

/** Rodzina ćwiczenia: ręczne ustawienie trenerki ma pierwszeństwo ('none' = bez wzorca). */
export function familyOf(e: Pick<Exercise, 'name_pl' | 'name_en' | 'primary_muscles' | 'muscle_groups' | 'force' | 'mechanic' | 'movement_family'>): FamilyKey | null {
  if (e.movement_family === 'none') return null
  if (isFamily(e.movement_family)) return e.movement_family
  return autoFamily(e)
}

// ===================== Podpis ruchu (kąty stawów) =====================
const DEG = 180 / Math.PI
function ang(a: P, b: P, c: P) {
  const u = sub(a, b)
  const v = sub(c, b)
  const d = lenP(u) * lenP(v)
  return d ? Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / d))) * DEG : NaN
}
export type JointKey = 'knee' | 'hip' | 'elbow' | 'shoulder' | 'trunk'
export const JOINT_LABEL: Record<JointKey, string> = { knee: 'kolano', hip: 'biodro', elbow: 'łokieć', shoulder: 'bark', trunk: 'tułów (pochylenie)' }
export const JOINTS: JointKey[] = ['knee', 'hip', 'elbow', 'shoulder', 'trunk']

export function figAngles(f: Fig): Record<JointKey, number> & { wristUp: number; spread: number; heel: number; hipAsym: number } {
  const up = sub(f.shoulder, f.hip)
  return {
    knee: ang(f.hip, f.knee, f.ankle),
    hip: ang(f.shoulder, f.hip, f.knee),
    elbow: ang(f.shoulder, f.elbow, f.wrist),
    shoulder: ang(f.hip, f.shoulder, f.elbow),
    trunk: Math.acos(Math.max(-1, Math.min(1, up[1] / (lenP(up) || 1)))) * DEG,
    wristUp: f.wrist[1] - f.shoulder[1],
    spread: f.view === 'front' && f.wrist2 ? (Math.abs(f.wrist[0] - f.wrist2[0]) / 0.38) * 100 : NaN,
    heel: ((f.ankle[1] - 0.08) / 0.2) * 100,
    hipAsym: f.knee2 && f.view === 'side' ? Math.abs(ang(f.shoulder, f.hip, f.knee) - ang(f.shoulder, f.hip, f.knee2)) : 0,
  }
}

export interface Signature {
  rom: Record<JointKey, number>
  at0: Record<JointKey, number> // pozycja startowa
  at1: Record<JointKey, number> // punkt zwrotny
  trunkMean: number
  kneeMean: number // postawa: ~180 stojąc / w zwisie, ~90 siedząc
  hipMean: number
  wristUp: number
  wristUpMin: number // dłonie najniżej względem barków (w punkcie zwrotnym albo starcie)
  spreadRom: number
  heelRom: number
  hipAsym: number
}
const sigCache = new Map<string, Signature>()
export function signatureOf(fam: FamilyKey, v: Variant = 'body'): Signature {
  const key = `${fam}:${v}`
  const hit = sigCache.get(key)
  if (hit) return hit
  const samples = Array.from({ length: 11 }, (_, i) => figAngles(FAMILIES[fam].pose(i / 10, v)))
  const col = (k: keyof (typeof samples)[0]) => samples.map((s) => s[k])
  const rom = Object.fromEntries(JOINTS.map((j) => [j, Math.max(...col(j)) - Math.min(...col(j))])) as Record<JointKey, number>
  const spread = col('spread')
  const sig: Signature = {
    rom,
    at0: Object.fromEntries(JOINTS.map((j) => [j, samples[0][j]])) as Record<JointKey, number>,
    at1: Object.fromEntries(JOINTS.map((j) => [j, samples[10][j]])) as Record<JointKey, number>,
    trunkMean: mean(col('trunk')),
    kneeMean: mean(col('knee')),
    hipMean: mean(col('hip')),
    wristUp: mean(col('wristUp')),
    wristUpMin: Math.min(...col('wristUp')),
    spreadRom: spread.every(Number.isFinite) ? Math.max(...spread) - Math.min(...spread) : 0,
    heelRom: Math.max(...col('heel')) - Math.min(...col('heel')),
    hipAsym: Math.max(...col('hipAsym')),
  }
  const fix = FAMILIES[fam].sigFix
  if (fix?.rom) Object.assign(sig.rom, fix.rom)
  if (fix?.spreadRom != null) sig.spreadRom = fix.spreadRom
  sigCache.set(key, sig)
  return sig
}

// ===================== Pomiar z nagrania =====================
const pair = (a: number[], b: number[]) => a.map((v, i) => (Number.isFinite(v) && Number.isFinite(b[i]) ? (v + b[i]) / 2 : Number.isFinite(v) ? v : b[i]))
const romOf = (a: number[]) => percentile(a, 0.95) - percentile(a, 0.05)

export type Measured = Omit<Signature, 'at0' | 'at1'>
export function jointSeries(s: Series): Record<JointKey, number[]> {
  return { knee: pair(s.kneeL, s.kneeR), hip: pair(s.hipL, s.hipR), elbow: pair(s.elbowL, s.elbowR), shoulder: pair(s.shoulderL, s.shoulderR), trunk: s.trunk }
}
/** Cechy ruchu z całego nagrania (albo z fragmentu powtórzeń). */
export function measure(s: Series, from = 0, to = s.trunk.length - 1): Measured {
  const js = jointSeries(s)
  const cut = (a: number[]) => a.slice(from, to + 1)
  return {
    rom: Object.fromEntries(JOINTS.map((j) => [j, romOf(cut(js[j]))])) as Record<JointKey, number>,
    trunkMean: percentile(cut(s.trunk), 0.5),
    kneeMean: percentile(cut(js.knee), 0.5),
    hipMean: percentile(cut(js.hip), 0.5),
    wristUp: -percentile(cut(s.hShoulder), 0.5),
    wristUpMin: -percentile(cut(s.hShoulder), 0.95),
    spreadRom: romOf(cut(s.spread)),
    heelRom: romOf(cut(s.heel)),
    hipAsym: percentile(cut(s.hipL).map((v, i) => Math.abs(v - s.hipR[from + i])), 0.75),
  }
}

// ===================== Rozpoznanie rodziny =====================
const z = (a: number, b: number, scale: number) => (Number.isFinite(a) && Number.isFinite(b) ? ((a - b) / scale) ** 2 : 0)
export function distance(m: Measured, p: Signature) {
  let d = 0
  // Najważniejsze: które stawy pracują i jak mocno.
  for (const j of ['knee', 'hip', 'elbow', 'shoulder'] as const) d += z(m.rom[j], p.rom[j] * (CAMERA_SCALE[j] ?? 1), 30)
  d += z(m.rom.trunk, p.rom.trunk, 25)
  // Pozycja ciała: stojąc / leżąc / w zwisie, dłonie nad czy pod barkami.
  d += z(m.trunkMean, p.trunkMean, 25)
  d += 0.6 * z(m.kneeMean, p.kneeMean, 35)
  d += 0.6 * z(m.hipMean, p.hipMean, 35)
  d += 0.8 * z(m.wristUp, p.wristUp, 0.35)
  d += 0.6 * z(m.wristUpMin, p.wristUpMin, 0.3)
  d += 0.6 * z(m.spreadRom, p.spreadRom, 60)
  d += 0.6 * z(m.heelRom, p.heelRom, 12)
  d += 0.7 * z(m.hipAsym, p.hipAsym, 25)
  return d
}

export interface Guess {
  family: FamilyKey
  score: number // 0..1 – pewność względem pozostałych
}
/** Ranking rodzin dla nagrania (od najbardziej prawdopodobnej). */
export function detectFamily(s: Series, reps?: Pick<Rep, 'start' | 'end'>[]): Guess[] {
  const from = reps?.length ? reps[0].start : 0
  const to = reps?.length ? reps.at(-1)!.end : s.trunk.length - 1
  const m = measure(s, from, to)
  const ds = FAMILY_KEYS.map((f) => ({ family: f, d: Math.min(...(['body', 'barbell', 'cable'] as Variant[]).map((v) => distance(m, signatureOf(f, v)))) }))
  const w = ds.map((x) => Math.exp(-x.d / 2))
  const sum = w.reduce((a, b) => a + b, 0) || 1
  return ds.map((x, i) => ({ family: x.family, score: w[i] / sum })).sort((a, b) => b.score - a.score)
}

// ===================== Porównanie powtórzeń ze wzorcem =====================
export interface JointCompare {
  joint: JointKey
  client: number // zakres ruchu klienta [°] (średnio na powtórzenie)
  pattern: number // zakres we wzorcu [°]
  verdict: 'ok' | 'short' | 'long' | 'extra'
  text: string
}
export interface PatternMatch {
  score: number // 0..100 zgodności zakresów ruchu
  joints: JointCompare[]
}
const r0 = (v: number) => `${Math.round(v)}`
/**
 * Kalibracja do pomiaru z kamery: MediaPipe szacuje środek stawu biodrowego niedokładnie i zaniża zakres w biodrze
 * (na nagraniach przysiadów ok. 60–65° przy kolanie 85–90° – ok. 0,7 zakresu z rysunku). Stosowane do wzorca przy porównaniu.
 */
const CAMERA_SCALE: Partial<Record<JointKey, number>> = { hip: 0.7 }
const MAIN_JOINT = 45 // staw „pracujący” we wzorcu: zakres ≥ 45°

export function comparePattern(s: Series, reps: Pick<Rep, 'start' | 'end'>[], fam: FamilyKey, v: Variant = 'body'): PatternMatch | null {
  if (!reps.length) return null
  const p = signatureOf(fam, v)
  const js = jointSeries(s)
  const per = (j: JointKey) => mean(reps.map((r) => romOf(js[j].slice(r.start, r.end + 1))))
  const joints: JointCompare[] = []
  let penalty = 0
  let n = 0
  for (const j of JOINTS) {
    const c = per(j)
    const pr = p.rom[j] * (CAMERA_SCALE[j] ?? 1)
    if (!Number.isFinite(c)) continue
    if (p.rom[j] >= MAIN_JOINT) {
      // staw, który ma pracować
      const ratio = c / pr
      n++
      penalty += Math.min(1, Math.abs(1 - ratio))
      const verdict = ratio < 0.7 ? 'short' : ratio > 1.4 ? 'long' : 'ok'
      joints.push({
        joint: j,
        client: c,
        pattern: pr,
        verdict,
        text:
          verdict === 'short'
            ? `${cap(JOINT_LABEL[j])}: zakres ${r0(c)}° – we wzorcu ok. ${r0(pr)}°. Ruch za krótki.`
            : verdict === 'long'
              ? `${cap(JOINT_LABEL[j])}: zakres ${r0(c)}° – we wzorcu ok. ${r0(pr)}°. Ruch większy niż zwykle (inna odmiana albo luźniejsza technika).`
              : `${cap(JOINT_LABEL[j])}: zakres ${r0(c)}° – zgodnie ze wzorcem (ok. ${r0(pr)}°).`,
      })
    } else if (c > pr + 35) {
      // staw, który powinien być stabilny, a się rusza (bujanie, „oszukiwanie” ciężaru)
      penalty += Math.min(1, (c - pr - 35) / 40)
      n++
      joints.push({
        joint: j,
        client: c,
        pattern: pr,
        verdict: 'extra',
        text: `${cap(JOINT_LABEL[j])}: rusza się o ${r0(c)}°, a we wzorcu jest prawie nieruchome. Możliwe bujanie albo pomaganie sobie tym stawem.`,
      })
    }
  }
  if (!n) return null
  return { score: Math.round(Math.max(0, 100 * (1 - penalty / n))), joints }
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Czasy faz animacji [s]: do punktu zwrotnego, pauza, powrót, pauza na górze. */
export function animTempo(fam: FamilyKey): [number, number, number, number] {
  return FAMILIES[fam].effortTo1 ? [1.0, 0.5, 1.8, 0.4] : [1.8, 0.4, 1.0, 0.5]
}
