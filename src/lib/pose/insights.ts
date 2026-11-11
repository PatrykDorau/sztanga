// Wnioski z heatmapy: odchylenia od wzorca (w stopniach, % albo sekundach) zamienione na zdania dla trenerki –
// co oznacza różnica i co z nią zrobić. Pokazujemy tylko pomiary wyraźnie poza rozrzutem wzorca (|z| ≥ 1).
import { fmtMetric, PROFILES, type ExerciseKey, type MetricDef } from './profiles'
import type { HeatCell } from './heat'

interface Side {
  text: string // co znaczy ta różnica
  tip?: string // co z tym zrobić
  ok?: boolean // kierunek zwykle korzystny / neutralny
}
type Rule = { more?: Side; less?: Side }

const BACK: Rule = {
  more: { text: 'tułów skraca się bardziej niż u wzorca – możliwe zaokrąglanie pleców', tip: 'Zakres tylko do momentu neutralnych pleców, oddech i napięcie brzucha przed zejściem; obejrzyj nagranie z boku.' },
  less: { text: 'plecy stabilniejsze niż u wzorca', ok: true },
}
const TEMPO: Record<string, Rule> = {
  ecc: { less: { text: 'szybsze opuszczanie niż wzorzec', tip: 'Jeśli zależy Ci na kontroli – tempo 3 s w dół, metronom.' }, more: { text: 'wolniejsze opuszczanie niż wzorzec', ok: true } },
  pause: { more: { text: 'dłuższa pauza w punkcie zwrotnym', ok: true }, less: { text: 'krótsza pauza / odbicie w punkcie zwrotnym', tip: 'Jeśli ma być pauza – policz „raz” w dole.' } },
  con: { more: { text: 'wolniejsza faza z wysiłkiem – ciężar blisko możliwości albo zmęczenie', tip: 'Sprawdź, czy tempo spada w ostatnich powtórzeniach; ewentualnie mniejszy ciężar.' }, less: { text: 'szybsza faza z wysiłkiem niż wzorzec', ok: true } },
}

const RULES: Partial<Record<ExerciseKey, Record<string, Rule>>> = {
  squat: {
    depth_knee: {
      more: { text: 'płytszy przysiad niż wzorzec', tip: 'Mobilność stawu skokowego i bioder, goblet squat, przysiad z pauzą w dole albo do skrzyni.' },
      less: { text: 'głębszy przysiad niż wzorzec', tip: 'Dobrze, o ile plecy zostają neutralne w dole (kolumna „plecy”).', ok: true },
    },
    depth_hip: {
      more: { text: 'mniejsze zgięcie w biodrze – mniej siadania w tył', tip: 'Wskazówka „biodra w tył i w dół”, przysiad do skrzyni.' },
      less: { text: 'mocniej zgięte biodro – siada bardziej w tył', tip: 'Jeśli przy tym duże pochylenie tułowia, często brakuje zgięcia w kostce.' },
    },
    trunk: {
      more: { text: 'bardziej pochylony tułów w dole', tip: 'Często ograniczona mobilność kostek albo słabsze czworogłowe – przysiad przedni / goblet, podkładka pod pięty.' },
      less: { text: 'bardziej wyprostowany tułów', ok: true },
    },
    valgus: {
      less: { text: 'kolana schodzą do środka bardziej niż u wzorca', tip: 'Wskazówka „kolana nad palce”, mini-guma nad kolanami, pośladek średni, wolniejsze opuszczanie.' },
      more: { text: 'kolana szerzej niż u wzorca', ok: true },
    },
    asym: {
      more: { text: 'większa różnica między lewym a prawym kolanem', tip: 'Ćwiczenia jednonóż (bułgarski, wykroki), mobilność słabszej strony; zapytaj o urazy.' },
      less: { text: 'bardziej symetrycznie niż wzorzec', ok: true },
    },
    shift: {
      more: { text: 'biodra uciekają w bok', tip: 'Kompensacja jednej strony – ćwiczenia jednonóż, mobilność biodra, lżejszy ciężar z lustrem.' },
      less: { text: 'biodra stabilniej w osi niż u wzorca', ok: true },
    },
    hip_rise: {
      more: { text: 'biodra wstają szybciej niż barki („good morning”)', tip: 'Często słabsze czworogłowe – przysiad z pauzą, przedni, wskazówka „klatka w górę razem z biodrami”.' },
      less: { text: 'biodra i barki wstają razem', ok: true },
    },
    back: BACK,
    heel_lift: {
      more: { text: 'pięty odrywają się bardziej niż u wzorca', tip: 'Mobilność stawu skokowego, podkładka pod pięty, ciężar na całej stopie.' },
      less: { text: 'pięty stabilniej na podłodze', ok: true },
    },
  },
  deadlift: {
    hip_bottom: {
      more: { text: 'mniejszy zawias w biodrze w dole', tip: 'Przy RDL zwykle za mały zakres – „biodra w tył”, aż poczujesz rozciąganie z tyłu ud.' },
      less: { text: 'głębszy zawias w biodrze', tip: 'OK, jeśli plecy zostają neutralne (kolumna „plecy”).', ok: true },
    },
    knee_bottom: {
      less: { text: 'bardziej ugięte kolana – ruch bliżej przysiadu', tip: 'W RDL kolana tylko lekko ugięte; „biodra w tył, nie w dół”.' },
      more: { text: 'prostsze kolana niż wzorzec', tip: 'Mocniejsze rozciąganie tyłu ud – uważaj na plecy przy słabszej mobilności.' },
    },
    trunk: {
      more: { text: 'bardziej pochylony tułów w dole', ok: true },
      less: { text: 'mniej pochylony tułów – mniejszy zakres zawiasu', tip: 'Jeśli to RDL – dłuższa droga biodrami w tył.' },
    },
    lockout: {
      less: { text: 'niepełny wyprost bioder na górze', tip: 'Dokończ ruch pośladkami, bez odchylania w lędźwiach.' },
      more: { text: 'większy wyprost – możliwe odchylanie w lędźwiach na górze', tip: 'Kończ w pionie, żebra w dół, ściśnij pośladki.' },
    },
    bar_drift: {
      more: { text: 'ciężar odchodzi dalej od nóg', tip: 'Prowadź ciężar blisko ud i goleni, „ściśnij pachy” (najszersze).' },
      less: { text: 'ciężar bliżej nóg niż u wzorca', ok: true },
    },
    hip_rise: {
      more: { text: 'biodra ruszają przed barkami', tip: 'Za wysoki start albo słabsze czworogłowe – „pchaj podłogę”, martwy z pauzą nad kolanem.' },
      less: { text: 'biodra i barki ruszają razem', ok: true },
    },
    back: BACK,
  },
  pushup: {
    elbow_bottom: {
      more: { text: 'płytsze pompki niż wzorzec', tip: 'Pełny zakres kosztem trudności – pompki na podwyższeniu, klatka do podłogi.' },
      less: { text: 'głębsze pompki niż wzorzec', ok: true },
    },
    body_line: {
      more: { text: 'linia ciała mniej prosta (biodra opadają albo idą w górę)', tip: 'Napięcie brzucha i pośladków; deska jako uzupełnienie.' },
      less: { text: 'linia ciała prostsza niż u wzorca', ok: true },
    },
  },
  press: {
    elbow_bottom: {
      more: { text: 'mniejszy zakres w dole', tip: 'Opuszczaj niżej, jeśli barki na to pozwalają.' },
      less: { text: 'większy zakres w dole', ok: true },
    },
    lockout: {
      less: { text: 'niepełny wyprost łokci na górze', tip: 'Dociśnij do końca; jeśli nie daje rady – mniejszy ciężar.' },
      more: { text: 'pełniejszy wyprost niż wzorzec', ok: true },
    },
    wrist_asym: {
      more: { text: 'ręce pracują nierówno', tip: 'Wyciskanie hantlami / jednorącz, słabsza strona pierwsza.' },
      less: { text: 'ręce równiej niż u wzorca', ok: true },
    },
    lean: {
      more: { text: 'większe odchylanie tułowia – kompensacja z lędźwi', tip: 'Napięcie brzucha i pośladków, lżej albo wersja siedząc z oparciem.' },
      less: { text: 'stabilniejszy tułów niż u wzorca', ok: true },
    },
  },
}
// Ćwiczenia z ogólnym profilem (wykrok, wiosłowanie, uginanie…)
const GENERIC: Record<string, Rule> = {
  range: {
    less: { text: 'mniejszy zakres ruchu niż wzorzec', tip: 'Pełny zakres kosztem ciężaru.' },
    more: { text: 'większy zakres ruchu niż wzorzec', ok: true },
  },
  trunk_move: {
    more: { text: 'więcej ruchu tułowiem – możliwe bujanie / pomaganie sobie ciałem', tip: 'Mniejszy ciężar, wolniej, ewentualnie oparcie dla pleców.' },
    less: { text: 'stabilniejszy tułów niż u wzorca', ok: true },
  },
}

export interface Insight {
  key: string
  exercise: string
  metric: string
  diff: string // np. „o 14°”
  text: string
  tip?: string
  ok: boolean
  strong: boolean // |z| ≥ 1,5
  z: number
}

const ruleFor = (ex: ExerciseKey, metric: string): Rule | undefined => RULES[ex]?.[metric] ?? GENERIC[metric] ?? TEMPO[metric]

/** Wnioski dla jednej osoby (komórki z heatmapy), najważniejsze na górze: najpierw do poprawy, potem na plus. */
export function insightsFor(cells: Record<string, HeatCell | undefined>, minZ = 1): Insight[] {
  const out: Insight[] = []
  for (const [key, c] of Object.entries(cells)) {
    if (!c || c.z == null || c.value == null || c.ref == null || Math.abs(c.z) < minZ) continue
    const [ex, metric] = key.split('.') as [ExerciseKey, string]
    const def: MetricDef | undefined = PROFILES[ex]?.metrics.find((m) => m.key === metric)
    const side = ruleFor(ex, metric)?.[c.z > 0 ? 'more' : 'less']
    if (!def || !side) continue
    out.push({
      key,
      exercise: PROFILES[ex].name,
      metric: def.label,
      diff: `${fmtMetric(def, c.value)} vs ${fmtMetric(def, c.ref)} (${c.value > c.ref ? '+' : '−'}${fmtMetric(def, Math.abs(c.value - c.ref))})`,
      text: side.text,
      tip: side.tip,
      ok: !!side.ok,
      strong: Math.abs(c.z) >= 1.5,
      z: c.z,
    })
  }
  return out.sort((a, b) => Number(a.ok) - Number(b.ok) || Math.abs(b.z) - Math.abs(a.z))
}
