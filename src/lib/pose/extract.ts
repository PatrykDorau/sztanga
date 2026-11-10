// Wykrywanie pozy na urządzeniu (MediaPipe Pose Landmarker). Wideo nie opuszcza telefonu.
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { KEEP, type Pose, type Track } from './skeleton'

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
      numPoses: 1,
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
  let lastTs = -1
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new DOMException('Przerwano', 'AbortError')
    const tt = i / FPS
    await seek(video, tt)
    const ts = Math.max(lastTs + 1, Math.round(tt * 1000))
    lastTs = ts
    const r = pose.detectForVideo(video, ts)
    const img = r.landmarks[0]
    const world = r.worldLandmarks[0]
    t.push(tt)
    poses.push(
      img && world
        ? KEEP.map((k) => ({ x: img[k].x, y: img[k].y, v: img[k].visibility ?? 1, wx: world[k].x, wy: world[k].y, wz: world[k].z }))
        : null,
    )
    if (i % 3 === 0) onProgress?.(i / n)
  }
  onProgress?.(1)
  return { fps: FPS, width: video.videoWidth, height: video.videoHeight, t, poses }
}
