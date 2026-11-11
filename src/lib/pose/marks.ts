// Pomiar z tabeli → co pokazać na szkielecie: klatka powtórzenia i kąt (trzy punkty) albo pochylenie od pionu.
// Czysty TS, bez przeglądarki.
import { J, type Track } from './skeleton'
import { nearSide, type Rep } from './analysis'
import type { Profile } from './profiles'

export interface AngleMark {
  a: number // ramię kąta
  b: number // wierzchołek
  c?: number // drugie ramię; brak = kąt od pionu (pochylenie tułowia)
  text: string // podpis przy wierzchołku, np. „kolano 84°”
}
export interface MetricMark {
  frame: number
  mark?: AngleMark
  joints: number[] // punkty do podświetlenia (pomiary bez kąta: rozstaw kolan, pięty…)
}

const side = (tr: Track, frame: number) => {
  const near = nearSide(tr)
  const p = tr.poses[frame]
  const left = near ? near === 'L' : p ? p[J.lKnee].v + p[J.lAnk].v + p[J.lEl].v >= p[J.rKnee].v + p[J.rAnk].v + p[J.rEl].v : true
  return left
    ? { sh: J.lSh, el: J.lEl, wr: J.lWr, hip: J.lHip, knee: J.lKnee, ank: J.lAnk, heel: J.lHeel, toe: J.lFoot }
    : { sh: J.rSh, el: J.rEl, wr: J.rWr, hip: J.rHip, knee: J.rKnee, ank: J.rAnk, heel: J.rHeel, toe: J.rFoot }
}

/** Klatka i kąt do pokazania dla pomiaru `metric` w powtórzeniu `rep`. valueText = wartość z tabeli (podpis). */
export function metricMark(tr: Track, profile: Profile, metric: string, rep: Pick<Rep, 'start' | 'bottom' | 'end'>, valueText: string): MetricMark | null {
  if (metric === 'ecc' || metric === 'pause' || metric === 'con' || metric === 'mcv' || metric === 'pv' || metric === 'rom') return null
  // Wyprost na górze – koniec powtórzenia; biodra pierwsze – połowa wstawania; reszta – najniższy punkt.
  const frame = metric === 'lockout' ? rep.end : metric === 'hip_rise' ? Math.round(rep.bottom + (rep.end - rep.bottom) * 0.35) : rep.bottom
  const s = side(tr, frame)
  const angle = (a: number, b: number, c: number, name: string): MetricMark => ({ frame, joints: [], mark: { a, b, c, text: `${name} ${valueText}` } })
  const tilt = (name: string): MetricMark => ({ frame, joints: [], mark: { a: s.sh, b: s.hip, text: `${name} ${valueText}` } })
  const bySignal = () =>
    profile.signal === 'knee'
      ? angle(s.hip, s.knee, s.ank, 'kolano')
      : profile.signal === 'hip'
        ? angle(s.sh, s.hip, s.knee, 'biodro')
        : profile.signal === 'elbow'
          ? angle(s.sh, s.el, s.wr, 'łokieć')
          : profile.signal === 'shoulder'
            ? angle(s.hip, s.sh, s.el, 'bark')
            : { frame, joints: profile.signal === 'heel' ? [s.heel, s.toe] : [J.lWr, J.rWr] }
  switch (metric) {
    case 'depth_knee':
    case 'knee_bottom':
      return angle(s.hip, s.knee, s.ank, 'kolano')
    case 'depth_hip':
    case 'hip_bottom':
    case 'lockout':
      return angle(s.sh, s.hip, s.knee, 'biodro')
    case 'elbow_bottom':
      return angle(s.sh, s.el, s.wr, 'łokieć')
    case 'body_line':
      return angle(s.sh, s.hip, s.ank, 'linia ciała')
    case 'trunk':
    case 'lean':
    case 'trunk_move':
    case 'hip_rise':
      return tilt('tułów')
    case 'turn':
    case 'range':
      return bySignal()
    case 'valgus':
    case 'asym':
      return { frame, joints: [J.lKnee, J.rKnee, J.lAnk, J.rAnk] }
    case 'shift':
      return { frame, joints: [J.lHip, J.rHip] }
    case 'back':
      return { frame, joints: [s.sh, s.hip] }
    case 'heel_lift':
      return { frame, joints: [s.heel, s.toe] }
    case 'bar_drift':
    case 'wrist_asym':
      return { frame, joints: [J.lWr, J.rWr] }
    default:
      return { frame, joints: [] }
  }
}
