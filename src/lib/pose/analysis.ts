// Analiza ruchu ze szkieletu (czysty TS, bez przeglądarki – testowana na danych syntetycznych).
//  1. serie kątów na klatkę (świat 3D z MediaPipe) + pomiary z obrazu (rozstaw kolan, biodra w bok)
//  2. wygładzenie, wykrycie ujęcia (przód / bok)
//  3. powtórzenia = doliny kąta sygnałowego (kolano / biodro / łokieć) z histerezą
//  4. pomiary na powtórzenie, flagi wg progów, uśredniona sylwetka do porównań
import { J, type Pose, type Track } from './skeleton'
import { PROFILES, thresholdFor, type ExerciseKey, type Profile, type Thresholds, type View } from './profiles'
export type { View }

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
  shoulderL: number[] // kąt biodro–bark–łokieć (unoszenie ramienia)
  shoulderR: number[]
  spread: number[] // odległość dłoni / szerokość barków [%] (3D) – rozpiętki
  trunk: number[] // pochylenie tułowia od pionu
  valgus: number[] // rozstaw kolan / kostek [%] (obraz)
  shift: number[] // środek bioder vs środek kostek [% szer. bioder] (obraz)
  bodyLine: number[] // 180 − kąt bark–biodro–kostka (bliższa strona)
  wristDrift: number[] // dłonie vs środek stopy [% długości tułowia] (obraz, wartość bezwzględna)
  kneeInL: number[] // kolano względem linii biodro–kostka, do środka = plus [% szer. bioder] (obraz)
  kneeInR: number[]
  shiftS: number[] // jak shift, ze znakiem: plus = w lewą stronę ćwiczącego
  hipTilt: number[] // różnica wysokości bioder [% szer. bioder]: plus = lewe biodro niżej
  torsoRatio: number[] // długość tułowia / długość podudzia (bliższa strona, obraz) – skraca się, gdy plecy się zaokrąglają
  hipSag: number[] // biodro względem linii bark–kostka [% jej długości]: plus = biodra opadają (obraz)
  wristDy: number[] // różnica wysokości nadgarstków [% szer. barków]: plus = lewy niżej
  heel: number[] // pięta względem palców [% długości stopy]: rośnie, gdy pięta się odrywa
  hHip: number[] // wysokość bioder nad kostkami [m] (świat MediaPipe – biodra są w początku układu)
  hWrist: number[] // wysokość dłoni (sztangi) nad kostkami [m]
  hShoulder: number[] // wysokość barków nad dłońmi [m] (pompka)
  leftVis: number[]
  rightVis: number[]
  barX: number[] // śledzona sztanga względem środka bliższej stopy [% długości tułowia], plus = do przodu (w prawo w obrazie × kierunek)
  hBar: number[] // wysokość śledzonej sztangi [m] (dowolne zero – liczą się różnice)
}

/**
 * Serie na klatkę. view = 'side': kąty kolana i biodra oraz pochylenie tułowia liczymy z obrazu (2D) –
 * ruch nóg i tułowia odbywa się w płaszczyźnie równoległej do obrazu, a głębia 3D z MediaPipe jest z boku
 * najmniej pewna (na nagraniach różnica do 25° i rozrzut między powtórzeniami ±8°). Łokieć i bark zostają w 3D
 * (łokcie bywają odwiedzione w bok – rzut 2D zaniżałby kąt).
 */
export function computeSeries(tr: Track, view: View = 'unknown'): Series {
  const n = tr.poses.length
  const s: Series = {
    kneeL: [], kneeR: [], hipL: [], hipR: [], elbowL: [], elbowR: [], shoulderL: [], shoulderR: [], spread: [], trunk: [], valgus: [], shift: [], bodyLine: [], wristDrift: [],
    kneeInL: [], kneeInR: [], shiftS: [], hipTilt: [], torsoRatio: [], hipSag: [], wristDy: [], heel: [], hHip: [], hWrist: [], hShoulder: [], leftVis: [], rightVis: [],
    barX: [], hBar: [],
  }
  const W = tr.width || 1
  const H = tr.height || 1
  const flat = view === 'side'
  // Skala obrazu: metry na piksel z długości tułowia (świat 3D MediaPipe / obraz) – do prędkości śledzonej sztangi.
  const mPerPx = tr.bar
    ? median(
        tr.poses.map((p) => {
          if (!p) return NaN
          const t3 = len(sub(mid3(w3(p, J.lSh), w3(p, J.rSh)), mid3(w3(p, J.lHip), w3(p, J.rHip))))
          const t2 = Math.hypot(((p[J.lSh].x + p[J.rSh].x - p[J.lHip].x - p[J.rHip].x) / 2) * W, ((p[J.lSh].y + p[J.rSh].y - p[J.lHip].y - p[J.rHip].y) / 2) * H)
          return t2 > 1 ? t3 / t2 : NaN
        }),
      )
    : NaN
  for (let i = 0; i < n; i++) {
    const p = tr.poses[i]
    if (!p) {
      for (const k of Object.keys(s) as (keyof Series)[]) s[k].push(NaN)
      continue
    }
    const px = (j: number) => p[j].x * W
    const py = (j: number) => p[j].y * H
    const ang2 = (a: number, b: number, c: number) => {
      const ux = px(a) - px(b)
      const uy = py(a) - py(b)
      const vx = px(c) - px(b)
      const vy = py(c) - py(b)
      const d = Math.hypot(ux, uy) * Math.hypot(vx, vy)
      return d ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d))) * DEG : NaN
    }
    // Średnia dwóch punktów ważona widocznością: z boku liczy się prawie tylko bliższa strona.
    const wv = (a: number, b: number, f: (j: number) => number) => {
      const wa = p[a].v ** 2 + 1e-3
      const wb = p[b].v ** 2 + 1e-3
      return (f(a) * wa + f(b) * wb) / (wa + wb)
    }
    const side = (sh: number, el: number, wr: number, hip: number, kn: number, an: number) => ({
      knee: flat ? ang2(hip, kn, an) : angle(w3(p, hip), w3(p, kn), w3(p, an)),
      hip: flat ? ang2(sh, hip, kn) : angle(w3(p, sh), w3(p, hip), w3(p, kn)),
      elbow: angle(w3(p, sh), w3(p, el), w3(p, wr)),
      shoulder: angle(w3(p, hip), w3(p, sh), w3(p, el)),
    })
    const L = side(J.lSh, J.lEl, J.lWr, J.lHip, J.lKnee, J.lAnk)
    const R = side(J.rSh, J.rEl, J.rWr, J.rHip, J.rKnee, J.rAnk)
    s.kneeL.push(L.knee)
    s.kneeR.push(R.knee)
    s.hipL.push(L.hip)
    s.hipR.push(R.hip)
    s.elbowL.push(L.elbow)
    s.elbowR.push(R.elbow)
    s.shoulderL.push(L.shoulder)
    s.shoulderR.push(R.shoulder)
    const shW3 = len(sub(w3(p, J.lSh), w3(p, J.rSh)))
    s.spread.push(shW3 > 0.05 ? (len(sub(w3(p, J.lWr), w3(p, J.rWr))) / shW3) * 100 : NaN)
    s.leftVis.push(vis(p, J.lSh, J.lHip, J.lKnee, J.lAnk, J.lEl, J.lWr))
    s.rightVis.push(vis(p, J.rSh, J.rHip, J.rKnee, J.rAnk, J.rEl, J.rWr))

    // Pochylenie: wektor biodra→barki względem pionu (świat MediaPipe: oś y w dół; z boku – obraz, oś y też w dół).
    if (flat) {
      const tx = (px(J.lSh) + px(J.rSh)) / 2 - (px(J.lHip) + px(J.rHip)) / 2
      const ty = (py(J.lSh) + py(J.rSh)) / 2 - (py(J.lHip) + py(J.rHip)) / 2
      const tl = Math.hypot(tx, ty)
      s.trunk.push(tl ? Math.acos(Math.max(-1, Math.min(1, -ty / tl))) * DEG : NaN)
    } else {
      const torso = sub(mid3(w3(p, J.lSh), w3(p, J.rSh)), mid3(w3(p, J.lHip), w3(p, J.rHip)))
      s.trunk.push(len(torso) ? Math.acos(Math.max(-1, Math.min(1, -torso[1] / len(torso)))) * DEG : NaN)
    }

    // Z obrazu (w pikselach, żeby proporcje kadru nie zniekształcały).
    const ankleDist = Math.abs(px(J.lAnk) - px(J.rAnk))
    s.valgus.push(ankleDist > 1 ? (Math.abs(px(J.lKnee) - px(J.rKnee)) / ankleDist) * 100 : NaN)
    const hipW = Math.abs(px(J.lHip) - px(J.rHip))
    s.shift.push(hipW > 1 ? (Math.abs((px(J.lHip) + px(J.rHip)) / 2 - (px(J.lAnk) + px(J.rAnk)) / 2) / hipW) * 100 : NaN)

    // Bliższa strona: widoczność całej strony (barki i biodra z boku bywają „widoczne” po obu stronach jednakowo).
    const near = s.leftVis[i] >= s.rightVis[i] ? [J.lSh, J.lHip, J.lAnk] : [J.rSh, J.rHip, J.rAnk]
    s.bodyLine.push(180 - angle(w3(p, near[0]), w3(p, near[1]), w3(p, near[2])))

    const torsoPx = Math.hypot((px(J.lSh) + px(J.rSh)) / 2 - (px(J.lHip) + px(J.rHip)) / 2, (py(J.lSh) + py(J.rSh)) / 2 - (py(J.lHip) + py(J.rHip)) / 2)
    const footX = (wv(J.lAnk, J.rAnk, px) + wv(J.lFoot, J.rFoot, px)) / 2
    s.wristDrift.push(torsoPx > 1 ? (Math.abs(wv(J.lWr, J.rWr, px) - footX) / torsoPx) * 100 : NaN)

    // Kolano względem linii biodro–kostka (na wysokości kolana); do środka ciała = plus.
    const kneeIn = (hip: number, kn: number, an: number, otherHip: number) => {
      const dy = py(an) - py(hip)
      if (Math.abs(dy) < 1 || hipW <= 1) return NaN
      const xLine = px(hip) + ((px(an) - px(hip)) * (py(kn) - py(hip))) / dy
      return (((px(kn) - xLine) * Math.sign(px(otherHip) - px(hip))) / hipW) * 100
    }
    s.kneeInL.push(kneeIn(J.lHip, J.lKnee, J.lAnk, J.rHip))
    s.kneeInR.push(kneeIn(J.rHip, J.rKnee, J.rAnk, J.lHip))
    const toLeft = Math.sign(px(J.lHip) - px(J.rHip))
    s.shiftS.push(hipW > 1 ? ((((px(J.lHip) + px(J.rHip)) / 2 - (px(J.lAnk) + px(J.rAnk)) / 2) * toLeft) / hipW) * 100 : NaN)
    s.hipTilt.push(hipW > 1 ? ((py(J.lHip) - py(J.rHip)) / hipW) * 100 : NaN)

    const d2 = (a: number, b: number) => Math.hypot(px(a) - px(b), py(a) - py(b))
    const nearLeft = near[0] === J.lSh
    const [nKnee, nAnk, nHeel, nFoot] = nearLeft ? [J.lKnee, J.lAnk, J.lHeel, J.lFoot] : [J.rKnee, J.rAnk, J.rHeel, J.rFoot]
    const shin = d2(nKnee, nAnk)
    s.torsoRatio.push(shin > 1 ? d2(near[0], near[1]) / shin : NaN)
    const bodyLen = d2(near[0], nAnk)
    if (bodyLen > 1) {
      const ux = (px(nAnk) - px(near[0])) / bodyLen
      const uy = (py(nAnk) - py(near[0])) / bodyLen
      const along = (px(near[1]) - px(near[0])) * ux + (py(near[1]) - py(near[0])) * uy
      s.hipSag.push(((py(near[1]) - (py(near[0]) + along * uy)) / bodyLen) * 100)
    } else s.hipSag.push(NaN)
    const shW = d2(J.lSh, J.rSh)
    s.wristDy.push(shW > 1 ? ((py(J.lWr) - py(J.rWr)) / shW) * 100 : NaN)
    // Wysokości w metrach (oś y świata w dół, biodra w 0) – do prędkości ruchu (VBT).
    const wy = (j: number) => p[j].wy
    const ankY = wv(J.lAnk, J.rAnk, wy)
    const wrY = wv(J.lWr, J.rWr, wy)
    s.hHip.push(ankY)
    s.hWrist.push(ankY - wrY)
    s.hShoulder.push(wrY - wv(J.lSh, J.rSh, wy))
    const footLen = d2(nHeel, nFoot)
    s.heel.push(footLen > 1 ? ((py(nFoot) - py(nHeel)) / footLen) * 100 : NaN)
    // Śledzona sztanga (tryb kalibracji)
    const b = tr.bar?.[i]
    if (b && torsoPx > 1) {
      const fwd = Math.sign(px(nFoot) - px(nHeel)) || 1
      const mid = (px(nHeel) + px(nFoot)) / 2
      s.barX.push((((b[0] * W - mid) * fwd) / torsoPx) * 100)
      s.hBar.push(Number.isFinite(mPerPx) ? -b[1] * H * mPerPx : NaN)
    } else {
      s.barX.push(NaN)
      s.hBar.push(NaN)
    }
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
  const raw = rawSignal(profile, s, view)
  // Ruchy, w których kąt rośnie przy wysiłku (unoszenie ramion, wspięcia) – odwracamy, żeby powtórzenie było doliną.
  return profile.invert ? raw.map((v) => 180 - v) : raw
}
/** Wartość mierzona (kąt w stopniach albo % dla rozstawu dłoni / pięt) z powrotem z sygnału. */
export const rawOf = (profile: Profile, v: number) => (profile.invert ? 180 - v : v)

function rawSignal(profile: Profile, s: Series, view: View): number[] {
  if (profile.signal === 'spread') return s.spread
  if (profile.signal === 'heel') return s.heel
  const [l, r] =
    profile.signal === 'knee' ? [s.kneeL, s.kneeR] : profile.signal === 'hip' ? [s.hipL, s.hipR] : profile.signal === 'shoulder' ? [s.shoulderL, s.shoulderR] : [s.elbowL, s.elbowR]
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
  // Z tyłu mierzymy to samo co z przodu (rozstaw kolan, asymetria, przesunięcie bioder).
  const mv: View = view === 'back' ? 'front' : view
  const valid = (key: string) => profile.metrics.find((m) => m.key === key)?.views.includes(mv) ?? false
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
  // Dolna połowa ruchu (tam pojawia się większość błędów: kolana, biodra, plecy).
  const [lo0, lo1] = lowHalf(sig, rep)
  // Biodra wstają szybciej niż barki: o ile tułów pochyla się bardziej w pierwszej połowie drogi w górę.
  const hipRise = () => maxIn(s.trunk, bottom, Math.max(bottom, Math.round(bottom + (end - bottom) * 0.5))) - around(s.trunk, bottom)
  // Skrócenie tułowia (bark–biodro) względem pozycji wyprostowanej – pośredni znak zaokrąglenia pleców.
  const backRound = () => {
    const ref = Math.max(around(s.torsoRatio, start, 3), around(s.torsoRatio, end, 3))
    return ref > 0 ? (1 - minIn(s.torsoRatio, start, end) / ref) * 100 : NaN
  }
  if (profile.key === 'squat') {
    const knee = pick(s.kneeL, s.kneeR)
    put('depth_knee', knee ? minIn(knee, start, end) : sig[bottom])
    const hip = pick(s.hipL, s.hipR) ?? s.hipL.map((v, i) => (v + s.hipR[i]) / 2)
    put('depth_hip', minIn(hip, start, end))
    put('trunk', around(s.trunk, bottom))
    put('valgus', minIn(s.valgus, lo0, lo1))
    put('asym', Math.abs(around(s.kneeL, bottom) - around(s.kneeR, bottom)))
    put('shift', around(s.shift, bottom))
    put('hip_rise', hipRise())
    put('back', backRound())
    put('heel_lift', maxIn(s.heel, start, end) - around(s.heel, start, 3))
    put('bar_mid', maxIn(s.barX.map(Math.abs), start, end))
  } else if (profile.key === 'deadlift') {
    put('hip_bottom', sig[bottom])
    const knee = pick(s.kneeL, s.kneeR) ?? s.kneeL
    put('knee_bottom', around(knee, bottom))
    put('trunk', around(s.trunk, bottom))
    put('lockout', maxIn(sig, bottom, end))
    // Śledzona sztanga, gdy jest (kalibracja); inaczej dłonie.
    put('bar_drift', finite(s.barX.slice(start, end + 1)).length > (end - start) * 0.6 ? maxIn(s.barX.map(Math.abs), start, end) : maxIn(s.wristDrift, start, end))
    put('hip_rise', hipRise())
    put('back', backRound())
  } else if (profile.key === 'press') {
    put('elbow_bottom', sig[bottom])
    put('lockout', maxIn(sig, bottom, end))
    put('wrist_asym', percentile(s.wristDy.slice(bottom, end + 1).map(Math.abs), 0.9))
    put('lean', maxIn(s.trunk, start, end))
    put('bar_mid', maxIn(s.barX.map(Math.abs), start, end))
  } else if (profile.key === 'pushup') {
    put('elbow_bottom', sig[bottom])
    put('body_line', maxIn(s.bodyLine.map(Math.abs), start, end))
  } else {
    // Ogólny profil rodziny ruchu: wartość w punkcie zwrotnym i zakres ruchu stawu sygnałowego.
    put('turn', rawOf(profile, sig[bottom]))
    put('range', Math.max(sig[start], sig[end]) - sig[bottom])
    put('trunk_move', maxIn(s.trunk, start, end) - minIn(s.trunk, start, end))
    put('bar_travel', maxIn(s.barX, start, end) - minIn(s.barX, start, end))
  }
  // Prędkość fazy koncentrycznej (w górę) punktu, który podnosi ciężar: biodra (przysiad), dłonie (martwy ciąg,
  // wyciskanie), barki (pompka). Tylko informacyjnie – nie flagujemy i nie porównujemy na heatmapie.
  // Śledzona sztanga (kalibracja) – najlepszy punkt do prędkości (VBT mierzy prędkość sztangi).
  const barOk = !!profile.bar && finite(s.hBar.slice(p1, end + 1)).length > (end - p1) * 0.7
  const h = barOk ? s.hBar : profile.key === 'squat' || profile.trace === 'hip' ? s.hHip : profile.key === 'pushup' ? s.hShoulder : s.hWrist
  const dur = t[end] - t[p1]
  const rise = at(h, end) - at(h, p1)
  if (dur > 0.1 && Number.isFinite(rise) && rise > 0.05) {
    out.mcv = Math.round((rise / dur) * 100) / 100
    out.rom = Math.round(rise * 100)
    let pv = 0
    for (let i = p1 + 1; i < end; i++) {
      const v = (h[Math.min(end, i + 1)] - h[Math.max(p1, i - 1)]) / (t[Math.min(end, i + 1)] - t[Math.max(p1, i - 1)] || 1)
      if (Number.isFinite(v) && v > pv) pv = v
    }
    out.pv = Math.round(Math.max(pv, out.mcv) * 100) / 100
  } else {
    out.mcv = null
    out.pv = null
    out.rom = null
  }
  void at
  return out
}

/** Zakres klatek, w których kąt sygnałowy jest w dolnej połowie zakresu powtórzenia. */
export function lowHalf(sig: number[], rep: Pick<Rep, 'start' | 'bottom' | 'end'>): [number, number] {
  const top = Math.max(sig[rep.start], sig[rep.end])
  const midv = sig[rep.bottom] + (top - sig[rep.bottom]) * 0.5
  let a = rep.bottom
  let b = rep.bottom
  while (a > rep.start && sig[a - 1] <= midv) a--
  while (b < rep.end && sig[b + 1] <= midv) b++
  return [a, b]
}

// ===================== Całość =====================
export interface AnalysisResult {
  view: View
  reps: Rep[]
  series: Series
  signal: number[]
  track: Track // nagranie po ustabilizowaniu stóp (do odtwarzacza i sylwetki)
}

/** Kąt stawu z obu stron: z bliższej (wyraźnie lepiej widocznej) strony, inaczej średnia. */
export function nearPair(s: Pick<Series, 'leftVis' | 'rightVis'>, l: number[], r: number[]): number[] {
  return l.map((lv, i) => {
    const rv = r[i]
    const dl = s.leftVis[i]
    const dr = s.rightVis[i]
    if (dl > dr + 0.1 && Number.isFinite(lv)) return lv
    if (dr > dl + 0.1 && Number.isFinite(rv)) return rv
    if (Number.isFinite(lv) && Number.isFinite(rv)) return (lv + rv) / 2
    return Number.isFinite(lv) ? lv : rv
  })
}

// ===================== Stopy w miejscu =====================
// Model „przesuwa” kostkę, piętę i palce razem z kolanem (przy przysiadzie stopa jedzie do przodu o 3–4 cm i wraca).
// W ćwiczeniach ze stopami na podłodze stopa się nie przesuwa: w każdym powtórzeniu palce i piętę trzymamy w miejscu
// (płynne przejście między pozycją przed i po powtórzeniu; pięta o tę samą poprawkę co palce) –
// kształt stopy zostaje, więc odrywanie pięty (obrót wokół palców) dalej widać.
const FEET_MOVE = new Set<ExerciseKey>(['knee_ext', 'knee_flex', 'leg_raise'])
const PT_CH = ['x', 'y'] as const // tylko obraz: współrzędne świata MediaPipe są liczone względem bioder (stopa „w miejscu” ma w nich zmienną wysokość)

export function pinFeet(tr: Track, reps: Pick<Rep, 'start' | 'end'>[], ex: ExerciseKey): Track {
  if (FEET_MOVE.has(ex) || !reps.length) return tr
  const W = tr.width || 1
  const H = tr.height || 1
  const torso = median(
    tr.poses.map((p) => (p ? Math.hypot(((p[J.lSh].x + p[J.rSh].x - p[J.lHip].x - p[J.rHip].x) / 2) * W, ((p[J.lSh].y + p[J.rSh].y - p[J.lHip].y - p[J.rHip].y) / 2) * H) : NaN)),
  )
  if (!(torso > 0)) return tr
  const n = tr.poses.length
  const out = tr.poses.map((p) => (p ? p.map((q) => ({ ...q })) : null))
  /** Mediana położenia punktu z kilku klatek (pozycja przed / po powtórzeniu). */
  const at = (j: number, i0: number, i1: number) => {
    const fr = tr.poses.slice(Math.max(0, i0), Math.min(n, i1 + 1)).filter((p): p is Pose => !!p)
    if (!fr.length) return null
    return Object.fromEntries(PT_CH.map((c) => [c, median(fr.map((p) => p[j][c]))])) as Record<(typeof PT_CH)[number], number>
  }
  for (const [toe, heel] of [
    [J.lFoot, J.lHeel],
    [J.rFoot, J.rHeel],
  ]) {
    for (const r of reps) {
      const a = at(toe, r.start - 3, r.start + 1)
      const b = at(toe, r.end - 1, r.end + 3)
      if (!a || !b) continue
      if (Math.hypot((a.x - b.x) * W, (a.y - b.y) * H) > 0.25 * torso) continue // stopa przestawiona (krok)
      const span = Math.max(1, r.end - r.start)
      const deltas: (Record<(typeof PT_CH)[number], number> | null)[] = []
      let maxDev = 0
      for (let i = r.start; i <= r.end; i++) {
        const p = tr.poses[i]
        if (!p) {
          deltas.push(null)
          continue
        }
        const f = (i - r.start) / span
        const d = Object.fromEntries(PT_CH.map((c) => [c, a[c] + (b[c] - a[c]) * f - p[toe][c]])) as Record<(typeof PT_CH)[number], number>
        maxDev = Math.max(maxDev, Math.hypot(d.x * W, d.y * H))
        deltas.push(d)
      }
      if (maxDev > 0.35 * torso) continue // stopa naprawdę się rusza – nie poprawiamy
      deltas.forEach((d, k) => {
        const p = out[r.start + k]
        if (!d || !p) return
        for (const j of [toe, heel]) for (const c of PT_CH) p[j][c] += d[c]
      })
    }
  }
  return { ...tr, poses: out }
}

function analyzeCore(tr: Track, ex: ExerciseKey, forceView?: View, segsIn?: Omit<Rep, 'metrics' | 'view'>[]) {
  const profile = PROFILES[ex]
  const view = forceView ?? detectView(tr)
  const raw = computeSeries(tr, view)
  const maxGap = Math.round(tr.fps * 0.5)
  const win = Math.max(3, Math.round(tr.fps * 0.12) | 1)
  const series = Object.fromEntries(Object.entries(raw).map(([k, a]) => [k, smooth(fillGaps(a, maxGap), win)])) as unknown as Series
  const signal = signalOf(profile, series, view)
  const segs = segsIn ?? segmentReps(signal, tr.t, profile.minRange)
  return { profile, view, series, signal, segs }
}

export function analyze(tr0: Track, ex: ExerciseKey, forceView?: View): AnalysisResult {
  // 1) wstępne powtórzenia → 2) stopy w miejscu → 3) analiza właściwa na ustabilizowanym nagraniu
  const first = analyzeCore(tr0, ex, forceView)
  const tr = pinFeet(tr0, first.segs, ex)
  const { profile, view, series, signal, segs } = tr === tr0 ? first : analyzeCore(tr, ex, forceView)
  const reps = segs.map((r) => {
    const rv = forceView ?? detectView(tr, r.start, r.end)
    const v = rv === 'unknown' ? view : rv
    return { ...r, view: v, metrics: repMetrics(profile, series, signal, tr.t, r, v) }
  })
  // Wszystkie powtórzenia z jednego ujęcia → to jest ujęcie nagrania.
  const repViews = new Set(reps.map((r) => r.view))
  return { view: repViews.size === 1 && reps.length ? reps[0].view! : view, reps, series, signal, track: tr }
}

/**
 * Pomiary od nowa dla zapisanych granic powtórzeń (starsze analizy nie mają nowszych pomiarów;
 * granice i ujęcia zostają takie, jak zapisano).
 */
export function remeasure(tr0: Track, ex: ExerciseKey, reps: Omit<Rep, 'metrics'>[], fallbackView: View): AnalysisResult {
  const n = tr0.poses.length
  const ok = reps.every((r) => r.start >= 0 && r.end < n && r.start <= r.bottom && r.bottom <= r.end)
  const forced = fallbackView === 'unknown' ? undefined : fallbackView
  if (!ok) return analyze(tr0, ex, forced)
  const tr = pinFeet(tr0, reps, ex)
  const { profile, view, series, signal, segs } = analyzeCore(tr, ex, forced)
  const base: AnalysisResult = { view, series, signal, track: tr, reps: segs.map((r) => ({ ...r, view, metrics: {} })) }
  return {
    ...base,
    reps: reps.map((r) => {
      const v = r.view ?? fallbackView
      return { start: r.start, bottom: r.bottom, end: r.end, view: v, metrics: repMetrics(profile, base.series, base.signal, tr.t, r, v) }
    }),
  }
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
  const res = out.map((f) => f.map(([x, y]) => [((x - ax) / torso) * flip, (y - ay) / torso] as P2))
  // Z boku: druga (zasłonięta) strona to zgadywanie modelu – w sylwetce zastępujemy ją bliższą stroną.
  const near = nearSide(tr, rep.start, rep.end)
  if (near) for (const f of res) for (const [l, r] of SIDE_PAIRS) near === 'L' ? (f[r] = f[l]) : (f[l] = f[r])
  return res
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

const SIDE_PAIRS: [number, number][] = [
  [J.lSh, J.rSh],
  [J.lEl, J.rEl],
  [J.lWr, J.rWr],
  [J.lHip, J.rHip],
  [J.lKnee, J.rKnee],
  [J.lAnk, J.rAnk],
  [J.lHeel, J.rHeel],
  [J.lFoot, J.rFoot],
]
const LIMB_L = [J.lEl, J.lWr, J.lKnee, J.lAnk, J.lHeel, J.lFoot]
const LIMB_R = [J.rEl, J.rWr, J.rKnee, J.rAnk, J.rHeel, J.rFoot]

/** Strona bliżej kamery, gdy druga jest wyraźnie gorzej widoczna (ujęcie z boku); null = obie widać podobnie. */
export function nearSide(tr: Track, from = 0, to = tr.poses.length - 1): 'L' | 'R' | null {
  if (tr.calib) return tr.calib.side // zatwierdzona przez trenerkę
  let l = 0
  let r = 0
  let c = 0
  for (let i = Math.max(0, from); i <= Math.min(tr.poses.length - 1, to); i++) {
    const p = tr.poses[i]
    if (!p) continue
    l += LIMB_L.reduce((s, j) => s + p[j].v, 0) / LIMB_L.length
    r += LIMB_R.reduce((s, j) => s + p[j].v, 0) / LIMB_R.length
    c++
  }
  if (!c) return null
  l /= c
  r /= c
  if (Math.abs(l - r) < 0.15 || Math.min(l, r) > 0.7) return null
  return l > r ? 'L' : 'R'
}

/** Punkty, których nie rysujemy: druga strona z boku (gdy model jej nie widzi) i ręce, gdy ćwiczenie ich nie mierzy. */
export function hiddenJoints(tr: Track, profile: Profile): number[] {
  const out = new Set<number>()
  if (profile.arms === false) [J.lEl, J.rEl, J.lWr, J.rWr].forEach((j) => out.add(j))
  const near = nearSide(tr)
  if (near) (near === 'L' ? LIMB_R : LIMB_L).forEach((j) => out.add(j))
  return [...out]
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
