// Kilka osób w kadrze: model wykrywa do 3 sylwetek, a my trzymamy się jednej – tej, którą nagrywamy.
// Start: największa sylwetka (najbliżej kamery), z premią za środek kadru. Potem: ta najbliżej poprzedniej
// pozycji (w odniesieniu do jej wielkości). Gdy nikt nie jest blisko – klatka bez pozy zamiast przeskoku
// na osobę w tle; po dłuższej przerwie (osoba wyszła z kadru) wybieramy od nowa.
export interface Pt {
  x: number
  y: number
  visibility?: number
}
interface Box {
  cx: number
  cy: number
  size: number // przekątna sylwetki (0–1.4 w jednostkach kadru)
}

const MIN_VIS = 0.4
/** Prostokąt widocznych punktów sylwetki (współrzędne obrazu 0–1). */
export function boxOf(lm: Pt[]): Box | null {
  const pts = lm.filter((p) => (p.visibility ?? 1) >= MIN_VIS && p.x > -0.2 && p.x < 1.2 && p.y > -0.2 && p.y < 1.2)
  if (pts.length < 6) return null
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x)
    y0 = Math.min(y0, p.y)
    y1 = Math.max(y1, p.y)
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.hypot(x1 - x0, y1 - y0) }
}

/** Ile klatek bez „naszej” osoby, zanim wybierzemy od nowa (ok. 1 s przy 30 kl./s). */
const LOST_FRAMES = 30
/** Jak daleko (w wielkościach sylwetki) może się przesunąć środek między klatkami. */
const MAX_JUMP = 0.6

export function createPersonPicker() {
  let last: Box | null = null
  let lost = 0
  /** Indeks wybranej sylwetki albo -1 (brak naszej osoby w tej klatce). */
  return (people: Pt[][]): number => {
    const boxes = people.map(boxOf)
    let best = -1
    if (last && lost < LOST_FRAMES) {
      let bestD = Infinity
      boxes.forEach((b, i) => {
        if (!b) return
        // odległość środków + różnica wielkości (osoba w tle jest zwykle wyraźnie mniejsza)
        const d = Math.hypot(b.cx - last!.cx, b.cy - last!.cy) / last!.size + Math.abs(Math.log(b.size / last!.size)) * 0.5
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      if (bestD > MAX_JUMP * (1 + lost / 10)) best = -1
    } else {
      // pierwszy wybór: największa sylwetka, premia za środek kadru
      let bestS = -Infinity
      boxes.forEach((b, i) => {
        if (!b) return
        const s = b.size - Math.abs(b.cx - 0.5) * 0.3
        if (s > bestS) {
          bestS = s
          best = i
        }
      })
    }
    if (best >= 0) {
      last = boxes[best]!
      lost = 0
    } else lost++
    return best
  }
}
