// Buduje migrację z danymi biblioteki ćwiczeń: mięśnie główne/pomocnicze, opisy PL, klatki obrazków, nowe ćwiczenia z wger,
// atrybucja licencji i mapa progresji/alternatyw. Wejście: pobrane JSON-y (dane) + nasze spec_*.cjs. Wyjście: plik SQL + lista filmów.
const fs = require('fs')
const path = require('path')
const [dataDir, outSql, outVideos] = process.argv.slice(2)
const here = __dirname
const free = JSON.parse(fs.readFileSync(`${dataDir}/free.json`, 'utf8'))
const wger = []
for (const f of ['w0.json', 'w200.json', 'w400.json', 'w600.json', 'w800.json']) wger.push(...JSON.parse(fs.readFileSync(`${dataDir}/${f}`, 'utf8')).results)
const videos = JSON.parse(fs.readFileSync(`${dataDir}/videos.json`, 'utf8')).results
const NEW = require(path.join(here, 'spec_new.cjs'))
const { VIDEO, CHAINS, ALTS } = require(path.join(here, 'spec_map.cjs'))
const STAPLES = require(path.join(here, 'spec_staples.cjs'))

const SRC = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
const arr = (a) => `array[${(a ?? []).map(q).join(',')}]::text[]`

// ---------- opis PL z danych ----------
const ACC = { chest: 'klatkę piersiową', shoulders: 'barki', triceps: 'triceps', biceps: 'biceps', forearms: 'przedramiona', lats: 'mięśnie najszersze grzbietu', 'middle back': 'środek pleców', 'lower back': 'dolny odcinek pleców', traps: 'mięśnie czworoboczne', neck: 'szyję', abdominals: 'mięśnie brzucha', glutes: 'pośladki', quadriceps: 'mięśnie czworogłowe uda', hamstrings: 'mięśnie dwugłowe uda', adductors: 'przywodziciele', abductors: 'odwodziciele (pośladek średni)', calves: 'łydki' }
const NOM = { chest: 'klatka piersiowa', shoulders: 'barki', triceps: 'triceps', biceps: 'biceps', forearms: 'przedramiona', lats: 'najszersze grzbietu', 'middle back': 'środek pleców', 'lower back': 'dolny odcinek pleców', traps: 'czworoboczne', neck: 'szyja', abdominals: 'brzuch', glutes: 'pośladki', quadriceps: 'czworogłowe uda', hamstrings: 'dwugłowe uda', adductors: 'przywodziciele', abductors: 'odwodziciele', calves: 'łydki' }
const EQ = { barbell: 'ze sztangą', dumbbell: 'z hantlami', kettlebells: 'z kettlebell', cable: 'na wyciągu', machine: 'na maszynie', bands: 'z gumą oporową', 'medicine ball': 'z piłką lekarską', 'exercise ball': 'na piłce gimnastycznej', 'e-z curl bar': 'z gryfem łamanym', 'foam roll': 'na rollerze', 'body only': 'z masą własnego ciała', trx: 'na taśmach TRX', box: 'ze skrzynią' }
const FORCE = { push: 'pchające', pull: 'przyciągające', static: 'statyczne' }
function describe({ category, mechanic, force, primary, secondary, equipment }) {
  const eq = equipment.map((e) => EQ[e]).filter(Boolean)[0]
  const sec = secondary.filter((m) => !primary.includes(m)).map((m) => NOM[m])
  const tail = sec.length ? ` Pomocniczo pracują: ${sec.join(', ')}.` : ''
  const target = primary.map((m) => ACC[m]).filter(Boolean).join(' i ')
  if (category === 'stretching') return `Ćwiczenie rozciągające i mobilizujące: ${primary.map((m) => NOM[m]).join(', ')}${eq && eq !== 'z masą własnego ciała' ? ` (${eq})` : ''}.${tail}`
  if (category === 'cardio') return `Ćwiczenie kondycyjne angażujące głównie ${target}${eq && eq !== 'z masą własnego ciała' ? ` ${eq}` : ''}.${tail}`
  const kind =
    category === 'plyometrics' ? 'Ćwiczenie plyometryczne (dynamiczne)' : category === 'strongman' ? 'Ćwiczenie siłacza (strongman)' : category === 'olympic weightlifting' ? 'Element boju olimpijskiego' : mechanic === 'isolation' ? 'Ćwiczenie izolowane' : 'Ćwiczenie wielostawowe'
  const f = FORCE[force] ? `, ${FORCE[force]}` : ''
  return `${kind}${f}, na ${target}${eq ? ` ${eq}` : ''}.${tail}`
}

// ---------- wger: wyszukiwanie źródła dla nowych ćwiczeń ----------
const en = (w) => w.translations.find((t) => t.language === 2)
const toks = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x && !['with', 'the', 'a', 'on', 'of', 's'].includes(x)).map((x) => x.replace(/s$/, '')))
const jac = (a, b) => {
  let i = 0
  for (const x of a) if (b.has(x)) i++
  return i / (a.size + b.size - i || 1)
}
const wgerT = wger.filter(en).map((w) => ({ w, name: en(w).name, t: toks(en(w).name) }))
// Ręcznie wskazane źródło w wger ('' = brak – opis własny, bez obrazków z wger)
const SOURCE = { 'Hindu Push-Up': 'Hindu Pushups', 'Bird Dog Row': '', 'Scapular Push-Up': 'Scapular Pushups', 'Barbell Reverse Lunge': 'Barbell Step Back Lunge', 'Negative Pull-Up': 'Slow Eccentric Pull-Up Negative', 'Single-Leg Romanian Deadlift': 'Single Leg RDL', 'Donkey Kick': 'Kneeling kickbacks', 'Dumbbell Bulgarian Split Squat': 'Bulgarian Squat with Dumbbells', 'TRX Biceps Curl': 'Biceps with TRX', 'Barbell Thruster': 'Thruster' }
function wgerFor(name) {
  if (name in SOURCE) {
    if (!SOURCE[name]) return null
    const x = wgerT.find((y) => y.name.trim().toLowerCase() === SOURCE[name].toLowerCase())
    return x ? { ...x, score: 1 } : null
  }
  const t = toks(name)
  let best = null
  let bs = 0
  for (const x of wgerT) {
    const s = jac(t, x.t)
    if (s > bs) (bs = s), (best = x)
  }
  return bs >= 0.6 ? { ...best, score: bs } : null
}

const report = []
const sql = []
sql.push(`-- Biblioteka ćwiczeń: mięśnie główne/pomocnicze, opisy PL, klatki ruchu, nowe ćwiczenia z wger.de (CC-BY-SA), mapa progresji.
-- Wygenerowane skryptem z free-exercise-db (Unlicense) i wger.de; opisy i wybór – ręcznie.`)

// ---------- 1) istniejące ćwiczenia z free-exercise-db ----------
const staple = new Map(STAPLES.map((s) => [s[0], s]))
for (const e of free) {
  const st = staple.get(e.name)
  const primary = st?.[1] ?? e.primaryMuscles
  const secondary = (st?.[2] ?? e.secondaryMuscles).filter((m) => !primary.includes(m))
  const desc = st?.[3] ?? describe({ category: e.category, mechanic: e.mechanic, force: e.force, primary, secondary, equipment: e.equipment ? [e.equipment] : [] })
  sql.push(
    `update public.exercises set primary_muscles = ${arr(primary)}, secondary_muscles = ${arr(secondary)}, muscle_groups = ${arr([...primary, ...secondary])}, ` +
      `description = coalesce(description, ${q(desc)}), mechanic = ${q(e.mechanic)}, force = ${q(e.force)}, image_urls = ${arr(e.images.map((i) => SRC + i))} ` +
      `where source = 'free-exercise-db' and external_id = ${q(e.id)};`,
  )
}
// ćwiczenia własne trenerki: główny = pierwszy z listy, reszta pomocnicze (do poprawienia w edycji)
sql.push(`update public.exercises set primary_muscles = muscle_groups[1:1], secondary_muscles = coalesce(muscle_groups[2:], '{}') where source = 'own' and cardinality(primary_muscles) = 0;`)

// ---------- 2) nowe ćwiczenia ----------
for (const [, nameEn, pl, prim, sec, eq, pat, lvl, mech, force, desc] of NEW) {
  const w = wgerFor(nameEn)
  const fromWger = !!w
  const img = w ? w.w.images.map((i) => i.image) : []
  const attribution = w ? `wger.de, autor: ${w.w.license_author || 'społeczność wger'}, licencja ${w.w.license.short_name}` : null
  report.push(`${nameEn} <= ${w ? `${w.name} (${w.score.toFixed(2)}) img ${img.length}` : '— (opis własny)'}`)
  sql.push(
    `insert into public.exercises (name_pl, name_en, muscle_groups, primary_muscles, secondary_muscles, equipment, movement_pattern, level, description, mechanic, force, image_urls, image_url, source, external_id, attribution, created_by) values (` +
      `${q(pl)}, ${q(nameEn)}, ${arr([...prim, ...sec])}, ${arr(prim)}, ${arr(sec)}, ${arr(eq)}, ${q(pat)}, '${lvl}', ${q(desc)}, ${q(mech)}, ${q(force)}, ${arr(img)}, ${q(img[0] ?? null)}, ` +
      `${fromWger ? "'wger'" : "'library'"}, ${q(fromWger ? w.w.uuid : nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}, ${q(attribution)}, null) on conflict (source, external_id) do nothing;`,
  )
}

// ---------- 3) mapa: progresje i alternatywy (po nazwie EN, pierwsze pasujące ćwiczenie z biblioteki) ----------
const known = new Set([...free.map((e) => e.name), ...NEW.map((n) => n[1])])
const pid = (n) => `(select id from public.exercises where name_en = ${q(n)} and source <> 'own' order by source = 'free-exercise-db' desc limit 1)`
const rel = new Set()
const missing = new Set()
const addRel = (a, b, kind) => {
  if (!known.has(a)) return missing.add(a)
  if (!known.has(b)) return missing.add(b)
  const k = `${a}|${b}|${kind}`
  if (rel.has(k) || a === b) return
  rel.add(k)
}
for (const ch of CHAINS) for (let i = 0; i + 1 < ch.length; i++) addRel(ch[i], ch[i + 1], 'progression')
for (const [a, b] of ALTS) {
  addRel(a, b, 'alternative')
  addRel(b, a, 'alternative')
}
for (const k of rel) {
  const [a, b, kind] = k.split('|')
  sql.push(`insert into public.exercise_relations (from_exercise, to_exercise, kind) select ${pid(a)}, ${pid(b)}, '${kind}' where ${pid(a)} is not null and ${pid(b)} is not null on conflict do nothing;`)
}

// ---------- 4) filmy do pobrania ----------
const vlist = []
const byW = new Map()
for (const v of videos) byW.set(v.exercise, [...(byW.get(v.exercise) ?? []), v])
for (const w of wger) {
  const t = en(w)
  const target = t && VIDEO[t.name]
  if (!target || !byW.get(w.id)) continue
  if (vlist.some((x) => x.target === target)) continue
  // najmniejszy plik H.264, w razie braku – najmniejszy dowolny
  const vs = byW.get(w.id).sort((a, b) => (a.codec === 'h264') - (b.codec === 'h264') || 0).sort((a, b) => (b.codec === 'h264') - (a.codec === 'h264') || a.size - b.size)
  const v = vs[0]
  vlist.push({ target, wgerName: t.name, url: v.video, codec: v.codec, size: v.size, author: v.license_author || w.license_author, license: w.license.short_name, slug: target.toLowerCase().replace(/[^a-z0-9]+/g, '-') })
}
fs.writeFileSync(outSql, sql.join('\n') + '\n')
fs.writeFileSync(outVideos, JSON.stringify(vlist, null, 1))
console.log(report.join('\n'))
console.log('\nrelacje', rel.size, 'brakujące nazwy:', [...missing].join(' | ') || '—')
console.log('filmy', vlist.length, 'h264', vlist.filter((v) => v.codec === 'h264').length, 'łącznie MB', Math.round(vlist.reduce((s, v) => s + v.size, 0) / 1e6))
