import { analyze, flagsFor, averageRep, refStats, summarize, zScore } from '../src/lib/pose/analysis'
import { encodeTrack, decodeTrack } from '../src/lib/pose/skeleton'
import { PROFILES } from '../src/lib/pose/profiles'
import { makeTrack } from './synthetic'

for (const [name, tr] of [
  ['front, 6 powt., koślawienie 4–6', makeTrack('front', { reps: 6, valgusReps: [4, 5, 6] })],
  ['side, 5 powt.', makeTrack('side', { reps: 5, seed: 3 })],
  ['side, płytko 3 powt.', makeTrack('side', { reps: 3, depth: 125, seed: 11 })],
] as const) {
  const enc = JSON.stringify(encodeTrack(tr))
  const back = decodeTrack(JSON.parse(enc))
  const r = analyze(back, 'squat')
  console.log(`\n== ${name}: widok=${r.view}, powtórzeń=${r.reps.length}, JSON ${(enc.length / 1024).toFixed(0)} KB / ${tr.t.at(-1)!.toFixed(0)} s`)
  r.reps.forEach((rep, i) => console.log(`  #${i + 1} ${back.t[rep.start].toFixed(2)}→${back.t[rep.bottom].toFixed(2)}→${back.t[rep.end].toFixed(2)}`, JSON.stringify(rep.metrics)))
  console.log('  flagi:', flagsFor('squat', r.reps, {}).map((f) => f.text))
  const avg = averageRep(back, r.reps, PROFILES.squat)
  console.log('  średnia: dno fazy', avg?.bottomPhase.toFixed(2), 'czas', avg?.duration.toFixed(2), 'fazy', JSON.stringify(avg?.phases))
}
const ref = analyze(makeTrack('front', { reps: 4, seed: 99 }), 'squat')
const cli = analyze(makeTrack('front', { reps: 6, valgusReps: [4, 5, 6] }), 'squat')
const st = refStats(ref.reps); const sm = summarize(cli.reps)
console.log('\nz-score vs wzorzec:', Object.fromEntries(PROFILES.squat.metrics.map((m) => [m.key, zScore(sm[m.key], st[m.key], m.tol)?.toFixed(2) ?? null])))

// Format 2 (binarnie + gzip): wierny zapis i rozmiar
{
  const { packTrack, unpackTrack } = await import('../src/lib/pose/skeleton')
  const tr = makeTrack('front', { reps: 6, valgusReps: [4, 5, 6], seed: 7 })
  const v1 = JSON.stringify(encodeTrack(tr)).length
  const packed = await packTrack(tr)
  const v2 = JSON.stringify(packed).length
  const back = await unpackTrack(packed)
  let maxErr = 0
  back.poses.forEach((p, f) => p && p.forEach((q, j) => (maxErr = Math.max(maxErr, Math.abs(q.x - tr.poses[f]![j].x), Math.abs(q.wy - tr.poses[f]![j].wy)))))
  const nulls = back.poses.filter((p) => !p).length === tr.poses.filter((p) => !p).length
  const same = analyze(back, 'squat').reps.length === analyze(tr, 'squat').reps.length
  console.log(`\n== zapis: JSON ${(v1 / 1024).toFixed(0)} KB → gzip ${(v2 / 1024).toFixed(0)} KB (${(v1 / v2).toFixed(1)}×), błąd ≤ ${maxErr.toFixed(4)}, puste klatki ${nulls ? 'OK' : 'BŁĄD'}, powtórzenia ${same ? 'OK' : 'BŁĄD'}`)
  if (!nulls || !same || maxErr > 0.001) process.exit(1)
}
