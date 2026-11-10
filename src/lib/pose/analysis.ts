// Analiza ruchu ze szkieletu (czysty TS, bez przeglądarki – testowana na danych syntetycznych).
//  1. serie kątów na klatkę (świat 3D z MediaPipe) + pomiary z obrazu (rozstaw kolan, biodra w bok)
//  2. wygładzenie, wykrycie ujęcia (przód / bok)
//  3. powtórzenia = doliny kąta sygnałowego (kolano / biodro / łokieć) z histerezą
//  4. pomiary na powtórzenie, flagi wg progów, uśredniona sylwetka do porównań
import { J, type Pose, type Track } from './skeleton'
import { PROFILES, thresholdFor, type ExerciseKey, type Profile, type Thresholds, type View } from './profiles'

// ===================== Geometria =====================
const DEG = 180 / Math.PI
type V3 = [number, number, number]
const w3 = (p: Pose, i: number): V3 => [p[i].wx, p[i].wy, p[i].wz]
const mid3 = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])

/** Kąt w punkcie b (stopnie). */
export function angle(a: V3, b: V3, c: V3) {
  const u = sub(a, b)
  const v = sub(c, b)
  const d = len(u) * len(v)
  return d ? Math.acos(Math.max(-1, Math.min(1, dot(u, v) / d))) * DEG : NaN
}

const vis = (p: Pose, ...ix: number[]) => ix.reduce((s, i) => s + p[i].v, 0) / ix.length
const VIS_MIN = 0.5

// ===================== Serie na klatkę =====================
export interface Series {
  kneeL: number[]
  kneeR: number[]
  hipL: number[]
  hipR: number[]
  elbowL: number[]
  elbowR: number[]
  trunk: number[] // pochylenie tułowia od pionu
  valgus: number[] // rozstaw kolan / kostek [%] (obraz)
  shift: number[] // środek bioder vs środek kostek [% szer. bioder] (obraz)
  bodyLine: number[] // 180 − kąt bark–biodro–kostka (bliższa strona)
  wristDrift: number[] // dłonie vs środek stopy [% długości tułowia] (obraz, wartość bezwzględna)
  leftVis: number[]
  rightVis: number[]
}

export function computeSeries(tr: Track): Series {
  const n = tr.poses.length
  const s: Series = {
    kneeL: [], kneeR: [], hipL: [], hipR: [], elbowL: [], elbowR: [], trunk: [], valgus: [], shift: [], bodyLine: [], wristDrift: [], leftVis: [], rightVis: [],
  }
  const W = tr.width || 1
  const H = tr.height || 1
  for (let i = 0; i < n; i++) {
    const p = tr.poses[i]
    if (!p) {
      for (const k of Object.keys(s) as (keyof Series)[]) s[k].push(NaN)
      continue
    }
    const side = (sh: number, el: number, wr: number, hip: number, kn: number, an: number) => ({
      knee: angle(w3(p, hip), w3(p, kn), w3(p, an)),
      hip: angle(w3(p, sh), w3(p, hip), w3(p, kn)),
      elbow: angle(w3(p, sh), w3(p, el), w3(p, wr)),
    })
    const L = side(J.lSh, J.lEl, J.lWr, J.lHip, J.lKnee, J.lAnk)
    const R = side(J.rSh, J.rEl, J.rWr, J.rHip, J.rKnee, J.rAnk)
    s.kneeL.push(L.knee)
    s.kneeR.push(R.knee)
    s.hipL.push(L.hip)
    s.hipR.push(R.hip)
    s.elbowL.push(L.elbow)
    s.elbowR.push(R.elbow)
    s.leftVis.push(vis(p, J.lSh, J.lHip, J.lKnee, J.lAnk, J.lEl, J.lWr))
    s.rightVis.push(vis(p, J.rSh, J.rHip, J.rKnee, J.rAnk, J.rEl, J.rWr))

    // Pochylenie: wektor biodra→barki względem pionu (w świecie MediaPipe oś y skierowana w dół).
    const torso = sub(mid3(w3(p, J.lSh), w3(p, J.rSh)), mid3(w3(p, J.lHip), w3(p, J.rHip)))
    s.trunk.push(len(torso) ? Math.acos(Math.max(-1, Math.min(1, -torso[1] / len(torso)))) * DEG : NaN)

    // Z obrazu (w pikselach, żeby proporcje kadru nie zniekształcały).
    const px = (j: number) => p[j].x * W
    const py = (j: number) => p[j].y * H
    const ankleDist = Math.abs(px(J.lAnk) - px(J.rAnk))
    s.valgus.push(ankleDist > 1 ? (Math.abs(px(J.lKnee) - px(J.rKnee)) / ankleDist) * 100 : NaN)
    const hipW = Math.abs(px(J.lHip) - px(J.rHip))
    s.shift.push(hipW > 1 ? (Math.abs((px(J.lHip) + px(J.rHip)) / 2 - (px(J.lAnk) + px(J.rAnk)) / 2) / hipW) * 100 : NaN)

    const near = p[J.lHip].v + p[J.lSh].v >= p[J.rHip].v + p[J.rSh].v ? [J.lSh, J.lHip, J.lAnk] : [J.rSh, J.rHip, J.rAnk]
    s.bodyLine.push(180 - angle(w3(p, near[0]), w3(p, near[1]), w3(p, near[2])))

    const torsoPx = Math.hypot((px(J.lSh) + px(J.rSh)) / 2 - (px(J.lHip) + px(J.rHip)) / 2, (py(J.lSh) + py(J.rSh)) / 2 - (py(J.lHip) + py(J.rHip)) / 2)
    const footX = (px(J.lAnk) + px(J.rAnk) + px(J.lFoot) + px(J.rFoot)) / 4
    s.wristDrift.push(torsoPx > 1 ? (Math.abs((px(J.lWr) + px(J.rWr)) / 2 - footX) / torsoPx) * 100 : NaN)
  }
  return s
}

// ===================== Wygładzanie =====================
/** Uzupełnia krótkie luki (do maxGap klatek) interpolacją liniową. */
export function fillGaps(a: number[], maxGap: number): number[] {
  const out = a.slice()
  let i = 0
  while (i < out.length) {
    if (Number.isFinite(out[i])) {
      i++
      continue
    }
    let j = i
    while (j < out.length && !Number.isFinite(out[j])) j++
    const gap = j - i
    if (i > 0 && j < out.length && gap <= maxGap) {
      for (let k = i; k < j; k++) out[k] = out[i - 1] + ((out[j] - out[i - 1]) * (k - i + 1)) / (gap + 1)
    }
    i = j
  }
  return out
}

/** Średnia ruchoma (środkowana), pomija NaN. */
export function smooth(a: number[], win: number): number[] {
  const h = Math.max(0, Math.floor(win / 2))
  return a.map((_, i) => {
    let s = 0
    let c = 0
    for (let k = Math.max(0, i - h); k <= Math.min(a.length - 1, i + h); k++) {
      if (Number.isFinite(a[k])) {
        s += a[k]
        c++
      }
    }
    return c ? s / c : NaN
  })
}

const finite = (a: number[]) => a.filter(Number.isFinite)
export function percentile(a: number[], q: number) {
  const s = finite(a).sort((x, y) => x - y)
  if (!s.length) return NaN
  const idx = (s.length - 1) * q
  const lo = Math.floor(idx)
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (idx - lo)
}
export const median = (a: number[]) => percentile(a, 0.5)
export const mean = (a: number[]) => {
  const f = finite(a)
  return f.length ? f.reduce((s, x) => s + x, 0) / f.length : NaN
}
export const sd = (a: number[]) => {
  const f = finite(a)
  if (f.length < 2) return NaN
  const m = mean(f)
  return Math.sqrt(f.reduce((s, x) => s + (x - m) ** 2, 0) / (f.length - 1))
}

// ===================== Ujęcie kamery =====================
/** Przód: szerokość barków w kadrze porównywalna z długością tułowia; bok: barki prawie się pokrywają. */
/** Ujęcie całego nagrania albo fragmentu [from, to] (np. jednego powtórzenia – klient może się obrócić). */
export function detectView(tr: Track, from = 0, to = tr.poses.length - 1): View {
  const ratios: number[] = []
  for (const p of tr.poses.slice(from, to + 1)) {
    if (!p || vis(p, J.lSh, J.rSh, J.lHip, J.rHip) < VIS_MIN) continue
    const W = tr.width || 1
    const H = tr.height || 1
    const shW = Math.abs(p[J.lSh].x - p[J.rSh].x) * W
    const torso = Math.hypot(((p[J.lSh].x + p[J.rSh].x) / 2 - (p[J.lHip].x + p[J.rHip].x) / 2) * W, ((p[J.lSh].y + p[J.rSh].y) / 2 - (p[J.lHip].y + p[J.rHip].y) / 2) * H)
    if (torso > 1) ratios.push(shW / torso)
  }
  if (ratios.length < 5) return 'unknown'
  const r = median(ratios)
  return r > 0.55 ? 'front' : r < 0.28 ? 'side' : 'oblique'
}

// ===================== Sygnał i powtórzenia =====================
export interface Rep {
  start: number // indeks klatki: ruszenie z góry
  bottom: number // najniższy punkt
  end: number // powrót na górę
  view?: View // ujęcie tego powtórzenia
  metrics: Record<string, number | null>
}

/** Kąt sygnałowy: średnia stron widocznych (z boku – bliższa kamerze). */
export function signalOf(profile: Profile, s: Series, view: View): number[] {
  const [l, r] = profile.signal === 'knee' ? [s.kneeL, s.kneeR] : profile.signal === 'hip' ? [s.hipL, s.hipR] : [s.elbowL, s.elbowR]
  return l.map((lv, i) => {
    const lOk = s.leftVis[i] >= VIS_MIN
    const rOk = s.rightVis[i] >= VIS_MIN
    if (view === 'side' || view === 'oblique') {
      // bliższa strona: wyraźnie lepiej widoczna
      if (s.leftVis[i] > s.rightVis[i] + 0.1) return lv
      if (s.rightVis[i] > s.leftVis[i] + 0.1) return r[i]
    }
    if (lOk && rOk) return (lv + r[i]) / 2
    if (lOk) return lv
    if (rOk) return r[i]
    return NaN
  })
}

/**
 * Doliny sygnału z histerezą: wejście w ruch poniżej top − 25% zakresu, powtórzenie liczy się,
 * gdy zejdzie poniżej top − 55% zakresu i wróci powyżej progu wejścia.
 */
export function segmentReps(sig: number[], t: number[], minRange: number): Omit<Rep, 'metrics'>[] {
  const top = percentile(sig, 0.9)
  const bot = percentile(sig, 0.03)
  const R = top - bot
  if (!Number.isFinite(R) || R < minRange) return []
  const enter = top - 0.25 * R
  const deep = top - 0.55 * R
  const near = Math.max(2, 0.03 * R)
  const reps: Omit<Rep, 'metrics'>[] = []

  let i = 0
  let prevEnd = 0
  const n = sig.length
  while (i < n) {
    // 1) zejście poniżej progu wejścia
    while (i < n && !(sig[i] < enter)) i++
    if (i >= n) break
    const cross = i
    // 2) najniższy punkt zanim sygnał wróci powyżej progu wejścia
    let bottom = i
    while (i < n && !(sig[i] > enter)) {
      if (sig[i] < sig[bottom]) bottom = i
      i++
    }
    const returned = i < n
    if (!(sig[bottom] < deep)) continue // za płytko – drgnięcie, nie powtórzenie
    // 3) góra przed powtórzeniem: maksimum w oknie ~1,5 s przed wejściem (nie dalej niż poprzedni koniec) –
    //    pojedyncza zawyżona klatka sprzed kilku sekund nie może przesunąć startu; ruszenie = ostatnia klatka blisko tej góry
    let topBefore = Math.max(prevEnd, firstAfter(t, t[cross] - TOP_WINDOW))
    for (let k = topBefore; k <= cross; k++) if (sig[k] > sig[topBefore]) topBefore = k
    let start = cross
    while (start > topBefore && !(sig[start] >= sig[topBefore] - near)) start--
    // Nagranie zaczęte w dole (np. martwy ciąg z podłogi) – start w pierwszej klatce.
    if (cross === 0 || sig[topBefore] < enter) start = Math.min(start, bottom)
    if (!returned) break // urwane w dole – nie liczymy
    // 4) koniec: maksimum po powrocie, do kolejnego zejścia; powrót = pierwsza klatka blisko tej góry
    let nextCross = i
    while (nextCross < n && !(sig[nextCross] < enter)) nextCross++
    // Góra po powtórzeniu: maksimum w oknie ~1,5 s po powrocie (stanie po serii bywa wyższe o kilka stopni).
    const winEnd = Math.min(nextCross, firstAfter(t, t[i] + TOP_WINDOW))
    let topAfter = i
    for (let k = i; k < winEnd; k++) if (sig[k] > sig[topAfter]) topAfter = k
    let end = bottom
    while (end < topAfter && !(sig[end] >= sig[topAfter] - near)) end++
    reps.push({ start, bottom, end })
    prevEnd = end
  }
  return reps
}

const TOP_WINDOW = 1.5 // s
/** Pierwszy indeks klatki z czasem ≥ tt. */
function firstAfter(t: number[], tt: number) {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid] < tt) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ===================== Pomiary powtórzenia =====================
const at = (a: number[], i: number) => (Number.isFinite(a[i]) ? a[i] : NaN)
const minIn = (a: number[], i0: number, i1: number) => Math.min(...finite(a.slice(i0, i1 + 1)))
const maxIn = (a: number[], i0: number, i1: number) => Math.max(...finite(a.slice(i0, i1 + 1)))
/** Wartość z okolicy klatki (±k), żeby pojedyncza zła klatka nie psuła pomiaru. */
const around = (a: number[], i: number, k = 2) => median(a.slice(Math.max(0, i - k), i + k + 1))

function sidePick(view: View, s: Series, i: number, l: number[], r: number[]) {
  if (view === 'side' || view === 'oblique') return s.leftVis[i] >= s.rightVis[i] ? l : r
  return null
}

export function repMetrics(profile: Profile, s: Series, sig: number[], t: number[], rep: Omit<Rep, 'metrics'>, view: View): Record<string, number | null> {
  const { start, bottom, end } = rep
  const out: Record<string, number | null> = {}
  const valid = (key: string) => profile.metrics.find((m) => m.key === key)!.views.includes(view)
  const put = (key: string, v: number) => (out[key] = valid(key) && Number.isFinite(v) ? Math.round(v * 100) / 100 : null)

  // Tempo
  const nearBottom = sig[bottom] + Math.max(1.5, 0.03 * (maxIn(sig, start, end) - sig[bottom]))
  let p0 = bottom
  let p1 = bottom
  while (p0 > start && sig[p0 - 1] <= nearBottom) p0--
  while (p1 < end && sig[p1 + 1] <= nearBottom) p1++
  put('ecc', t[p0] - t[start])
  put('pause', t[p1] - t[p0])
  put('con', t[end] - t[p1])

  const pick = (l: number[], r: number[]) => sidePick(view, s, bottom, l, r)
  if (profile.key === 'squat') {
    const knee = pick(s.kneeL, s.kneeR)
    put('depth_knee', knee ? minIn(knee, start, end) : sig[bottom])
    const hip = pick(s.hipL, s.hipR) ?? s.hipL.map((v, i) => (v + s.hipR[i]) / 2)
    put('depth_hip', minIn(hip, start, end))
    put('trunk', around(s.trunk, bottom))
    put('valgus', around(s.valgus, bottom))
    put('asym', Math.abs(around(s.kneeL, bottom) - around(s.kneeR, bottom)))
    put('shift', around(s.shift, bottom))
  } else if (profile.key === 'deadlift') {
    put('hip_bottom', sig[bottom])
    const knee = pick(s.kneeL, s.kneeR) ?? s.kneeL
    put('knee_bottom', around(knee, bottom))
    put('trunk', around(s.trunk, bottom))
    put('lockout', maxIn(sig, bottom, end))
    put('bar_drift', maxIn(s.wristDrift, start, end))
  } else {
    put('elbow_bottom', sig[bottom])
    put('body_line', maxIn(s.bodyLine.map(Math.abs), start, end))
  }
  void at
  return out
}

// ===================== Całość =====================
export interface AnalysisResult {
  view: View
  reps: Rep[]
  series: Series
  signal: number[]
}

export function analyze(tr: Track, ex: ExerciseKey, forceView?: View): AnalysisResult {
  const profile = PROFILES[ex]
  const view = forceView ?? detectView(tr)
  const raw = computeSeries(tr)
  const maxGap = Math.round(tr.fps * 0.5)
  const win = Math.max(3, Math.round(tr.fps * 0.12) | 1)
  const series = Object.fromEntries(Object.entries(raw).map(([k, a]) => [k, smooth(fillGaps(a, maxGap), win)])) as unknown as Series
  const signal = signalOf(profile, series, view)
  const segs = segmentReps(signal, tr.t, profile.minRange)
  const reps = segs.map((r) => {
    const rv = forceView ?? detectView(tr, r.start, r.end)
    const v = rv === 'unknown' ? view : rv
    return { ...r, view: v, metrics: repMetrics(profile, series, signal, tr.t, r, v) }
  })
  // Wszystkie powtórzenia z jednego ujęcia → to jest ujęcie nagrania.
  const repViews = new Set(reps.map((r) => r.view))
  return { view: repViews.size === 1 && reps.length ? reps[0].view! : view, reps, series, signal }
}

/** Średnie pomiarów ze wszystkich powtórzeń. */
export function summarize(reps: Pick<Rep, 'metrics'>[]): Record<string, number | null> {
  const keys = new Set(reps.flatMap((r) => Object.keys(r.metrics)))
  const out: Record<string, number | null> = {}
  for (const k of keys) {
    const m = mean(reps.map((r) => r.metrics[k] ?? NaN))
    out[k] = Number.isFinite(m) ? m : null
  }
  return out
}

// ===================== Flagi =====================
export interface Flag {
  key: string
  label: string
  reps: number[] // numery powtórzeń od 1
  text: string // "możliwe koślawienie kolan (powt. 4–6)"
}

export function ranges(nums: number[]) {
  const out: string[] = []
  for (let i = 0; i < nums.length; i++) {
    let j = i
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++
    out.push(i === j ? `${nums[i]}` : `${nums[i]}–${nums[j]}`)
    i = j
  }
  return out.join(', ')
}

export function flagsFor(ex: ExerciseKey, reps: Pick<Rep, 'metrics'>[], th: Thresholds): Flag[] {
  const profile = PROFILES[ex]
  const out: Flag[] = []
  for (const f of profile.flags) {
    const limit = thresholdFor(th, ex, f)
    const hit = reps.flatMap((r, i) => {
      const v = r.metrics[f.metric]
      return v != null && (f.op === '<' ? v < limit : v > limit) ? [i + 1] : []
    })
    if (hit.length) out.push({ key: f.key, label: f.label, reps: hit, text: `${f.label} (${hit.length === reps.length ? 'wszystkie powtórzenia' : `powt. ${ranges(hit)}`})` })
  }
  return out
}

// ===================== Porównanie ze wzorcem =====================
export interface RefStats {
  mean: number
  sd: number
  n: number
}
/** Statystyki wzorca z powtórzeń wszystkich nagrań-wzorców danego ćwiczenia. */
export function refStats(refReps: Pick<Rep, 'metrics'>[]): Record<string, RefStats> {
  const keys = new Set(refReps.flatMap((r) => Object.keys(r.metrics)))
  const out: Record<string, RefStats> = {}
  for (const k of keys) {
    const vals = refReps.map((r) => r.metrics[k] ?? NaN).filter(Number.isFinite)
    if (vals.length) out[k] = { mean: mean(vals), sd: vals.length > 1 ? sd(vals) : 0, n: vals.length }
  }
  return out
}

/** Odchylenie od wzorca w jednostkach rozrzutu (min. tolerancja ćwiczenia), obcięte do ±3. */
export function zScore(value: number | null | undefined, ref: RefStats | undefined, tol: number): number | null {
  if (value == null || !ref) return null
  const z = (value - ref.mean) / Math.max(ref.sd || 0, tol)
  return Math.max(-3, Math.min(3, z))
}

// ===================== Uśredniona sylwetka (porównanie kształtu ruchu) =====================
export type P2 = [number, number]
export interface AvgRep {
  frames: P2[][] // PHASES × 17 punktów, układ: punkt stały w (0,0), jednostka = długość tułowia, y w dół
  bottomPhase: number // 0..1
  duration: number // średni czas powtórzenia [s]
  phases: { ecc: number; pause: number; con: number }
}
export const PHASES = 41

function pose2(tr: Track, i: number): P2[] | null {
  const p = tr.poses[i]
  return p ? p.map((q) => [q.x * (tr.width || 1), q.y * (tr.height || 1)] as P2) : null
}
function lerpPose(a: P2[], b: P2[], f: number): P2[] {
  return a.map((q, k) => [q[0] + (b[k][0] - q[0]) * f, q[1] + (b[k][1] - q[1]) * f])
}

/** Pozy powtórzenia przeskalowane do PHASES kroków fazy, znormalizowane (punkt stały, tułów = 1, przodem w prawo). */
export function normalizedRep(tr: Track, rep: Omit<Rep, 'metrics'>, profile: Profile, flip = 1): P2[][] | null {
  const t0 = tr.t[rep.start]
  const t1 = tr.t[rep.end]
  if (!(t1 > t0)) return null
  const out: P2[][] = []
  let k = rep.start
  for (let ph = 0; ph < PHASES; ph++) {
    const tt = t0 + ((t1 - t0) * ph) / (PHASES - 1)
    while (k < rep.end && tr.t[k + 1] <= tt) k++
    const a = pose2(tr, k)
    const b = pose2(tr, Math.min(k + 1, rep.end))
    if (!a && !b) return null
    const f = a && b && tr.t[k + 1] > tr.t[k] ? (tt - tr.t[k]) / (tr.t[k + 1] - tr.t[k]) : 0
    out.push(a && b ? lerpPose(a, b, Math.max(0, Math.min(1, f))) : (a ?? b)!)
  }
  // Punkt stały: średnia z całego powtórzenia (stopy / dłonie nie powinny się ruszać).
  const anchorIx = profile.anchor === 'ankles' ? [J.lAnk, J.rAnk] : [J.lWr, J.rWr]
  const ax = mean(out.flatMap((f) => anchorIx.map((i) => f[i][0])))
  const ay = mean(out.flatMap((f) => anchorIx.map((i) => f[i][1])))
  const torso = median(
    out.map((f) => Math.hypot((f[J.lSh][0] + f[J.rSh][0]) / 2 - (f[J.lHip][0] + f[J.rHip][0]) / 2, (f[J.lSh][1] + f[J.rSh][1]) / 2 - (f[J.lHip][1] + f[J.rHip][1]) / 2)),
  )
  if (!(torso > 0)) return null
  return out.map((f) => f.map(([x, y]) => [((x - ax) / torso) * flip, (y - ay) / torso] as P2))
}

/**
 * Kierunek całego nagrania: −1, gdy osoba jest zwrócona w lewo (palce przed piętami / głowa przed biodrami).
 * Wyznaczany raz dla nagrania i tylko gdy wyraźny – z przodu palce celują w kamerę, więc nie odwracamy
 * (inaczej część powtórzeń odbiłaby się lustrzanie i średnia sylwetka zapadłaby się w kreskę).
 */
export function facingFlip(tr: Track, profile: Profile): number {
  const dirs: number[] = []
  const torsos: number[] = []
  for (const p of tr.poses) {
    if (!p) continue
    const x = (i: number) => p[i].x * (tr.width || 1)
    const y = (i: number) => p[i].y * (tr.height || 1)
    dirs.push(profile.facing === 'feet' ? (x(J.lFoot) + x(J.rFoot)) / 2 - (x(J.lHeel) + x(J.rHeel)) / 2 : x(J.nose) - (x(J.lHip) + x(J.rHip)) / 2)
    torsos.push(Math.hypot((x(J.lSh) + x(J.rSh)) / 2 - (x(J.lHip) + x(J.rHip)) / 2, (y(J.lSh) + y(J.rSh)) / 2 - (y(J.lHip) + y(J.rHip)) / 2))
  }
  const d = median(dirs)
  const t = median(torsos)
  if (!Number.isFinite(d) || !(t > 0) || Math.abs(d) / t < 0.12) return 1
  return d < 0 ? -1 : 1
}

export function averageRep(tr: Track, reps: Rep[], profile: Profile): AvgRep | null {
  const flip = facingFlip(tr, profile)
  const norm = reps.map((r) => normalizedRep(tr, r, profile, flip)).filter((x): x is P2[][] => !!x)
  if (!norm.length) return null
  const frames = Array.from({ length: PHASES }, (_, ph) =>
    Array.from({ length: norm[0][0].length }, (_, j) => [mean(norm.map((r) => r[ph][j][0])), mean(norm.map((r) => r[ph][j][1]))] as P2),
  )
  const bottomPhase = mean(reps.map((r) => (tr.t[r.bottom] - tr.t[r.start]) / (tr.t[r.end] - tr.t[r.start] || 1)))
  const m = summarize(reps)
  return {
    frames,
    bottomPhase: Number.isFinite(bottomPhase) ? bottomPhase : 0.5,
    duration: mean(reps.map((r) => tr.t[r.end] - tr.t[r.start])),
    phases: { ecc: m.ecc ?? 0, pause: m.pause ?? 0, con: m.con ?? 0 },
  }
}

/** Punkt toru (biodra / dłonie / barki) w znormalizowanej pozie. */
export function tracePoint(f: P2[], which: Profile['trace']): P2 {
  const [a, b] = which === 'hip' ? [J.lHip, J.rHip] : which === 'wrist' ? [J.lWr, J.rWr] : [J.lSh, J.rSh]
  return [(f[a][0] + f[b][0]) / 2, (f[a][1] + f[b][1]) / 2]
}
