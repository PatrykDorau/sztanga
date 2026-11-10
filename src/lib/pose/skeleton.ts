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
