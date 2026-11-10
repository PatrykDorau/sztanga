// Uwagi trenerskie: z pomiarów powtórzeń robi wnioski w języku trenera –
// co widać (z liczbami), co powiedzieć ćwiczącemu i nad czym popracować. Czysty TS, bez przeglądarki.
// To wskazania do sprawdzenia na nagraniu, nie diagnoza: model widzi 17 punktów, nie widzi kręgosłupa ani sztangi.
import { lowHalf, mean, ranges, type Rep, type Series } from './analysis'
import { PROFILES, thresholdFor, type ExerciseKey, type FlagDef, type Thresholds, type View } from './profiles'
import { J, type Track } from './skeleton'

export type Severity = 'high' | 'medium' | 'low'
export const SEVERITY_LABEL: Record<Severity, string> = { high: 'Priorytet', medium: 'Do poprawy', low: 'Drobiazg' }

export interface Finding {
  key: string
  title: string // profesjonalna nazwa błędu
  short: string // krótko, na podgląd na żywo
  severity: Severity
  obs: string // co widać na nagraniu (z liczbami)
  cue: string // co powiedzieć ćwiczącemu
  fix: string // nad czym popracować
  reps: number[] // numery powtórzeń od 1
  repsText: string
  frame: number // klatka, na której widać to najwyraźniej
  joints: number[] // punkty szkieletu do podświetlenia
}

export interface Coaching {
  headline: string
  findings: Finding[]
  good: string[] // co wygląda dobrze
  notes: string[] // czego z tego ujęcia nie da się ocenić itp.
}

interface Ctx {
  tr: Track
  s: Series
  sig: number[]
  reps: Rep[]
  hit: number[] // indeksy powtórzeń (od 0), w których przekroczono próg
  worst: Rep // powtórzenie z największym przekroczeniem
  value: number // pomiar w tym powtórzeniu
  limit: number
}

interface Entry {
  title: string | ((c: Ctx) => string)
  joints: number[]
  strong: number // przekroczenie progu o tyle = priorytet
  severity?: Severity // na sztywno (np. tempo = drobiazg)
  mild?: boolean // mniej pewny pomiar: skala drobiazg / do poprawy zamiast do poprawy / priorytet
  obs: (c: Ctx) => string
  cue: string | ((c: Ctx) => string)
  fix: string
  frame?: (c: Ctx) => number
  ok: string // gdy pomiar jest w normie
}

const r0 = (v: number) => `${Math.round(v)}`
const fin = Number.isFinite
/** Indeks skrajnej wartości serii w [i0, i1]. */
function argIn(a: number[], i0: number, i1: number, kind: 'min' | 'max', abs = false) {
  let best = i0
  let bv = kind === 'min' ? Infinity : -Infinity
  for (let i = i0; i <= i1; i++) {
    const v = abs ? Math.abs(a[i]) : a[i]
    if (!fin(v)) continue
    if (kind === 'min' ? v < bv : v > bv) {
      bv = v
      best = i
    }
  }
  return best
}
const avgIn = (a: number[], i0: number, i1: number) => mean(a.slice(i0, i1 + 1))
const KNEES = [J.lKnee, J.rKnee]
const HIPS = [J.lHip, J.rHip]
const BACK = [J.lSh, J.rSh, J.lHip, J.rHip]

const valgusFrame = (c: Ctx) => {
  const [a, b] = lowHalf(c.sig, c.worst)
  return argIn(c.s.valgus, a, b, 'min')
}
const hipRiseFrame = (c: Ctx) => argIn(c.s.trunk, c.worst.bottom, Math.round(c.worst.bottom + (c.worst.end - c.worst.bottom) * 0.5), 'max')
const backFrame = (c: Ctx) => argIn(c.s.torsoRatio, c.worst.start, c.worst.end, 'min')
const BACK_OBS = (c: Ctx, where: string) =>
  `Odcinek bark–biodro skraca się o ${r0(c.value)}% względem pozycji wyprostowanej (granica ${r0(c.limit)}%) – tak wygląda zaokrąglenie pleców ${where}. Model nie widzi kręgosłupa: potwierdź na nagraniu.`

const ENTRIES: Record<ExerciseKey, Record<string, Entry>> = {
  squat: {
    valgus: {
      title: 'Dynamiczne koślawienie kolan',
      joints: KNEES,
      strong: 12,
      frame: valgusFrame,
      obs: (c) => {
        const f = valgusFrame(c)
        const d = c.s.kneeInL[f] - c.s.kneeInR[f]
        const side = !fin(d) || Math.abs(d) < 5 ? 'oba kolana podobnie' : d > 0 ? 'bardziej lewe kolano' : 'bardziej prawe kolano'
        const k = Math.max(2, Math.round((c.tr.fps || 30) * 0.1))
        const phase = f > c.worst.bottom + k ? 'przy wstawaniu' : f < c.worst.bottom - k ? 'przy schodzeniu' : 'w najniższym punkcie'
        return `Kolana schodzą do ${r0(c.value)}% rozstawu kostek (granica ${r0(c.limit)}%) – ${side}, najmocniej ${phase}.`
      },
      cue: 'Kolana uciekają do środka! Rozpychaj kolana na zewnątrz, mocniej dociskając zewnętrzną krawędź stopy.',
      fix: 'Guma nad kolanami, przysiad z pauzą w dole, wzmocnienie pośladka średniego (odwodzenie, monster walk). Jeśli pojawia się dopiero w końcówce serii – mniejszy ciężar albo krótsza seria.',
      ok: 'Kolana prowadzone stabilnie nad stopami',
    },
    depth: {
      title: 'Płytki przysiad',
      joints: [...HIPS, ...KNEES],
      strong: 15,
      obs: (c) => `Kolano zgina się najwyżej do ${r0(c.value)}° (granica ${r0(c.limit)}°; mniej = głębiej).`,
      cue: 'Zejdź niżej – biodra co najmniej do linii kolan. Nie skracaj ruchu na dole.',
      fix: 'Sprawdź mobilność stawu skokowego i bioder; przysiad do skrzyni na docelowej wysokości, na próbę podkładki pod pięty. Jeśli zakres ucieka dopiero pod obciążeniem – zmniejsz ciężar.',
      ok: 'Pełna głębokość',
    },
    asym: {
      title: 'Asymetria pracy nóg',
      joints: KNEES,
      strong: 8,
      obs: (c) => {
        const b = c.worst.bottom
        const side = c.s.kneeL[b] < c.s.kneeR[b] ? 'lewa' : 'prawa'
        return `W dole kolana różnią się o ${r0(c.value)}° – mocniej zgina się ${side} noga (granica ${r0(c.limit)}°).`
      },
      cue: 'Jedna noga pracuje mocniej. Rozłóż ciężar równo na obie stopy i schodź symetrycznie.',
      fix: 'Ćwiczenia jednostronne (wykroki, split squat), zaczynając od słabszej strony. Sprawdź ustawienie stóp i ruchomość skokową po obu stronach.',
      ok: 'Symetryczna praca nóg',
    },
    shift: {
      title: 'Przesunięcie bioder w bok (hip shift)',
      joints: HIPS,
      strong: 8,
      obs: (c) => {
        const b = c.worst.bottom
        const dir = c.s.shiftS[b] > 0 ? 'lewą' : 'prawą'
        const tilt = c.s.hipTilt[b]
        const low = fin(tilt) && Math.abs(tilt) > 8 ? `; ${tilt > 0 ? 'lewe' : 'prawe'} biodro jest niżej` : ''
        return `W dole biodra uciekają w ${dir} stronę o ${r0(c.value)}% szerokości bioder (granica ${r0(c.limit)}%)${low}.`
      },
      cue: (c) => `Biodra uciekają w ${c.s.shiftS[c.worst.bottom] > 0 ? 'lewo' : 'prawo'}. Dociśnij równo obie stopy i wstawaj prosto w górę.`,
      fix: 'Przysiad z pauzą i wolnym opuszczaniem (3 s), praca jednostronna nogi, od której biodra uciekają. Zapytaj o dyskomfort w biodrze lub kostce po tej stronie.',
      ok: 'Biodra na środku, bez uciekania w bok',
    },
    trunk: {
      title: 'Nadmierne pochylenie tułowia',
      joints: BACK,
      strong: 10,
      obs: (c) => `W dole tułów pochylony ${r0(c.value)}° od pionu (granica ${r0(c.limit)}°).`,
      cue: 'Klatka wyżej, napnij brzuch i trzymaj tułów sztywno – nie składaj się nad udami.',
      fix: 'Goblet squat lub front squat, wzmocnienie prostowników i mięśni brzucha, mobilność stawu skokowego (pochylenie często kompensuje sztywne kostki).',
      ok: 'Tułów w dobrej pozycji',
    },
    ecc: {
      title: 'Opuszczanie bez kontroli',
      joints: KNEES,
      strong: 99,
      severity: 'low',
      obs: (c) => `Zejście trwa ${c.value.toFixed(1).replace('.', ',')} s (granica ${String(c.limit).replace('.', ',')} s).`,
      cue: 'Schodź wolniej – 2–3 sekundy w dół, cały czas napięty.',
      fix: 'Przysiad w tempie 3-1-1; mniejszy ciężar, dopóki opuszczanie nie będzie kontrolowane.',
      ok: 'Kontrolowane opuszczanie',
    },
    hip_rise: {
      title: 'Biodra wstają pierwsze (przysiad „dzień dobry”)',
      joints: [...HIPS, J.lSh, J.rSh],
      strong: 8,
      frame: hipRiseFrame,
      obs: (c) => `Na początku wstawania tułów pochyla się o kolejne ${r0(c.value)}° (granica ${r0(c.limit)}°) – biodra idą w górę szybciej niż barki.`,
      cue: 'Biodra uciekają do góry przed klatką. Wstawaj klatką i biodrami jednocześnie – pchaj plecami w sztangę.',
      fix: 'Przysiad z pauzą w dole, front squat, wzmocnienie czworogłowych. Zwykle znak za dużego ciężaru.',
      ok: 'Biodra i barki wstają razem',
    },
    back: {
      title: 'Możliwe zaokrąglanie pleców („koci grzbiet”, butt wink)',
      joints: BACK,
      strong: 8,
      frame: backFrame,
      obs: (c) => BACK_OBS(c, 'w dole przysiadu'),
      cue: 'Plecy tracą neutralną pozycję w dole. Napnij brzuch, klatka dumnie – schodź tylko tak głęboko, jak utrzymasz proste plecy.',
      fix: 'Skróć zakres do miejsca, w którym miednica się nie podwija; mobilność bioder i tylnej taśmy, nauka napięcia brzucha (bracing), przysiad z pauzą.',
      ok: 'Brak oznak zaokrąglania pleców',
    },
    heel_lift: {
      title: 'Możliwe odrywanie pięt',
      joints: [J.lHeel, J.rHeel, J.lFoot, J.rFoot],
      strong: 20,
      mild: true,
      frame: (c) => argIn(c.s.heel, c.worst.start, c.worst.end, 'max'),
      obs: (c) => `Pięta unosi się względem palców o ok. ${r0(c.value)}% długości stopy (granica ${r0(c.limit)}%). Punkty stóp bywają niedokładne – sprawdź na nagraniu.`,
      cue: 'Ciężar na całej stopie – dociśnij pięty do podłogi.',
      fix: 'Mobilność stawu skokowego; na czas pracy nad zakresem podkładki pod pięty lub buty z podwyższoną piętą.',
      ok: 'Pięty na podłodze',
    },
  },
  deadlift: {
    lockout: {
      title: 'Niepełny wyprost bioder',
      joints: HIPS,
      strong: 10,
      frame: (c) => argIn(c.sig, c.worst.bottom, c.worst.end, 'max'),
      obs: (c) => `Na górze biodro prostuje się tylko do ${r0(c.value)}° (granica ${r0(c.limit)}°).`,
      cue: 'Dokończ ruch – dopchnij biodra do sztangi i napnij pośladki na górze, bez przeprostu w lędźwiach.',
      fix: 'Hip thrust, martwy ciąg z pauzą na górze.',
      ok: 'Pełny wyprost bioder na górze',
    },
    bar_drift: {
      title: 'Sztanga odchodzi od nóg',
      joints: [J.lWr, J.rWr],
      strong: 10,
      frame: (c) => argIn(c.s.wristDrift, c.worst.start, c.worst.end, 'max'),
      obs: (c) => `Dłonie oddalają się od linii środka stopy o ${r0(c.value)}% długości tułowia (granica ${r0(c.limit)}%).`,
      cue: 'Prowadź sztangę po nogach – napnij najszersze, „wciśnij sztangę w siebie”.',
      fix: 'Ciąg z pauzą pod kolanem, ściąganie drążka prostymi rękami na aktywację najszerszych.',
      ok: 'Sztanga prowadzona blisko nóg',
    },
    hip_rise: {
      title: 'Ruch typu „dzień dobry” – biodra wstają za szybko',
      joints: [...HIPS, J.lSh, J.rSh],
      strong: 7,
      frame: hipRiseFrame,
      obs: (c) => `W pierwszej fazie podnoszenia tułów pochyla się o kolejne ${r0(c.value)}° (granica ${r0(c.limit)}°) – kolana prostują się, zanim ruszy tułów.`,
      cue: 'Biodra wstają za szybko, prostujesz kolana, zanim ruszy tułów. Pociągnij sztangę bliżej piszczeli i odepchnij podłogę nogami.',
      fix: 'Ciąg z pauzą tuż nad podłogą, niższe ustawienie bioder na starcie, wzmocnienie czworogłowych; zmniejsz ciężar.',
      ok: 'Biodra i barki ruszają razem',
    },
    back: {
      title: 'Możliwe zaokrąglanie pleców („koci grzbiet”)',
      joints: BACK,
      strong: 6,
      frame: backFrame,
      obs: (c) => BACK_OBS(c, 'pod obciążeniem'),
      cue: 'Plecy tracą napięcie. Przed ruszeniem wdech w brzuch, klatka do przodu, napnij najszersze – „złam sztangę”.',
      fix: 'Mniejszy ciężar, ciąg z podwyższenia, rumuński martwy ciąg, nauka napięcia brzucha (bracing).',
      ok: 'Brak oznak zaokrąglania pleców',
    },
  },
  pushup: {
    depth: {
      title: 'Niepełny zakres ruchu',
      joints: [J.lEl, J.rEl],
      strong: 15,
      obs: (c) => `Łokieć zgina się najwyżej do ${r0(c.value)}° (granica ${r0(c.limit)}°; mniej = głębiej).`,
      cue: 'Schodź niżej – klatka tuż nad podłogą, łokcie do około 90°.',
      fix: 'Pompki na podwyższeniu albo negatywy (3 s w dół) w pełnym zakresie zamiast płytkich na podłodze.',
      ok: 'Pełny zakres ruchu',
    },
    body_line: {
      title: (c) => (sag(c) >= 0 ? 'Biodra opadają – utrata linii ciała' : 'Biodra za wysoko'),
      joints: HIPS,
      strong: 8,
      frame: (c) => argIn(c.s.bodyLine, c.worst.start, c.worst.end, 'max', true),
      obs: (c) => `Linia bark–biodro–kostka odchyla się od prostej o ${r0(c.value)}° (granica ${r0(c.limit)}°) – biodra ${sag(c) >= 0 ? 'opadają' : 'są uniesione'}.`,
      cue: (c) =>
        sag(c) >= 0
          ? 'Biodra opadają. Napnij brzuch i pośladki – ciało jak deska od barków do pięt.'
          : 'Biodra uciekają w górę. Opuść je do linii barki–pięty i napnij brzuch.',
      fix: 'Deska (plank), pompki na podwyższeniu z prostą linią ciała, krótsze serie.',
      ok: 'Prosta linia ciała',
    },
  },
  press: {
    wrist_asym: {
      title: 'Asymetria pracy ramion',
      joints: [J.lWr, J.rWr, J.lEl, J.rEl],
      strong: 8,
      frame: (c) => argIn(c.s.wristDy, c.worst.bottom, c.worst.end, 'max', true),
      obs: (c) => `${leftLags(c) ? 'Lewa' : 'Prawa'} dłoń zostaje niżej – różnica wysokości do ${r0(c.value)}% szerokości barków (granica ${r0(c.limit)}%).`,
      cue: (c) =>
        `${leftLags(c) ? 'Prawa' : 'Lewa'} strona pracuje szybciej. Zredukuj ciężar lub skup się na aktywacji ${leftLags(c) ? 'lewego' : 'prawego'} ramienia – wyciskaj synchronicznie.`,
      fix: 'Wyciskanie hantli jednorącz, zaczynając od słabszej strony; tempo 2 s w górę, kontrola w lustrze.',
      ok: 'Ręce pracują równo',
    },
    lockout: {
      title: 'Niepełny wyprost łokci',
      joints: [J.lEl, J.rEl],
      strong: 12,
      frame: (c) => argIn(c.sig, c.worst.bottom, c.worst.end, 'max'),
      obs: (c) => `Na górze łokcie prostują się tylko do ${r0(c.value)}° (granica ${r0(c.limit)}°).`,
      cue: 'Dociśnij do końca – łokcie proste, głowa „w okno” między ramionami.',
      fix: 'Mobilność barków i odcinka piersiowego, wyciskanie z pauzą na górze, mniejszy ciężar.',
      ok: 'Pełny wyprost na górze',
    },
    lean: {
      title: 'Odchylanie tułowia (przeprost w lędźwiach)',
      joints: BACK,
      strong: 8,
      frame: (c) => argIn(c.s.trunk, c.worst.start, c.worst.end, 'max'),
      obs: (c) => `Tułów odchyla się do ${r0(c.value)}° od pionu (granica ${r0(c.limit)}°).`,
      cue: 'Nie odchylaj się. Napnij pośladki i brzuch, żebra w dół – wyciskaj pionowo nad głowę.',
      fix: 'Wyciskanie w półklęku lub siedząc, wzmocnienie mięśni brzucha, mniejszy ciężar.',
      ok: 'Tułów stabilny, bez odchylania',
    },
  },
}

function sag(c: Ctx) {
  const v = avgIn(c.s.hipSag, c.worst.start, c.worst.end)
  return fin(v) ? v : 0
}
function leftLags(c: Ctx) {
  return avgIn(c.s.wristDy, c.worst.bottom, c.worst.end) > 0
}

const repsText = (hit: number[], total: number) =>
  total === 1 ? 'w tym powtórzeniu' : hit.length === total ? 'we wszystkich powtórzeniach' : `powt. ${ranges(hit)}`

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

export function coach(tr: Track, ex: ExerciseKey, res: { reps: Rep[]; series: Series; signal: number[] }, th: Thresholds = {}): Coaching {
  const profile = PROFILES[ex]
  const { reps, series: s, signal: sig } = res
  const findings: Finding[] = []
  const good: string[] = []
  const unmeasured: FlagDef[] = []
  if (!reps.length) return { headline: 'Nie wykryto powtórzeń – nie ma czego oceniać.', findings, good, notes: [] }

  for (const f of profile.flags) {
    const e = ENTRIES[ex][f.key]
    if (!e) continue
    const limit = thresholdFor(th, ex, f)
    const vals = reps.map((r) => r.metrics[f.metric])
    if (vals.every((v) => v == null)) {
      unmeasured.push(f)
      continue
    }
    const over = (v: number) => (f.op === '<' ? limit - v : v - limit)
    const hit = vals.flatMap((v, i) => (v != null && over(v) > 0 ? [i] : []))
    if (!hit.length) {
      good.push(e.ok)
      continue
    }
    const wi = hit.reduce((a, b) => (over(vals[b]!) > over(vals[a]!) ? b : a))
    const c: Ctx = { tr, s, sig, reps, hit, worst: reps[wi], value: vals[wi]!, limit }
    const big = over(c.value) >= e.strong || (hit.length === reps.length && reps.length >= 3)
    const severity: Severity = e.severity ?? (e.mild ? (big ? 'medium' : 'low') : big ? 'high' : 'medium')
    const pick = <T>(x: T | ((c: Ctx) => T)) => (typeof x === 'function' ? (x as (c: Ctx) => T)(c) : x)
    findings.push({
      key: f.key,
      title: pick(e.title),
      short: f.label,
      severity,
      obs: e.obs(c),
      cue: pick(e.cue),
      fix: e.fix,
      reps: hit.map((i) => i + 1),
      repsText: repsText(
        hit.map((i) => i + 1),
        reps.length,
      ),
      frame: e.frame ? e.frame(c) : c.worst.bottom,
      joints: e.joints,
    })
  }

  // ----- Przebieg serii: zmęczenie widać po prędkości i zakresie -----
  if (reps.length >= 4) {
    const k = reps.length >= 6 ? 2 : 1
    const first = (key: string) => mean(reps.slice(0, k).map((r) => r.metrics[key] ?? NaN))
    const last = (key: string) => mean(reps.slice(-k).map((r) => r.metrics[key] ?? NaN))
    const lastNums = Array.from({ length: k }, (_, i) => reps.length - k + i + 1)
    const [c0, c1] = [first('con'), last('con')]
    if (fin(c0) && fin(c1) && c1 >= c0 * 1.4 && c1 - c0 >= 0.3) {
      findings.push({
        key: 'slowdown',
        title: 'Wyraźny spadek prędkości w końcówce serii',
        short: 'spadek prędkości',
        severity: c1 >= c0 * 1.8 ? 'medium' : 'low',
        obs: `Faza ${profile.phases[1]} wydłuża się z ${c0.toFixed(1).replace('.', ',')} s na początku do ${c1.toFixed(1).replace('.', ',')} s na końcu serii.`,
        cue: 'Ostatnie powtórzenia są dużo wolniejsze – seria była blisko granicy. Zostaw 1–2 powtórzenia w zapasie.',
        fix: 'Jeśli celem jest technika lub siła, skróć serię albo zmniejsz ciężar; błędy techniczne zwykle pojawiają się właśnie w wolnych powtórzeniach.',
        reps: lastNums,
        repsText: `powt. ${ranges(lastNums)}`,
        frame: reps.at(-1)!.bottom,
        joints: [],
      })
    }
    const dk = ex === 'squat' ? 'depth_knee' : ex === 'pushup' || ex === 'press' ? 'elbow_bottom' : null
    if (dk) {
      const [d0, d1] = [first(dk), last(dk)]
      if (fin(d0) && fin(d1) && d1 - d0 >= 10 && !findings.some((f) => f.key === 'depth' && f.reps.length === reps.length)) {
        findings.push({
          key: 'range_drift',
          title: 'Zakres ruchu skraca się w trakcie serii',
          short: 'coraz płytsze powtórzenia',
          severity: 'medium',
          obs: `Kąt w dole rośnie z ${r0(d0)}° na początku do ${r0(d1)}° w ostatnich powtórzeniach (mniej = głębiej).`,
          cue: 'Każde powtórzenie do tej samej głębokości – ostatnie są wyraźnie płytsze.',
          fix: 'Punkt odniesienia głębokości (skrzynia, piłka), krótsza seria albo mniejszy ciężar.',
          reps: lastNums,
          repsText: `powt. ${ranges(lastNums)}`,
          frame: reps.at(-1)!.bottom,
          joints: [],
        })
      }
    }
  }

  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.reps.length - a.reps.length)

  // ----- Czego nie widać z tego ujęcia -----
  const notes: string[] = []
  const need = (v: View) => unmeasured.filter((f) => profile.metrics.find((m) => m.key === f.metric)?.views.includes(v))
  const side = need('side')
  const front = need('front').filter((f) => !side.includes(f))
  const names = (fs: FlagDef[]) => fs.map((f) => profile.metrics.find((m) => m.key === f.metric)?.short ?? f.label).join(', ')
  if (side.length) notes.push(`Z tego ujęcia nie da się ocenić: ${names(side)}. Nagraj dodatkowo z boku.`)
  if (front.length) notes.push(`Z tego ujęcia nie da się ocenić: ${names(front)}. Nagraj dodatkowo z przodu.`)
  if (profile.beta) notes.push(`${profile.name}: analiza w wersji beta – traktuj wskazania ostrożniej.`)

  const main = findings.filter((f) => f.severity !== 'low')
  const headline = !findings.length
    ? 'Bez zastrzeżeń w tym, co widać z tego ujęcia.'
    : !main.length
      ? 'Technika dobra – tylko drobne uwagi.'
      : main.length === 1
        ? `Jedna rzecz do poprawy: ${lower(main[0].title)}.`
        : `Do poprawy: ${main.length} rzeczy. Zacznij od: ${lower(main[0].title)}.`
  return { headline, findings, good, notes }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** Najważniejsza uwaga dotycząca danego powtórzenia (numer od 1) – na podgląd na żywo. */
export function repCue(c: Coaching, rep: number): Finding | null {
  return c.findings.find((f) => f.reps.includes(rep) && f.key !== 'slowdown' && f.key !== 'range_drift') ?? null
}
