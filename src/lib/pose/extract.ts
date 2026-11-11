// Wykrywanie pozy na urządzeniu (MediaPipe Pose Landmarker). Wideo nie opuszcza telefonu.
import type { PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { KEEP, type Pose, type Track } from './skeleton'
import { createPersonPicker } from './pickPerson'

const VERSION = '0.10.21'
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'

export const MAX_SECONDS = 90
const FPS = 30

let landmarker: Promise<PoseLandmarker> | null = null

/** Model ładowany raz (ok. 9 MB, potem z pamięci podręcznej przeglądarki). */
export function loadPose(): Promise<PoseLandmarker> {
  landmarker ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(WASM)
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 3, // kilka osób w kadrze – wybieramy nagrywaną (pickPerson)
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    try {
      return await PoseLandmarker.createFromOptions(fileset, opts('GPU'))
    } catch {
      return await PoseLandmarker.createFromOptions(fileset, opts('CPU'))
    }
  })().catch((e) => {
    landmarker = null
    throw e
  })
  return landmarker
}

// MediaPipe w trybie VIDEO wymaga ściśle rosnących znaczników czasu przez cały czas życia modelu –
// także między kolejnymi nagraniami i kamerą. Jeden wspólny zegar [ms].
let clock = 0
const tick = (ms = 0) => (clock = Math.max(clock + 1, Math.round(ms)))

/** Poza wybranej osoby z wyniku modelu (i = indeks sylwetki; -1 = brak). */
export const toPose = (r: PoseLandmarkerResult, i = 0): Pose | null => {
  const img = i >= 0 ? r.landmarks[i] : undefined
  const world = i >= 0 ? r.worldLandmarks[i] : undefined
  return img && world ? KEEP.map((k) => ({ x: img[k].x, y: img[k].y, v: img[k].visibility ?? 1, wx: world[k].x, wy: world[k].y, wz: world[k].z })) : null
}
/** Wynik → poza osoby śledzonej przez picker (osoby w tle są pomijane). */
const tracked = (pick: ReturnType<typeof createPersonPicker>) => (r: PoseLandmarkerResult) => toPose(r, pick(r.landmarks))

/**
 * Detektor dla kamery na żywo: znaczniki czasu = rzeczywisty upływ czasu (MediaPipe wygładza ruch wg odstępów),
 * przesunięte tak, żeby były późniejsze niż wszystko, co model już widział.
 */
export function liveDetector(pose: PoseLandmarker) {
  const offset = Math.max(0, clock + 1 - performance.now())
  const read = tracked(createPersonPicker())
  return (source: HTMLVideoElement): Pose | null => read(pose.detectForVideo(source, tick(performance.now() + offset)))
}

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((res) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      res()
    }
    video.addEventListener('seeked', done)
    video.currentTime = t
  })
}

export async function loadVideo(src: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.src = src
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res()
    video.onerror = () => rej(new Error('Nie udało się otworzyć nagrania. Spróbuj formatu MP4.'))
  })
  return video
}

/**
 * Klatka po klatce (30 kl./s): przewinięcie wideo i wykrycie pozy. Deterministyczne – ten sam plik daje ten sam wynik.
 * onProgress(0..1); signal pozwala przerwać.
 */
export async function extractTrack(video: HTMLVideoElement, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<Track> {
  const pose = await loadPose()
  const duration = Math.min(video.duration || 0, MAX_SECONDS)
  if (!(duration > 0.5)) throw new Error('Nagranie jest za krótkie.')
  const n = Math.floor(duration * FPS)
  const t: number[] = []
  const poses: (Pose | null)[] = []
  const base = clock + 1
  const read = tracked(createPersonPicker())
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new DOMException('Przerwano', 'AbortError')
    const tt = i / FPS
    await seek(video, tt)
    t.push(tt)
    poses.push(read(pose.detectForVideo(video, tick(base + tt * 1000))))
    if (i % 3 === 0) onProgress?.(i / n)
  }
  onProgress?.(1)
  return { fps: FPS, width: video.videoWidth, height: video.videoHeight, t, poses }
}
