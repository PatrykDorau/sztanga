// Kompresja nagrania z telefonu w przeglądarce: przeskalowanie do max 720p i ponowne
// nagranie przez MediaRecorder z niższym bitrate. Bez dodatkowych bibliotek (ffmpeg.wasm waży ~30 MB).
// Gdy przeglądarka nie potrafi (np. starsze Safari) albo wynik nie jest mniejszy – zwracamy oryginał.

const MAX_SIDE = 720
const BITRATE = 1_500_000
const SKIP_BELOW_BYTES = 4 * 1024 * 1024

function pickMime(): string | null {
  const candidates = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  if (typeof MediaRecorder === 'undefined') return null
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

export async function compressVideo(file: File, onProgress?: (p: number) => void): Promise<File> {
  if (file.size < SKIP_BELOW_BYTES) return file
  const mime = pickMime()
  const canvasProto = HTMLCanvasElement.prototype as HTMLCanvasElement & { captureStream?: unknown }
  if (!mime || typeof canvasProto.captureStream !== 'function') return file

  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    video.playsInline = true
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res()
      video.onerror = () => rej(new Error('Nie można odczytać wideo'))
    })

    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round((video.videoWidth * scale) / 2) * 2
    canvas.height = Math.round((video.videoHeight * scale) / 2) * 2
    const ctx = canvas.getContext('2d')!

    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BITRATE })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const stopped = new Promise<void>((res) => (recorder.onstop = () => res()))

    let raf = 0
    const draw = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      if (video.duration) onProgress?.(Math.min(1, video.currentTime / video.duration))
      raf = requestAnimationFrame(draw)
    }

    recorder.start(1000)
    await video.play()
    draw()
    await new Promise<void>((res) => (video.onended = () => res()))
    cancelAnimationFrame(raf)
    recorder.stop()
    await stopped
    onProgress?.(1)

    const type = mime.split(';')[0]
    const blob = new Blob(chunks, { type })
    if (blob.size === 0 || blob.size >= file.size) return file
    const ext = type === 'video/mp4' ? 'mp4' : 'webm'
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
