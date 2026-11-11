// Test anatomii animacji wzorców ruchu: każda rodzina, każdy wariant sprzętu, 41 klatek cyklu.
// Sprawdza: kolano zgina się tylko do przodu, łokieć tylko w stronę zgięcia, odcinki ciała mają stałą długość
// (ręka/noga nie „rozciąga się”, gdy cel jest poza zasięgiem), nic nie wchodzi pod podłogę, kąty w ludzkim zakresie.
// Uruchom: npm run test:anatomy
import { FAMILIES, FAMILY_KEYS, type Fig, type P, type Variant } from '../src/lib/pose/families'

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const len = (a: P) => Math.hypot(a[0], a[1])
const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0]
function ang(a: P, b: P, c: P) {
  const u = sub(a, b)
  const v = sub(c, b)
  return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (len(u) * len(v) || 1)))) * 180) / Math.PI
}
const L = { thigh: 0.45, shin: 0.45, arm: 0.3, fore: 0.27 }
const VARIANTS: Variant[] = ['body', 'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'band']

function check(f: Fig): string[] {
  const out: string[] = []
  const legs: [P, P, P, string][] = [[f.hip, f.knee, f.ankle, 'noga']]
  if (f.knee2 && f.ankle2) legs.push([f.hip2 ?? f.hip, f.knee2, f.ankle2, 'noga 2'])
  for (const [h, k, a, n] of legs) {
    const kneeAng = ang(h, k, a)
    // Kolano: przy zgięciu musi być z przodu linii biodro–kostka (ludzik zwrócony w prawo / przodem do góry).
    if (f.view === 'side' && kneeAng < 172 && cross(sub(a, h), sub(k, h)) < -0.002) out.push(`${n}: kolano zgina się do tyłu (${kneeAng.toFixed(0)}°)`)
    if (kneeAng < 25) out.push(`${n}: kolano zgięte ponad zakres (${kneeAng.toFixed(0)}°)`)
    if (Math.abs(len(sub(k, h)) - L.thigh) > 0.01) out.push(`${n}: udo ma ${len(sub(k, h)).toFixed(2)} m`)
    if (Math.abs(len(sub(a, k)) - L.shin) > 0.01) out.push(`${n}: podudzie ma ${len(sub(a, k)).toFixed(2)} m (stopa poza zasięgiem)`)
  }
  const arms: [P, P, P, string][] = [[f.shoulder, f.elbow, f.wrist, 'ręka']]
  if (f.elbow2 && f.wrist2) arms.push([f.shoulder2 ?? f.shoulder, f.elbow2, f.wrist2, 'ręka 2'])
  for (const [s, e, w, n] of arms) {
    const elbowAng = ang(s, e, w)
    // Łokieć zgina się tak, że przedramię idzie do przodu względem ramienia (nie „łamie się” do tyłu).
    if (f.view === 'side' && !f.armSide && elbowAng < 172 && cross(sub(w, s), sub(e, s)) > 0.002) out.push(`${n}: łokieć zgina się w złą stronę (${elbowAng.toFixed(0)}°)`)
    if (!f.armSide && elbowAng < 25) out.push(`${n}: łokieć zgięty ponad zakres (${elbowAng.toFixed(0)}°)`)
    if (Math.abs(len(sub(e, s)) - L.arm) > 0.01) out.push(`${n}: ramię ma ${len(sub(e, s)).toFixed(2)} m`)
    if (Math.abs(len(sub(w, e)) - L.fore) > 0.01) out.push(`${n}: przedramię ma ${len(sub(w, e)).toFixed(2)} m (dłoń poza zasięgiem)`)
  }
  const hipAng = ang(f.shoulder, f.hip, f.knee)
  if (hipAng < 20) out.push(`biodro zgięte ponad zakres (${hipAng.toFixed(0)}°)`)
  for (const [n, p] of Object.entries(f)) if (Array.isArray(p) && (p as P)[1] < -0.015) out.push(`${n} pod podłogą (${(p as P)[1].toFixed(2)})`)
  return out
}

let bad = 0
for (const fam of FAMILY_KEYS) {
  const problems = new Map<string, string[]>()
  for (const v of VARIANTS) {
    for (let i = 0; i <= 40; i++) {
      const ph = i / 40
      for (const msg of check(FAMILIES[fam].pose(ph, v))) {
        const list = problems.get(msg.replace(/\(.*\)/, '').trim()) ?? []
        list.push(`${v}@${ph.toFixed(2)} ${msg.match(/\(.*\)/)?.[0] ?? ''}`)
        problems.set(msg.replace(/\(.*\)/, '').trim(), list)
      }
    }
  }
  if (!problems.size) {
    console.log(`✓ ${fam}`)
    continue
  }
  bad++
  console.log(`✗ ${fam}`)
  for (const [m, where] of problems) console.log(`    ${m}: ${where.length} kl. (np. ${where.slice(0, 3).join(', ')})`)
}
console.log(bad ? `\n${bad} rodzin z błędami` : '\nWszystkie animacje anatomicznie poprawne')
if (bad) process.exitCode = 1
