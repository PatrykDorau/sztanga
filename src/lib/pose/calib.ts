// Tryb kalibracji: trenerka zatwierdza (i poprawia) punkty na jednej klatce – bliższą stronę, stawy, piętę i palce,
// koniec sztangi. Potem:
//  • stopy stoją w zatwierdzonym miejscu (dopóki ćwiczący nie przestawi nóg),
//  • klatki, w których model „rozciąga” udo / podudzie / ramię / przedramię (inna długość niż zatwierdzona), są odrzucane
//    i uzupełniane z sąsiednich klatek (model złapał coś innego – np. drugą nogę, sztangę, osobę w tle),
//  • sztanga jest śledzona w obrazie (dopasowanie wycinka obrazu klatka po klatce) – prawdziwy tor sztangi, nie szacunek z dłoni.
import { J, type Calib, type CalibKey, type Pose, type Track } from './skeleton'
import type { Profile } from './profiles'

export type { Calib, CalibKey }
type XY = [number, number]

export const sideJoints = (side: 'L' | 'R' | null) =>
  side === 'L'
    ? { shoulder: J.lSh, elbow: J.lEl, wrist: J.lWr, hip: J.lHip, knee: J.lKnee, ankle: J.lAnk, heel: J.lHeel, toe: J.lFoot }
    : { shoulder: J.rSh, elbow: J.rEl, wrist: J.rWr, hip: J.rHip, knee: J.rKnee, ankle: J.rAnk, heel: J.rHeel, toe: J.rFoot }

/** Punkty do zatwierdzenia dla ćwiczenia (bez rąk, gdy ich nie mierzymy; sztanga, gdy ćwiczenie ją ma). */
export function calibKeys(profile: Profile, side: 'L' | 'R' | null): CalibKey[] {
  // Z przodu / z tyłu: tylko sztanga – długości kończyn i stopy poprawiamy z boku (z przodu rzut skraca odcinki).
  if (!side) return profile.bar ? ['bar'] : []
  const arms: CalibKey[] = profile.arms === false ? [] : ['elbow', 'wrist']
  const legs: CalibKey[] = ['hip', 'knee', 'ankle', 'heel', 'toe']
  return [...(profile.bar ? (['bar'] as CalibKey[]) : []), 'shoulder', ...arms, ...legs]
}

/** Strona bliżej kamery z widoczności kończyn w całym nagraniu (null = obie widać podobnie). */
export function guessSide(tr: Track): 'L' | 'R' | null {
  const L = [J.lEl, J.lWr, J.lKnee, J.lAnk, J.lHeel, J.lFoot]
  const R = [J.rEl, J.rWr, J.rKnee, J.rAnk, J.rHeel, J.rFoot]
  let l = 0
  let r = 0
  for (const p of tr.poses) {
    if (!p) continue
    l += L.reduce((s, j) => s + p[j].v, 0)
    r += R.reduce((s, j) => s + p[j].v, 0)
  }
  const n = tr.poses.filter(Boolean).length * L.length
  if (!n || Math.abs(l - r) / n < 0.1) return null
  return l > r ? 'L' : 'R'
}

/** Propozycja punktów: z wykrytej sylwetki na klatce `frame`; sztanga – w punkcie, który ją niesie. */
export function proposeCalib(tr: Track, profile: Profile, frame: number, side: 'L' | 'R' | null): Calib {
  const p = tr.poses[frame]
  const js = sideJoints(side)
  const pts: Calib['pts'] = {}
  if (p) {
    for (const k of calibKeys(profile, side)) {
      if (k === 'bar') continue
      const j = js[k as Exclude<CalibKey, 'bar'>]
      pts[k] = side ? [p[j].x, p[j].y] : mid(p, j, k)
    }
    if (profile.bar) {
      const c = profile.bar === 'shoulder' ? 'shoulder' : profile.bar === 'wrist' ? 'wrist' : 'hip'
      const j = js[c]
      const at = side ? [p[j].x, p[j].y] : mid(p, j, c)
      pts.bar = [at[0], at[1] - 0.03] // trochę nad stawem, żeby oba punkty było widać – trenerka przesuwa na koniec sztangi
    }
  }
  return { frame, side, pts }
}
// Z przodu: środek obu stron (oś ciała).
function mid(p: Pose, _j: number, k: CalibKey): XY {
  const l = sideJoints('L')[k as Exclude<CalibKey, 'bar'>]
  const r = sideJoints('R')[k as Exclude<CalibKey, 'bar'>]
  return [(p[l].x + p[r].x) / 2, (p[l].y + p[r].y) / 2]
}

/** Dobra klatka do kalibracji: start pierwszego powtórzenia (stoi prosto), inaczej pierwsza z wykrytą sylwetką. */
export function calibFrame(tr: Track, firstRepStart?: number) {
  if (firstRepStart != null && tr.poses[firstRepStart]) return firstRepStart
  const i = tr.poses.findIndex(Boolean)
  return Math.max(0, i)
}

// ===================== Poprawki szkieletu =====================
const CH = ['x', 'y', 'wx', 'wy', 'wz'] as const

export function applyCalib(tr: Track, c: Calib, profile: Profile): Track {
  const W = tr.width || 1
  const H = tr.height || 1
  const poses = tr.poses.map((p) => (p ? p.map((q) => ({ ...q })) : null))
  const out: Track = { ...tr, poses, calib: c }
  if (!c.side) return out
  const js = sideJoints(c.side)
  const px = (a: XY, b: XY) => Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H)
  const P = (p: Pose, j: number): XY => [p[j].x, p[j].y]
  const torso = px(c.pts.shoulder ?? [0, 0], c.pts.hip ?? [0, 0]) || H * 0.15

  // 1) Stopy w zatwierdzonym miejscu – dopóki wykryte palce są blisko (dalej = krok, przestawienie nóg).
  if (c.pts.heel && c.pts.toe) {
    for (const p of poses) {
      if (!p || px(P(p, js.toe), c.pts.toe) > 0.35 * torso) continue
      p[js.toe].x = c.pts.toe[0]
      p[js.toe].y = c.pts.toe[1]
      p[js.heel].x = c.pts.heel[0]
      p[js.heel].y = c.pts.heel[1]
      p[js.toe].v = Math.max(p[js.toe].v, 0.9)
      p[js.heel].v = Math.max(p[js.heel].v, 0.9)
    }
  }

  // 2) Długości odcinków: klatki z „rozciągniętą” kończyną odrzucamy i uzupełniamy z sąsiednich.
  const seg = (a: CalibKey, b: CalibKey) => (c.pts[a] && c.pts[b] ? px(c.pts[a]!, c.pts[b]!) : NaN)
  const ref = { thigh: seg('hip', 'knee'), shin: seg('knee', 'ankle'), upper: seg('shoulder', 'elbow'), fore: seg('elbow', 'wrist') }
  const off = (len: number, r: number) => Number.isFinite(r) && r > 1 && (len / r < 0.78 || len / r > 1.22)
  const bad = new Map<number, Set<number>>() // staw → klatki
  const mark = (j: number, i: number) => (bad.get(j) ?? bad.set(j, new Set()).get(j)!).add(i)
  poses.forEach((p, i) => {
    if (!p) return
    const thighOff = off(px(P(p, js.hip), P(p, js.knee)), ref.thigh)
    const shinOff = off(px(P(p, js.knee), P(p, js.ankle)), ref.shin)
    if (thighOff) mark(js.knee, i)
    if (shinOff && !thighOff) mark(js.ankle, i)
    if (profile.arms !== false) {
      const upOff = off(px(P(p, js.shoulder), P(p, js.elbow)), ref.upper)
      const foreOff = off(px(P(p, js.elbow), P(p, js.wrist)), ref.fore)
      if (upOff) mark(js.elbow, i)
      if (foreOff && !upOff) mark(js.wrist, i)
    }
  })
  const maxGap = Math.round((tr.fps || 30) * 0.6)
  for (const [j, set] of bad) {
    let i = 0
    while (i < poses.length) {
      if (!set.has(i) || !poses[i]) {
        i++
        continue
      }
      let k = i
      while (k < poses.length && (set.has(k) || !poses[k])) k++
      const a = i - 1
      const b = k
      const pa = poses[a]
      const pb = poses[b]
      for (let m = i; m < k; m++) {
        const p = poses[m]
        if (!p) continue
        if (pa && pb && k - i <= maxGap) {
          const f = (m - a) / (b - a)
          for (const ch of CH) p[j][ch] = pa[j][ch] + (pb[j][ch] - pa[j][ch]) * f
          p[j].v = Math.min(pa[j].v, pb[j].v)
        } else p[j].v = Math.min(p[j].v, 0.2) // za długo – nie rysujemy i nie liczymy
      }
      i = k
    }
  }
  return out
}

// ===================== Śledzenie sztangi w obrazie =====================
const WORK_W = 320 // szerokość obrazu roboczego [px]

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((res) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return res()
    const done = () => {
      video.removeEventListener('seeked', done)
      res()
    }
    video.addEventListener('seeked', done)
    video.currentTime = t
  })
}

/** Obraz w skali szarości (praca na pomniejszonej klatce). */
function grab(video: HTMLVideoElement, g: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  g.drawImage(video, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  const out = new Float32Array(w * h)
  for (let i = 0, k = 0; i < out.length; i++, k += 4) out[i] = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]
  return out
}

function patch(img: Float32Array, w: number, h: number, cx: number, cy: number, r: number): Float32Array | null {
  if (cx - r < 0 || cy - r < 0 || cx + r >= w || cy + r >= h) return null
  const n = 2 * r + 1
  const out = new Float32Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = img[(cy - r + y) * w + (cx - r + x)]
  return out
}
function stats(a: Float32Array) {
  let s = 0
  for (const v of a) s += v
  const m = s / a.length
  let q = 0
  for (const v of a) q += (v - m) ** 2
  return { m, sd: Math.sqrt(q / a.length) || 1e-6 }
}

/** Dopasowanie wzorca (znormalizowana korelacja) w oknie ±R wokół (px, py). */
function search(img: Float32Array, w: number, h: number, tpl: Float32Array, r: number, px: number, py: number, R: number) {
  const n = 2 * r + 1
  const ts = stats(tpl)
  let best = -2
  let bx = px
  let by = py
  for (let cy = Math.max(r, py - R); cy <= Math.min(h - r - 1, py + R); cy++) {
    for (let cx = Math.max(r, px - R); cx <= Math.min(w - r - 1, px + R); cx++) {
      let s = 0
      let s2 = 0
      let st = 0
      for (let y = 0; y < n; y++) {
        const row = (cy - r + y) * w + (cx - r)
        for (let x = 0; x < n; x++) {
          const v = img[row + x]
          s += v
          s2 += v * v
          st += v * tpl[y * n + x]
        }
      }
      const N = n * n
      const m = s / N
      const sd = Math.sqrt(Math.max(1e-6, s2 / N - m * m))
      const ncc = (st / N - m * ts.m) / (sd * ts.sd)
      if (ncc > best) {
        best = ncc
        bx = cx
        by = cy
      }
    }
  }
  return { x: bx, y: by, score: best }
}

/**
 * Tor sztangi: od klatki kalibracji do końca, potem wstecz do początku. Wzorzec = wycinek obrazu wokół zaznaczonego
 * końca sztangi (talerz), lekko odświeżany przy pewnym dopasowaniu. Klatka bez pewnego dopasowania albo z punktem daleko
 * od stawu, który niesie sztangę = brak (luka, uzupełniana, gdy krótka).
 */
export async function trackBar(
  video: HTMLVideoElement,
  tr: Track,
  c: Calib,
  profile: Profile,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
  debug?: (i: number, score: number, far: boolean) => void,
) {
  const start = c.pts.bar
  if (!start || !profile.bar) return undefined
  const w = WORK_W
  const h = Math.round((WORK_W * (tr.height || video.videoHeight || 16)) / (tr.width || video.videoWidth || 9))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d', { willReadFrequently: true })!
  const r = 12 // wzorzec 25×25 px obrazu roboczego
  const n = tr.poses.length
  const out: ([number, number] | null)[] = new Array(n).fill(null)
  // Staw, który niesie sztangę: z dwóch stron ten, który na klatce kalibracji był bliżej zaznaczonej sztangi.
  const pair = profile.bar === 'shoulder' ? [J.lSh, J.rSh] : profile.bar === 'wrist' ? [J.lWr, J.rWr] : [J.lHip, J.rHip]
  const p0 = tr.poses[c.frame]
  const cj = p0 ? pair.reduce((b, j) => (Math.hypot(p0[j].x - start[0], p0[j].y - start[1]) < Math.hypot(p0[b].x - start[0], p0[b].y - start[1]) ? j : b), pair[0]) : pair[0]
  // Przesunięcie sztangi względem stawu (do ponownego odnalezienia po zgubieniu).
  const off: XY = p0 ? [start[0] - p0[cj].x, start[1] - p0[cj].y] : [0, 0]
  const torsoPx = Math.hypot(((c.pts.shoulder?.[0] ?? 0) - (c.pts.hip?.[0] ?? 0)) * w, ((c.pts.shoulder?.[1] ?? 0) - (c.pts.hip?.[1] ?? 0)) * h) || h * 0.15
  let done = 0
  const total = n

  async function run(dir: 1 | -1) {
    await seek(video, tr.t[c.frame])
    const img0 = grab(video, g, w, h)
    const x0 = Math.round(start![0] * w)
    const y0 = Math.round(start![1] * h)
    const orig = patch(img0, w, h, x0, y0, r)
    if (!orig) return
    let tpl = orig.slice()
    let x = x0
    let y = y0
    let vx = 0
    let vy = 0
    let lost = 0
    if (dir === 1) out[c.frame] = [x0 / w, y0 / h]
    for (let i = c.frame + dir; i >= 0 && i < n; i += dir) {
      if (signal?.aborted) throw new DOMException('Przerwano', 'AbortError')
      await seek(video, tr.t[i])
      const img = grab(video, g, w, h)
      const p = tr.poses[i]
      // Zgubiona – szukamy tam, gdzie jest teraz staw niosący (z tym samym przesunięciem co na kalibracji).
      const guess: XY | null = p ? [(p[cj].x + off[0]) * w, (p[cj].y + off[1]) * h] : null
      const R = lost ? Math.min(40, 14 + lost * 4) : 14
      const px = Math.round(lost > 1 && guess ? guess[0] : x + vx)
      const py = Math.round(lost > 1 && guess ? guess[1] : y + vy)
      let m = search(img, w, h, tpl, r, px, py, R)
      // Odświeżony wzorzec mógł „odpłynąć” – sprawdzamy też oryginał.
      if (m.score < 0.7) {
        const m2 = search(img, w, h, orig, r, px, py, R)
        if (m2.score > m.score) m = m2
      }
      // Sztanga nie odjeżdża od stawu, który ją niesie.
      const far = guess ? Math.hypot(guess[0] - m.x, guess[1] - m.y) > 0.9 * torsoPx : false
      debug?.(i, m.score, far)
      const close = guess ? Math.hypot(guess[0] - m.x, guess[1] - m.y) < 0.35 * torsoPx : false
      if ((m.score >= 0.55 && !far) || (m.score >= 0.4 && close)) {
        vx = 0.6 * vx + 0.4 * (m.x - x)
        vy = 0.6 * vy + 0.4 * (m.y - y)
        x = m.x
        y = m.y
        lost = 0
        out[i] = [x / w, y / h]
        if (m.score > 0.85) {
          const np = patch(img, w, h, x, y, r)
          if (np) for (let k = 0; k < tpl.length; k++) tpl[k] = 0.9 * tpl[k] + 0.1 * np[k]
        }
      } else {
        lost++
        vx *= 0.5
        vy *= 0.5
      }
      done++
      if (done % 4 === 0) onProgress?.(done / total)
    }
  }
  await run(1)
  await run(-1)
  onProgress?.(1)
  return smoothBar(out, tr.fps || 30)
}

/** Wygładzenie toru: mediana z 3 klatek, krótkie luki (do 0,3 s) uzupełnione liniowo. */
export function smoothBar(b: ([number, number] | null)[], fps: number): ([number, number] | null)[] {
  const n = b.length
  const med = b.map((q, i) => {
    const a = b[i - 1]
    const c = b[i + 1]
    if (!q || !a || !c) return q
    const m = (u: number, v: number, w: number) => Math.max(Math.min(u, v), Math.min(Math.max(u, v), w))
    return [m(a[0], q[0], c[0]), m(a[1], q[1], c[1])] as [number, number]
  })
  const out = med.slice()
  const maxGap = Math.round(fps * 0.3)
  let i = 0
  while (i < n) {
    if (out[i]) {
      i++
      continue
    }
    let k = i
    while (k < n && !out[k]) k++
    const a = out[i - 1]
    const c = out[k]
    if (a && c && k - i <= maxGap) for (let m = i; m < k; m++) {
      const f = (m - i + 1) / (k - i + 1)
      out[m] = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f]
    }
    i = k
  }
  return out
}
