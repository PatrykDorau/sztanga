// Generator planu z reguł – bez AI i bez kosztów. Te same zasady co dobry szablon trenerski:
//  podział wg liczby treningów (FBW / góra–dół / push–pull–nogi), sloty wzorców ruchu,
//  dawki wg celu i poziomu, progresja tydzień po tygodniu, deload w ostatnim tygodniu (≥ 4 tyg.).
// Ćwiczenia: tylko z bazy, pasujące do sprzętu, bez przeciwwskazań klienta, nie trudniejsze niż poziom;
// najpierw te, których trenerka już używa w swoich planach, potem własne i z filmem.
import { supabase } from '@/lib/supabase'
import type { PlanRequest } from '@/lib/ai'

export interface RuleExercise {
  id: string
  name_pl: string
  name_en?: string | null
  movement_pattern: string | null
  muscle_groups: string[]
  equipment: string[]
  level: 'beginner' | 'intermediate' | 'advanced'
  contraindications: string[]
  source: string
  video_path: string | null
}
export interface PlanDraft {
  name: string
  description: string
  weeks: {
    phase: string | null
    notes: string | null
    workouts: {
      name: string
      notes: string | null
      exercises: { exercise_id: string; group: string | null; sets: number; reps: string; load: string | null; tempo: string | null; rest_sec: number | null; rpe: number | null; notes: string | null }[]
    }[]
  }[]
}

type Goal = 'strength' | 'hypertrophy' | 'fat_loss' | 'rehab' | 'general'
export function detectGoal(text: string): Goal {
  const t = text.toLowerCase()
  if (/kontuz|powr[oó]t|rehab|b[oó]l|uraz|po operac/.test(t)) return 'rehab'
  if (/si[lł][aey]|si[lł]ow|strength|1rm|trój|tr[oó]jb/.test(t)) return 'strength'
  if (/redukc|schud|spal|kondycj|wydolno|odchudz|tłuszcz|tluszcz/.test(t)) return 'fat_loss'
  if (/mas[aęy]|hipertrof|mi[eę]śn|sylwetk|pośladk|posladk/.test(t)) return 'hypertrophy'
  return 'general'
}

// ---------- Sloty ----------
interface Slot {
  role: 'main' | 'acc' | 'core'
  patterns?: string[]
  muscles?: string[] // pierwsza grupa mięśniowa ćwiczenia (główna)
}
const S = (role: Slot['role'], patterns?: string[], muscles?: string[]): Slot => ({ role, patterns, muscles })
const DAY_TYPES: Record<string, { name: string; slots: Slot[] }> = {
  fbA: { name: 'Całe ciało', slots: [S('main', ['squat']), S('main', ['push_h']), S('main', ['hinge']), S('main', ['pull_h', 'pull_v']), S('acc', ['lunge']), S('acc', ['push_v']), S('core', ['core'])] },
  fbB: { name: 'Całe ciało', slots: [S('main', ['hinge']), S('main', ['pull_v', 'pull_h']), S('main', ['lunge', 'squat']), S('main', ['push_v', 'push_h']), S('acc', undefined, ['glutes', 'hamstrings']), S('acc', ['pull_h']), S('core', ['core'])] },
  fbC: { name: 'Całe ciało', slots: [S('main', ['squat', 'lunge']), S('main', ['pull_h']), S('main', ['push_h']), S('acc', ['hinge']), S('acc', undefined, ['shoulders']), S('acc', undefined, ['biceps', 'triceps']), S('core', ['core'])] },
  upper: { name: 'Góra', slots: [S('main', ['push_h']), S('main', ['pull_v', 'pull_h']), S('main', ['push_v']), S('acc', ['pull_h']), S('acc', undefined, ['shoulders']), S('acc', undefined, ['triceps', 'biceps']), S('core', ['core'])] },
  lower: { name: 'Dół', slots: [S('main', ['squat']), S('main', ['hinge']), S('acc', ['lunge']), S('acc', undefined, ['hamstrings']), S('acc', undefined, ['glutes']), S('acc', undefined, ['calves']), S('core', ['core'])] },
  push: { name: 'Pchanie', slots: [S('main', ['push_h']), S('main', ['push_v']), S('acc', ['push_h']), S('acc', undefined, ['shoulders']), S('acc', undefined, ['triceps']), S('acc', undefined, ['chest']), S('core', ['core'])] },
  pull: { name: 'Przyciąganie', slots: [S('main', ['pull_v']), S('main', ['pull_h']), S('acc', ['hinge']), S('acc', undefined, ['middle back', 'traps']), S('acc', undefined, ['biceps']), S('acc', undefined, ['lats']), S('core', ['core'])] },
}
const SPLITS: Record<number, string[]> = {
  1: ['fbA'],
  2: ['fbA', 'fbB'],
  3: ['fbA', 'fbB', 'fbC'],
  4: ['upper', 'lower', 'upper', 'lower'],
  5: ['upper', 'lower', 'push', 'pull', 'lower'],
  6: ['push', 'pull', 'lower', 'push', 'pull', 'lower'],
}

// ---------- Dawki ----------
interface Dose {
  sets: number
  reps: string
  rest: number
  rpe: number
  tempo: string | null
}
const DOSES: Record<Goal, Record<Slot['role'], Dose>> = {
  strength: { main: { sets: 4, reps: '5', rest: 150, rpe: 7, tempo: null }, acc: { sets: 3, reps: '8-10', rest: 90, rpe: 7, tempo: null }, core: { sets: 3, reps: '30 s', rest: 60, rpe: 7, tempo: null } },
  hypertrophy: { main: { sets: 3, reps: '8-10', rest: 120, rpe: 7, tempo: '3-0-1-0' }, acc: { sets: 3, reps: '10-12', rest: 75, rpe: 7.5, tempo: null }, core: { sets: 3, reps: '12', rest: 45, rpe: 7, tempo: null } },
  fat_loss: { main: { sets: 3, reps: '12', rest: 60, rpe: 7, tempo: null }, acc: { sets: 3, reps: '15', rest: 45, rpe: 7, tempo: null }, core: { sets: 3, reps: '40 s', rest: 30, rpe: 7, tempo: null } },
  rehab: { main: { sets: 3, reps: '10-12', rest: 90, rpe: 6, tempo: '3-1-1-0' }, acc: { sets: 2, reps: '12-15', rest: 60, rpe: 6, tempo: '2-1-1-0' }, core: { sets: 3, reps: '30 s', rest: 45, rpe: 6, tempo: null } },
  general: { main: { sets: 3, reps: '8-10', rest: 90, rpe: 7, tempo: null }, acc: { sets: 3, reps: '12', rest: 60, rpe: 7, tempo: null }, core: { sets: 3, reps: '30 s', rest: 45, rpe: 7, tempo: null } },
}
const GOAL_PHASE: Record<Goal, string> = { strength: 'strength', hypertrophy: 'hypertrophy', fat_loss: 'conditioning', rehab: 'adaptation', general: 'adaptation' }
const GOAL_NAME: Record<Goal, string> = { strength: 'Siła', hypertrophy: 'Hipertrofia', fat_loss: 'Redukcja i kondycja', rehab: 'Powrót do formy', general: 'Ogólny rozwój' }
const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 }
// Kontrola importu: wzorzec ruchu musi pasować do głównej grupy mięśni (np. "brzuszki" oznaczone jako wyciskanie nad głowę odpadają).
const PATTERN_MUSCLES: Record<string, string[]> = {
  squat: ['quadriceps', 'glutes'],
  lunge: ['quadriceps', 'glutes', 'hamstrings'],
  hinge: ['hamstrings', 'glutes', 'lower back'],
  push_h: ['chest', 'triceps', 'shoulders'],
  push_v: ['shoulders', 'triceps'],
  pull_h: ['middle back', 'lats', 'biceps', 'traps'],
  pull_v: ['lats', 'biceps', 'middle back'],
  core: ['abdominals', 'lower back', 'obliques'],
}
// Klasyka: sprawdzone ćwiczenia bazowe mają pierwszeństwo przed egzotycznymi wariantami z importu (nazwy angielskie z bazy).
const STAPLES = new Set(
  `barbell squat|barbell full squat|front barbell squat|goblet squat|dumbbell squat|bodyweight squat|leg press|hack squat|
barbell deadlift|romanian deadlift|stiff-legged barbell deadlift|stiff-legged dumbbell deadlift|sumo deadlift|trap bar deadlift|barbell glute bridge|barbell hip thrust|butt lift (bridge)|single leg glute bridge|hyperextensions (back extensions)|pull through|
barbell bench press - medium grip|dumbbell bench press|incline dumbbell press|barbell incline bench press - medium grip|pushups|push-ups with feet elevated|incline push-up|dips - chest version|machine bench press|dumbbell flyes|close-grip barbell bench press|
standing military press|barbell shoulder press|dumbbell shoulder press|seated dumbbell press|standing dumbbell press|machine shoulder (military) press|side lateral raise|face pull|reverse flyes|
bent over barbell row|one-arm dumbbell row|bent over two-dumbbell row|seated cable rows|inverted row|dumbbell incline row|
pullups|chin-up|wide-grip lat pulldown|close-grip front lat pulldown|band assisted pull-up|
dumbbell lunges|barbell lunge|dumbbell rear lunge|split squat with dumbbells|split squats|dumbbell step ups|bodyweight walking lunge|barbell walking lunge|
plank|side bridge|dead bug|crunches|reverse crunch|hanging leg raise|pallof press|russian twist|mountain climbers|
dumbbell bicep curl|barbell curl|hammer curls|triceps pushdown|triceps pushdown - rope attachment|lying leg curls|seated leg curl|leg extensions|standing calf raises|seated calf raise|one-arm kettlebell swings`
    .split('|')
    .map((s) => s.trim()),
)
const FREE_WEIGHTS = ['barbell', 'dumbbell', 'kettlebells']
// Warianty specjalistyczne – nie do planu z automatu (zwłaszcza dla początkujących).
const SPECIAL = /łańcuch|z gum|odciążeniem|z bloków|z podpór|z deską|trójbojow|samochodu|kłody|beczki|opon|sań|saniami|jarzm|rikszą|Atlasa|grubym gryfem|Conana|zarzut|rwani|podrzut|wybicie|with (bands|chains)/i
const fitsPattern = (e: RuleExercise) => !e.movement_pattern || !PATTERN_MUSCLES[e.movement_pattern] || PATTERN_MUSCLES[e.movement_pattern].includes(e.muscle_groups[0])

/** Deterministyczny „los” (ten sam klient i data → ten sam plan; inny klient → inny dobór przy remisie). */
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

export function buildRulePlan(req: PlanRequest, exercises: RuleExercise[], usage: Map<string, number>, seed = '', group: string | null = null): PlanDraft {
  // Dzieci: zawsze dawki ogólnorozwojowe (więcej powtórzeń, umiarkowany wysiłek), bez pracy siłowej na niskich powtórzeniach.
  const child = group === 'child'
  const goal: Goal = child ? 'general' : detectGoal(req.goal)
  const equipment = new Set([...req.equipment, 'body only'])
  const limits = new Set(req.limitations)
  const maxLevel = LEVEL_RANK[req.level]
  const pool = exercises.filter(
    (e) =>
      e.equipment.every((q) => equipment.has(q)) &&
      !e.contraindications.some((c) => limits.has(c)) &&
      fitsPattern(e) &&
      LEVEL_RANK[e.level] <= maxLevel &&
      !['mobility', 'cardio', 'other'].includes(e.movement_pattern ?? '') &&
      !(e.movement_pattern === 'plyo' && (goal === 'rehab' || limits.size)),
  )
  // Sprzęt: gdy klient ma coś więcej niż masę ciała, ćwiczenia z tym sprzętem idą przed ćwiczeniami bez obciążenia;
  // ćwiczenia główne – najlepiej wolne ciężary i ruchy wielostawowe; warianty specjalistyczne (łańcuchy, gumy, strongman) na koniec.
  const hasGear = [...equipment].some((q) => q !== 'body only')
  const gear = (e: RuleExercise, role: Slot['role']) => {
    const uses = e.equipment.filter((q) => q !== 'body only')
    if (!uses.length) return hasGear && role !== 'core' ? -4 : 0
    const any = (list: string[]) => uses.some((q) => list.includes(q))
    let s = 3
    if (role === 'main') s += any(FREE_WEIGHTS) ? 4 : any(['machine', 'cable']) ? 1 : -2
    else if (role === 'acc') s += any(['dumbbell', 'cable', 'machine', 'kettlebells', 'e-z curl bar']) ? 2 : 0
    if (uses.includes('other') || (role === 'main' && uses.includes('bands'))) s -= 3
    return s
  }
  const compound = (e: RuleExercise, role: Slot['role']) => (role !== 'main' ? 0 : e.muscle_groups.length >= 3 ? 3 : e.muscle_groups.length === 2 ? 1.5 : -2)
  const score = (e: RuleExercise, role: Slot['role']) =>
    (usage.get(e.id) ?? 0) * 5 +
    (e.source === 'own' ? 3 : 0) +
    (e.video_path ? 2 : 0) +
    (LEVEL_RANK[e.level] === maxLevel ? 2 : 1) +
    gear(e, role) +
    compound(e, role) +
    (SPECIAL.test(e.name_pl) ? (req.level === 'advanced' ? -2 : -6) : 0) +
    (STAPLES.has((e.name_en ?? '').toLowerCase()) ? (role === 'main' ? 8 : 4) : 0) +
    hash(seed + e.id)
  const candidates = (slot: Slot) =>
    pool
      // Slot wzorca: ten wzorzec ruchu; slot mięśnia: główna grupa mięśniowa ćwiczenia (bez core i plyometrii).
      .filter((e) =>
        slot.patterns ? slot.patterns.includes(e.movement_pattern ?? '') : slot.muscles!.includes(e.muscle_groups[0]) && !['core', 'plyo'].includes(e.movement_pattern ?? ''),
      )
      .sort((a, b) => score(b, slot.role) - score(a, slot.role))

  const days = Math.max(1, Math.min(6, Math.round(req.days)))
  const weeks = Math.max(1, Math.min(8, Math.round(req.weeks)))
  const perWorkout = !req.minutes ? 6 : req.minutes <= 40 ? 4 : req.minutes <= 60 ? 6 : 7
  const split = SPLITS[days]
  const letters = 'ABCDEF'

  // Dobór ćwiczeń raz (tydzień 1) i powtarzanie w kolejnych tygodniach – progresja na tych samych ćwiczeniach.
  const usedInPlan = new Map<string, number>() // ile razy ćwiczenie już wybrano (rotacja między treningami)
  const typeCount = new Map<string, number>()
  const chosen = split.map((type, di) => {
    const t = DAY_TYPES[type]
    const nth = (typeCount.get(type) ?? 0) + 1
    typeCount.set(type, nth)
    const sameTypeTotal = split.filter((x) => x === type).length
    const name = `Trening ${letters[di]} – ${t.name.toLowerCase()}${sameTypeTotal > 1 && !type.startsWith('fb') ? ` ${nth}` : ''}`
    const inWorkout = new Set<string>()
    const picks: { ex: RuleExercise; role: Slot['role'] }[] = []
    // Najpierw główne, potem akcesoryjne, core zawsze na końcu; przy krótkim treningu odpadają akcesoryjne.
    const slots = [...t.slots.filter((s) => s.role !== 'core').slice(0, perWorkout - 1), ...t.slots.filter((s) => s.role === 'core')]
    for (const slot of slots) {
      const list = candidates(slot).filter((e) => !inWorkout.has(e.id))
      if (!list.length) continue
      // Rotacja: wśród 4 najlepszych bierzemy najrzadziej dotąd użyte (różne ćwiczenia w A, B, C).
      const pick = list.slice(0, 4).sort((a, b) => (usedInPlan.get(a.id) ?? 0) - (usedInPlan.get(b.id) ?? 0))[0]
      inWorkout.add(pick.id)
      usedInPlan.set(pick.id, (usedInPlan.get(pick.id) ?? 0) + 1)
      picks.push({ ex: pick, role: slot.role })
    }
    return { name, picks }
  })
  if (!chosen.some((w) => w.picks.length >= 3)) throw new Error('Za mało ćwiczeń w bazie pasujących do sprzętu, poziomu i ograniczeń.')

  const plan: PlanDraft = {
    name: `${GOAL_NAME[goal]} – ${days}× w tygodniu, ${weeks} tyg.`,
    description: `Plan z reguł: ${req.goal.trim()}. ${days === 4 || days === 5 ? 'Podział góra–dół' : days === 6 ? 'Podział pchanie–przyciąganie–nogi' : 'Trening całego ciała'}, progresja serii i RPE${weeks >= 4 ? ', lżejszy ostatni tydzień' : ''}.`,
    weeks: [],
  }
  for (let w = 0; w < weeks; w++) {
    const deload = weeks >= 4 && w === weeks - 1
    plan.weeks.push({
      phase: deload ? 'deload' : GOAL_PHASE[goal],
      notes: deload ? 'Tydzień lżejszy: mniej serii, RPE 6.' : w > 0 ? `Progresja względem tygodnia ${w}: +1 seria w głównych lub wyższe RPE.` : null,
      workouts: chosen.map((c) => ({
        name: c.name,
        notes: null,
        exercises: c.picks.map(({ ex, role }, i) => {
          const accIdx = c.picks.slice(0, i).filter((p) => p.role === 'acc').length
          const d = DOSES[goal][role]
          const step = Math.min(w, 2)
          const sets = deload ? Math.max(2, d.sets - 1) : Math.min(role === 'main' ? 5 : 4, d.sets + (role === 'main' && step >= 1 ? 1 : 0))
          const rpe = deload || child ? 6 : Math.min(9, d.rpe + 0.5 * step)
          // Przy redukcji akcesoryjne w superseriach parami (A1/A2, B1/B2).
          const group = goal === 'fat_loss' && role === 'acc' ? letters[Math.floor(accIdx / 2)] : null
          return { exercise_id: ex.id, group, sets: child ? Math.min(sets, 3) : sets, reps: child && role !== 'core' ? '10-12' : d.reps, load: `RPE ${String(rpe).replace('.', ',')}`, tempo: d.tempo, rest_sec: d.rest, rpe, notes: null }
        }),
      })),
    })
  }
  return plan
}

/** Ćwiczenia z bazy i to, jak często trenerka ich używa w planach (ranking). */
export async function loadRuleData() {
  const [ex, we] = await Promise.all([
    supabase.from('exercises').select('id, name_pl, name_en, movement_pattern, muscle_groups, equipment, level, contraindications, source, video_path'),
    supabase.from('workout_exercises').select('exercise_id').limit(10000),
  ])
  if (ex.error) throw ex.error
  const usage = new Map<string, number>()
  for (const r of we.data ?? []) usage.set(r.exercise_id, (usage.get(r.exercise_id) ?? 0) + 1)
  return { exercises: ex.data as RuleExercise[], usage }
}

/** Zapis szkicu (status draft) – tymi samymi tabelami co kreator. */
export async function savePlanDraft(plan: PlanDraft, clientId: string | null): Promise<string> {
  const ok = <T>(r: { data: T; error: unknown }) => {
    if (r.error) throw r.error
    return r.data
  }
  const prog = ok(await supabase.from('programs').insert({ name: plan.name, description: plan.description, client_id: clientId, is_template: !clientId, status: 'draft' }).select('id').single()) as { id: string }
  try {
    for (const [wi, w] of plan.weeks.entries()) {
      const wk = ok(await supabase.from('program_weeks').insert({ program_id: prog.id, position: wi, phase: w.phase, notes: w.notes }).select('id').single()) as { id: string }
      for (const [oi, wo] of w.workouts.entries()) {
        const wkt = ok(await supabase.from('workouts').insert({ week_id: wk.id, position: oi, name: wo.name, notes: wo.notes }).select('id').single()) as { id: string }
        if (wo.exercises.length)
          ok(
            await supabase.from('workout_exercises').insert(
              wo.exercises.map((e, i) => ({ workout_id: wkt.id, exercise_id: e.exercise_id, position: i, group_label: e.group, sets: e.sets, reps: e.reps, load: e.load, tempo: e.tempo, rest_sec: e.rest_sec, rpe: e.rpe, notes: e.notes })),
            ),
          )
      }
    }
  } catch (e) {
    await supabase.from('programs').delete().eq('id', prog.id)
    throw e
  }
  return prog.id
}
