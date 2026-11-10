// Szkielet: 17 z 33 punktów MediaPipe Pose (bez twarzy i dłoni) + kodowanie do bazy.

/** Indeksy MediaPipe zachowywane w analizie – kolejność = indeks w naszym szkielecie. */
export const KEEP = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32] as const

export const J = {
  nose: 0,
  lSh: 1,
  rSh: 2,
  lEl: 3,
  rEl: 4,
  lWr: 5,
  rWr: 6,
  lHip: 7,
  rHip: 8,
  lKnee: 9,
  rKnee: 10,
  lAnk: 11,
  rAnk: 12,
  lHeel: 13,
  rHeel: 14,
  lFoot: 15,
  rFoot: 16,
} as const
export const N_JOINTS = KEEP.length

/** Kości do rysowania. */
export const BONES: [number, number][] = [
  [J.lSh, J.rSh],
  [J.lSh, J.lEl],
  [J.lEl, J.lWr],
  [J.rSh, J.rEl],
  [J.rEl, J.rWr],
  [J.lSh, J.lHip],
  [J.rSh, J.rHip],
  [J.lHip, J.rHip],
  [J.lHip, J.lKnee],
  [J.lKnee, J.lAnk],
  [J.lAnk, J.lHeel],
  [J.lHeel, J.lFoot],
  [J.lAnk, J.lFoot],
  [J.rHip, J.rKnee],
  [J.rKnee, J.rAnk],
  [J.rAnk, J.rHeel],
  [J.rHeel, J.rFoot],
  [J.rAnk, J.rFoot],
]
export const LEFT = new Set<number>([J.lSh, J.lEl, J.lWr, J.lHip, J.lKnee, J.lAnk, J.lHeel, J.lFoot])

/** Punkt: obraz (x, y w 0..1), widoczność 0..1 i współrzędne świata w metrach (środek między biodrami). */
export interface Pt {
  x: number
  y: number
  v: number
  wx: number
  wy: number
  wz: number
}
export type Pose = Pt[] // długość N_JOINTS
export interface Track {
  fps: number
  width: number
  height: number
  t: number[] // czas klatki [s]
  poses: (Pose | null)[] // null = nie wykryto osoby
  smoothed?: boolean // punkty już ustabilizowane (filter.ts)
}

// ---------- Kodowanie: liczby całkowite w płaskiej tablicy na klatkę (~6 KB/s nagrania w JSON) ----------
export interface EncodedTrack {
  v: 1
  fps: number
  w: number
  h: number
  t: number[] // ms
  f: (number[] | null)[] // na punkt: x·1e4, y·1e4, v·100, wx·1e3, wy·1e3, wz·1e3
}

export function encodeTrack(tr: Track): EncodedTrack {
  return {
    v: 1,
    fps: tr.fps,
    w: tr.width,
    h: tr.height,
    t: tr.t.map((s) => Math.round(s * 1000)),
    f: tr.poses.map((p) =>
      p
        ? p.flatMap((q) => [Math.round(q.x * 1e4), Math.round(q.y * 1e4), Math.round(q.v * 100), Math.round(q.wx * 1e3), Math.round(q.wy * 1e3), Math.round(q.wz * 1e3)])
        : null,
    ),
  }
}

export function decodeTrack(e: EncodedTrack): Track {
  return {
    fps: e.fps,
    width: e.w,
    height: e.h,
    t: e.t.map((ms) => ms / 1000),
    poses: e.f.map((a) =>
      a
        ? Array.from({ length: N_JOINTS }, (_, i) => ({
            x: a[i * 6] / 1e4,
            y: a[i * 6 + 1] / 1e4,
            v: a[i * 6 + 2] / 100,
            wx: a[i * 6 + 3] / 1e3,
            wy: a[i * 6 + 4] / 1e3,
            wz: a[i * 6 + 5] / 1e3,
          }))
        : null,
    ),
  }
}

// ---------- Format 2: binarnie + gzip (ok. 3–4× mniej niż JSON; minuta nagrania ≈ 200 KB) ----------
// Klatka: czas [ms] (Int32) + 17 punktów × 6 liczb Int16 zapisanych jako różnica względem poprzedniej klatki (x·1e4, y·1e4, v·100, wx·1e3, wy·1e3, wz·1e3);
// brak osoby w klatce = widoczność −1 we wszystkich punktach.
export interface PackedTrack {
  v: 2
  fps: number
  w: number
  h: number
  n: number // liczba klatek
  s?: 1 // punkty ustabilizowane przed zapisem
  z: string // base64(gzip(Int32[n] czasy + Int16[n·17·6] punkty))
}
export type StoredTrack = EncodedTrack | PackedTrack

const clamp16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x)))

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}
function toB64(b: Uint8Array) {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
function fromB64(s: string) {
  const bin = atob(s)
  const b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  return b
}

export async function packTrack(tr: Track): Promise<PackedTrack> {
  const n = tr.poses.length
  const times = new Int32Array(n)
  const pts = new Int16Array(n * N_JOINTS * 6)
  for (let f = 0; f < n; f++) {
    times[f] = Math.round(tr.t[f] * 1000)
    const p = tr.poses[f]
    for (let j = 0; j < N_JOINTS; j++) {
      const o = (f * N_JOINTS + j) * 6
      if (!p) {
        pts[o + 2] = -1
        continue
      }
      const q = p[j]
      pts[o] = clamp16(q.x * 1e4)
      pts[o + 1] = clamp16(q.y * 1e4)
      pts[o + 2] = clamp16(q.v * 100)
      pts[o + 3] = clamp16(q.wx * 1e3)
      pts[o + 4] = clamp16(q.wy * 1e3)
      pts[o + 5] = clamp16(q.wz * 1e3)
    }
  }
  // Różnice względem poprzedniej klatki (ruch jest płynny → małe liczby → gzip kompresuje lepiej). Arytmetyka Int16 z zawijaniem – odwracalna dokładnie.
  const row = N_JOINTS * 6
  for (let i = pts.length - 1; i >= row; i--) pts[i] = pts[i] - pts[i - row]
  const raw = new Uint8Array(times.byteLength + pts.byteLength)
  raw.set(new Uint8Array(times.buffer), 0)
  raw.set(new Uint8Array(pts.buffer), times.byteLength)
  const z = toB64(await pipe(raw, new CompressionStream('gzip')))
  return { v: 2, fps: tr.fps, w: tr.width, h: tr.height, n, z, ...(tr.smoothed ? { s: 1 as const } : {}) }
}

export async function unpackTrack(e: StoredTrack): Promise<Track> {
  if (e.v !== 2) return decodeTrack(e)
  const raw = await pipe(fromB64(e.z), new DecompressionStream('gzip'))
  const times = new Int32Array(raw.buffer, raw.byteOffset, e.n)
  const pts = new Int16Array(raw.buffer.slice(raw.byteOffset + e.n * 4, raw.byteOffset + raw.byteLength))
  const row = N_JOINTS * 6
  for (let i = row; i < pts.length; i++) pts[i] = pts[i] + pts[i - row]
  const t: number[] = []
  const poses: (Pose | null)[] = []
  for (let f = 0; f < e.n; f++) {
    t.push(times[f] / 1000)
    const base = f * N_JOINTS * 6
    if (pts[base + 2] === -1 && pts[base + 8] === -1) {
      poses.push(null)
      continue
    }
    poses.push(
      Array.from({ length: N_JOINTS }, (_, j) => {
        const o = base + j * 6
        return { x: pts[o] / 1e4, y: pts[o + 1] / 1e4, v: pts[o + 2] / 100, wx: pts[o + 3] / 1e3, wy: pts[o + 4] / 1e3, wz: pts[o + 5] / 1e3 }
      }),
    )
  }
  return { fps: e.fps, width: e.w, height: e.h, t, poses, smoothed: e.s === 1 }
}
