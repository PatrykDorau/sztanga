// AI dla trenerki (Claude): generator szkicu planu i asystent nad danymi.
// Wywołuje tylko zalogowana trenerka; dane czytane i zapisywane jej uprawnieniami (RLS), klucz Anthropic zostaje na serwerze.
//   POST { action: 'plan', ...formularz }      → { program_id, warnings }
//   POST { action: 'ask', messages: [...] }    → { answer }
import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'
import { admin, asUser, cors, isTrainer, json } from '../_shared/google.ts'

const MODEL = 'claude-opus-5-5'
// Gdy model odmówi (filtry bezpieczeństwa), API samo ponawia na modelu zapasowym.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as const
// Model wybrany przez trenerkę w Profilu (app_settings). Zapasowy model po stronie serwera tylko przy Opusie.
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const
async function modelFor(db: SupabaseClient, kind: 'assistant' | 'plan') {
  const { data } = await db.from('app_settings').select('model_assistant, model_plan').eq('id', 1).maybeSingle()
  const m = (kind === 'assistant' ? data?.model_assistant : data?.model_plan) as string | undefined
  return (MODELS as readonly string[]).includes(m ?? '') ? (m as string) : kind === 'assistant' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5'
}
const fallbackFor = (model: string) => (model === MODEL ? FALLBACK : {})

// ----- Koszt wywołań (USD za milion tokenów: wejście, wyjście, odczyt z cache, zapis do cache 5 min) -----
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
}
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }
/** Zapis kosztu do ai_usage (licznik kredytów w Profilu). Błąd zapisu nie psuje odpowiedzi. */
function logUsage(action: 'ask' | 'plan' | 'translate', model: string, u: Usage | undefined, actualModel?: string) {
  if (!u) return
  const m = actualModel && PRICES[actualModel] ? actualModel : model
  const [pi, po, pr, pw] = PRICES[m] ?? PRICES['claude-opus-5-5']
  const row = {
    action,
    model: m,
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_tokens: u.cache_read_input_tokens ?? 0,
    cache_write_tokens: u.cache_creation_input_tokens ?? 0,
  }
  const cost = (row.input_tokens * pi + row.output_tokens * po + row.cache_read_tokens * pr + row.cache_write_tokens * pw) / 1e6
  admin().from('ai_usage').insert({ ...row, cost_usd: cost }).then(() => null, () => null)
}

const PHASES = ['adaptation', 'hypertrophy', 'strength', 'power', 'deload', 'peaking', 'conditioning']

function anthropic() {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new HttpError(503, 'Brak klucza ANTHROPIC_API_KEY w sekretach Edge Functions.')
  return new Anthropic({ apiKey })
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function textOf(msg: Anthropic.Beta.BetaMessage) {
  if (msg.stop_reason === 'refusal') throw new HttpError(422, 'Model odmówił odpowiedzi na to zapytanie. Spróbuj sformułować je inaczej.')
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

// ======================================================================
// Generator planu
// ======================================================================
interface PlanInput {
  structure?: boolean
  client_id?: string | null
  goal: string
  level: 'beginner' | 'intermediate' | 'advanced'
  days: number
  weeks: number
  minutes?: number | null
  equipment: string[]
  limitations: string[]
  notes?: string | null
  split?: string | null
  gym_id?: string | null
}
const SPLIT_TEXT: Record<string, string> = {
  fbw: 'FBW – każdy trening na całe ciało',
  upper_lower: 'podział góra / dół (naprzemiennie)',
  push_pull: 'push / pull: dzień pchania (klatka, barki, triceps, czworogłowe) i dzień przyciągania (plecy, biceps, tył uda, pośladki)',
  ppl: 'push / pull / nogi',
  bro: 'split na partie: klatka, plecy, nogi, barki, ręce',
}

const nul = (t: string) => ({ type: [t, 'null'] })
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'weeks'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    weeks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phase', 'notes', 'workouts'],
        properties: {
          phase: { anyOf: [{ type: 'string', enum: PHASES }, { type: 'null' }] },
          notes: nul('string'),
          workouts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'notes', 'exercises'],
              properties: {
                name: { type: 'string' },
                notes: nul('string'),
                exercises: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['code', 'group', 'sets', 'reps', 'load', 'tempo', 'rest_sec', 'rpe', 'notes'],
                    properties: {
                      code: { type: 'string', description: 'Kod ćwiczenia z listy, np. "e42"' },
                      group: nul('string'),
                      sets: { type: 'integer' },
                      reps: { type: 'string' },
                      load: nul('string'),
                      tempo: nul('string'),
                      rest_sec: nul('integer'),
                      rpe: nul('number'),
                      notes: nul('string'),
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const

interface PlanOut {
  name: string
  description: string
  weeks: {
    phase: string | null
    notes: string | null
    workouts: {
      name: string
      notes: string | null
      exercises: { code: string; group: string | null; sets: number; reps: string; load: string | null; tempo: string | null; rest_sec: number | null; rpe: number | null; notes: string | null }[]
    }[]
  }[]
}

async function generatePlan(db: SupabaseClient, input: PlanInput) {
  const model = await modelFor(db, 'plan')
  const days = Math.max(1, Math.min(6, Math.round(input.days || 3)))
  const weeks = Math.max(1, Math.min(8, Math.round(input.weeks || 4)))
  let client: { id: string; full_name: string; goals: string | null; limitations: string[]; equipment: string[]; client_group: string; birth_date: string | null } | null = null
  if (input.client_id) {
    const { data } = await db.from('clients').select('id, full_name, goals, limitations, equipment, client_group, birth_date').eq('id', input.client_id).maybeSingle()
    client = data
  }
  const limitations = [...new Set([...(input.limitations ?? []), ...(client?.limitations ?? [])])]
  const equipment = [...new Set([...(input.equipment ?? []), 'body only'])]

  // Tylko ćwiczenia z jej bazy, które da się zrobić tym sprzętem i bez przeciwwskazań klienta.
  const { data: all, error } = await db.from('exercises').select('id, name_pl, movement_pattern, muscle_groups, equipment, level, contraindications, tags')
  if (error) throw error
  // Ulubione trenerki (gwiazdka) – model ma po nie sięgać częściej.
  const { data: favRows } = await db.from('exercise_favorites').select('exercise_id')
  const favs = new Set((favRows ?? []).map((f) => f.exercise_id as string))
  // Siłownia: kategorie sprzętu i konkretne maszyny ustawione przez trenerkę
  let gymRow: { name: string; equipment: string[] | null; machines: string[] | null } | null = null
  if (input.gym_id) {
    const { data } = await db.from('gyms').select('name, equipment, machines').eq('id', input.gym_id).maybeSingle()
    gymRow = data
  }
  const allowed = (all ?? []).filter(
    (e) =>
      (e.equipment as string[]).every((q) => equipment.includes(q) && (!gymRow?.equipment || q === 'body only' || gymRow.equipment.includes(q))) &&
      !(gymRow?.machines && (e.equipment as string[]).includes('machine') && !gymRow.machines.includes(e.id as string)) &&
      !(e.contraindications as string[]).some((c) => limitations.includes(c)),
  )
  if (allowed.length < 8) throw new HttpError(400, 'Za mało ćwiczeń pasujących do sprzętu i ograniczeń – dodaj sprzęt albo ćwiczenia do bazy.')
  const codeToId = new Map(allowed.map((e, i) => [`e${i + 1}`, e.id as string]))
  const catalog = allowed
    .map((e, i) => `e${i + 1} | ${favs.has(e.id as string) ? '★ ' : ''}${e.name_pl}${(e.tags as string[] | null)?.length ? ` [${(e.tags as string[]).join(', ')}]` : ''} | ${e.movement_pattern ?? '-'} | ${(e.muscle_groups as string[]).join(',')} | ${e.level}`)
    .join('\n')

  const system = `Jesteś doświadczonym trenerem personalnym i układasz SZKIC planu treningowego, który trenerka potem poprawi.
Zasady:
- Używaj WYŁĄCZNIE ćwiczeń z katalogu poniżej, wpisując ich kod (np. "e42") w polu "code". Nie wymyślaj ćwiczeń ani kodów.
- Dokładnie ${weeks} tyg., w każdym dokładnie ${days} treningów. Kolejne tygodnie progresują (objętość, ciężar, RPE); jeśli to ma sens, ostatni tydzień może być deloadem.
- Na trening 4–8 ćwiczeń: najpierw złożone, potem akcesoryjne. Superserie oznacz tą samą literą w "group" (A, B…), pozostałe null.
- "reps" jako tekst, np. "8", "8-10", "30 s". "load" opisowo, np. "RPE 7", "60% 1RM", "masa ciała". "rest_sec" w sekundach.
- Nazwy treningów i opisy po polsku, krótko. "description" planu: 1–2 zdania o celu i logice.
- Fazy tygodni tylko z listy: ${PHASES.join(', ')}.
- Ćwiczenia oznaczone ★ to ulubione trenerki – wybieraj je w pierwszej kolejności, gdy pasują do celu. W nawiasach [ ] są jej etykiety (jej nazwy i rola ćwiczenia).${
    input.structure
      ? `
- Schemat trenerki dla każdego treningu: 1) przygotowanie ruchowe – ergometr 5 min, potem 3–4 ćwiczenia z etykietą „przygotowanie ruchowe” po 12/str (1 seria, notes "Przygotowanie ruchowe"); 2) aktywacja – 2–3 ćwiczenia z etykietą „aktywacja”, group "A", 2 serie (notes "Aktywacja"); 3) część główna w parach (group B, C, D…), wszędzie 3 serie; 4) na końcu finisher z etykietą „finisher” (np. sanki), jeśli jest w katalogu.`
      : ''
  }

Katalog ćwiczeń (kod | nazwa | wzorzec ruchu | mięśnie | poziom):
${catalog}`

  const brief = [
    // Bez imienia i daty urodzenia – do planu wystarczą grupa i wiek.
    client
      ? `Klient: grupa ${client.client_group}${client.birth_date ? `, wiek ${Math.floor((Date.now() - new Date(client.birth_date).getTime()) / (365.25 * 864e5))} lat` : ''}. Cele z karty: ${client.goals ?? 'brak'}.`
      : 'Plan ogólny (szablon), bez konkretnego klienta.',
    `Cel planu: ${input.goal}`,
    `Poziom: ${input.level}`,
    `Treningi w tygodniu: ${days}, liczba tygodni: ${weeks}${input.minutes ? `, ok. ${input.minutes} min na trening` : ''}`,
    `Dostępny sprzęt: ${equipment.join(', ')}${gymRow ? ` (siłownia ${gymRow.name} – katalog zawiera tylko to, co tam jest)` : ''}`,
    input.split && SPLIT_TEXT[input.split] ? `Typ treningu: ${SPLIT_TEXT[input.split]} – ułóż dni zgodnie z tym podziałem.` : '',
    `Ograniczenia / kontuzje: ${limitations.length ? limitations.join(', ') : 'brak'}`,
    input.notes ? `Uwagi trenerki: ${input.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const stream = anthropic().beta.messages.stream({
    model,
    max_tokens: 64000,
    ...fallbackFor(model),
    // Katalog jest stały między wywołaniami z tym samym filtrem – cache obniża koszt kolejnych prób.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
    messages: [{ role: 'user', content: brief }],
  } as unknown as Anthropic.Beta.MessageCreateParamsStreaming)
  const msg = await stream.finalMessage()
  logUsage('plan', model, msg.usage as Usage, (msg as { model?: string }).model)
  if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'Plan wyszedł za długi – zmniejsz liczbę tygodni albo treningów.')
  let plan: PlanOut
  try {
    plan = JSON.parse(textOf(msg))
  } catch {
    throw new HttpError(502, 'Nie udało się odczytać planu od modelu – spróbuj ponownie.')
  }

  // Walidacja: każde ćwiczenie musi istnieć w przefiltrowanym katalogu.
  const warnings: string[] = []
  let bad = 0
  let total = 0
  for (const w of plan.weeks) for (const wo of w.workouts) for (const ex of wo.exercises) {
    total++
    if (!codeToId.has(ex.code)) bad++
  }
  if (!total || bad / total > 0.2) throw new HttpError(502, 'Model zwrócił ćwiczenia spoza bazy – spróbuj ponownie.')
  if (bad) warnings.push(`Pominięto ${bad} ćwiczeń spoza bazy.`)

  // Zapis jako szkic (status draft) – uprawnieniami trenerki.
  const { data: prog, error: pe } = await db
    .from('programs')
    .insert({ name: plan.name.slice(0, 120), description: plan.description, client_id: client?.id ?? null, is_template: !client, status: 'draft' })
    .select('id')
    .single()
  if (pe) throw pe
  try {
    for (const [wi, w] of plan.weeks.entries()) {
      const { data: wk, error: we } = await db
        .from('program_weeks')
        .insert({ program_id: prog.id, position: wi, phase: w.phase && PHASES.includes(w.phase) ? w.phase : null, notes: w.notes })
        .select('id')
        .single()
      if (we) throw we
      for (const [oi, wo] of w.workouts.entries()) {
        const { data: wkt, error: oe } = await db.from('workouts').insert({ week_id: wk.id, position: oi, name: wo.name.slice(0, 80), notes: wo.notes }).select('id').single()
        if (oe) throw oe
        const rows = wo.exercises
          .filter((e) => codeToId.has(e.code))
          .map((e, i) => ({
            workout_id: wkt.id,
            exercise_id: codeToId.get(e.code),
            position: i,
            group_label: e.group?.slice(0, 2) || null,
            sets: e.sets > 0 ? Math.min(e.sets, 20) : null,
            reps: e.reps,
            load: e.load,
            tempo: e.tempo,
            rest_sec: e.rest_sec,
            rpe: e.rpe != null && e.rpe >= 1 && e.rpe <= 10 ? e.rpe : null,
            notes: e.notes,
          }))
        if (rows.length) {
          const { error: xe } = await db.from('workout_exercises').insert(rows)
          if (xe) throw xe
        }
      }
    }
  } catch (e) {
    await db.from('programs').delete().eq('id', prog.id)
    throw e
  }
  return { program_id: prog.id, warnings }
}

// ======================================================================
// Asystent nad danymi – zamknięta lista narzędzi tylko do odczytu
// ======================================================================
const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'find_clients',
    description: 'Lista klientów (id, imię i nazwisko, grupa, archiwum). Opcjonalnie filtr po fragmencie imienia/nazwiska.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: ['string', 'null'] } } },
  },
  {
    name: 'client_profile',
    description: 'Karta klienta: cele, ograniczenia, sprzęt, grupa, plany (nazwa, status), ostatnie pomiary.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['client_id'], properties: { client_id: { type: 'string' } } },
  },
  {
    name: 'exercise_history',
    description:
      'Historia serii klienta: data, ćwiczenie, powtórzenia, ciężar, RPE (najnowsze najpierw). Opcjonalnie filtr po fragmencie nazwy ćwiczenia (np. "martwy").',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['client_id', 'exercise_query', 'limit'],
      properties: { client_id: { type: 'string' }, exercise_query: { type: ['string', 'null'] }, limit: { type: ['integer', 'null'] } },
    },
  },
  {
    name: 'personal_records',
    description: 'Rekordy klienta: największy ciężar i szacowane 1RM na ćwiczenie, z datą.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['client_id'], properties: { client_id: { type: 'string' } } },
  },
  {
    name: 'attendance',
    description: 'Frekwencja w okresie: liczba sesji odbytych, zaplanowanych, odwołanych i nieobecności – dla jednego klienta albo wszystkich (client_id null). Daty RRRR-MM-DD.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['client_id', 'from', 'to'],
      properties: { client_id: { type: ['string', 'null'] }, from: { type: 'string' }, to: { type: 'string' } },
    },
  },
  {
    name: 'movement_analyses',
    description:
      'Analizy ruchu z kamery (technika): data, ćwiczenie (squat = przysiad, deadlift = martwy ciąg, pushup = pompka, press = wyciskanie nad głowę), ujęcie, liczba powtórzeń, średnie pomiary i findings – uwagi trenerskie (title, severity high/medium/low, reps, obs = co widać, cue = co powiedzieć, fix = nad czym pracować). findings = null oznacza starszą analizę bez zapisanych uwag. Dla klienta (client_id), pojedynczej analizy (analysis_id) albo najnowsze u wszystkich (oba null).',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['client_id', 'analysis_id'],
      properties: { client_id: { type: ['string', 'null'] }, analysis_id: { type: ['string', 'null'] } },
    },
  },
  {
    name: 'client_plan',
    description: 'Aktualny plan treningowy klienta (aktywny, a gdy brak – najnowszy): tygodnie, treningi i ćwiczenia z seriami, powtórzeniami, obciążeniem i RPE.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['client_id'], properties: { client_id: { type: 'string' } } },
  },
  {
    name: 'schedule',
    description: 'Sesje w grafiku w okresie (daty RRRR-MM-DD): początek, koniec, status, klient. Dla jednego klienta albo wszystkich (client_id null). Służy też do pytań o najbliższe treningi.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['client_id', 'from', 'to'],
      properties: { client_id: { type: ['string', 'null'] }, from: { type: 'string' }, to: { type: 'string' } },
    },
  },
  {
    name: 'find_exercises',
    description:
      'Szukanie w bazie ćwiczeń trenerki po fragmencie nazwy (polskiej lub angielskiej) i/lub wzorcu ruchu (squat, hinge, lunge, push_h, push_v, pull_h, pull_v, core, carry…). Zwraca nazwę, wzorzec, mięśnie, sprzęt, poziom. Używaj, gdy proponujesz ćwiczenia (np. korekcyjne) – proponuj tylko te, które są w bazie.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'pattern'],
      properties: { query: { type: ['string', 'null'] }, pattern: { type: ['string', 'null'] } },
    },
  },
  {
    name: 'propose_plan_changes',
    description:
      'Przygotowuje PROPOZYCJĘ zmian w planie – niczego nie zapisuje. Trenerka zobaczy kartę ze stanem przed/po i sama zatwierdzi (dwa kliknięcia) albo odrzuci. Najpierw pobierz plan narzędziem client_plan (stamtąd bierz workout_exercise_id i workout_id), a ćwiczenia do zamiany/dodania znajdź przez find_exercises (exercise_id). Wszystkie zmiany w jednym wywołaniu muszą dotyczyć jednego planu. Typy: update = zmiana parametrów ćwiczenia w treningu; swap = zamiana na inne ćwiczenie z bazy (parametry opcjonalnie); add = dodanie ćwiczenia na koniec treningu; remove = usunięcie. Pola parametrów: null = bez zmiany.',
    // bez strict: limit API to 16 pól z typem łączonym na wszystkie narzędzia; dane i tak sprawdza buildProposal
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'changes'],
      properties: {
        summary: { type: 'string', description: 'Jedno zdanie: co i po co zmieniamy.' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'workout_exercise_id', 'workout_id', 'exercise_id', 'sets', 'reps', 'load', 'tempo', 'rest_sec', 'rpe', 'notes', 'reason'],
            properties: {
              type: { type: 'string', enum: ['update', 'swap', 'add', 'remove'] },
              workout_exercise_id: { type: ['string', 'null'], description: 'Wymagane dla update, swap, remove.' },
              workout_id: { type: ['string', 'null'], description: 'Wymagane dla add.' },
              exercise_id: { type: ['string', 'null'], description: 'Nowe ćwiczenie – wymagane dla swap i add.' },
              sets: { type: ['integer', 'null'] },
              reps: { type: ['string', 'null'] },
              load: { type: ['string', 'null'] },
              tempo: { type: ['string', 'null'] },
              rest_sec: { type: ['integer', 'null'] },
              rpe: { type: ['number', 'null'] },
              notes: { type: ['string', 'null'] },
              reason: { type: 'string', description: 'Krótko: dlaczego.' },
            },
          },
        },
      },
    },
  },
  {
    name: 'clients_with_limitation',
    description: 'Klienci z danym ograniczeniem / kontuzją. Klucze: knee, lower_back, shoulder, hip, wrist, elbow, ankle, neck, pregnancy, hypertension (i inne z karty klienta).',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['limitation'], properties: { limitation: { type: 'string' } } },
  },
]

/** Ostatnie sesje klienta: id → data rozpoczęcia (najnowsze najpierw). */
async function recentLogs(db: SupabaseClient, clientId: string, limit: number) {
  const { data, error } = await db.from('session_logs').select('id, started_at').eq('client_id', clientId).order('started_at', { ascending: false }).limit(limit)
  if (error) throw error
  return new Map((data ?? []).map((l) => [l.id as string, l.started_at as string]))
}

async function runTool(db: SupabaseClient, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'find_clients': {
      let q = db.from('clients').select('id, full_name, client_group, archived, gyms(name)').order('full_name').limit(100)
      if (input.query) q = q.ilike('full_name', `%${String(input.query).replace(/[%_]/g, '')}%`)
      const { data, error } = await q
      if (error) throw error
      return data
    }
    case 'client_profile': {
      const id = String(input.client_id)
      const [c, p, m] = await Promise.all([
        db.from('clients').select('id, full_name, client_group, birth_date, goals, limitations, equipment, notes, archived, gyms(name)').eq('id', id).maybeSingle(),
        db.from('programs').select('id, name, status, start_date').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
        db.from('measurements').select('measured_on, kind, value, unit').eq('client_id', id).order('measured_on', { ascending: false }).limit(20),
      ])
      return { client: c.data, programs: p.data, measurements: m.data }
    }
    case 'exercise_history': {
      const limit = Math.min(Number(input.limit) || 40, 120)
      let exIds: string[] | null = null
      if (input.exercise_query) {
        const { data } = await db.from('exercises').select('id').ilike('name_pl', `%${String(input.exercise_query).replace(/[%_]/g, '')}%`).limit(50)
        exIds = (data ?? []).map((e) => e.id)
        if (!exIds.length) return { note: 'Nie znaleziono ćwiczenia o takiej nazwie w bazie.' }
      }
      const logs = await recentLogs(db, String(input.client_id), 200)
      if (!logs.size) return { note: 'Brak zapisanych sesji tego klienta.' }
      let q = db.from('set_logs').select('log_id, set_index, reps, load_kg, rpe, done, exercises(name_pl)').in('log_id', [...logs.keys()])
      if (exIds) q = q.in('exercise_id', exIds)
      const { data, error } = await q.limit(3000)
      if (error) throw error
      return (data ?? [])
        .map((s: any) => ({ date: logs.get(s.log_id), exercise: s.exercises?.name_pl, set: s.set_index + 1, reps: s.reps, load_kg: s.load_kg, rpe: s.rpe, done: s.done }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.set - b.set)
        .slice(0, limit)
    }
    case 'personal_records': {
      const logs = await recentLogs(db, String(input.client_id), 500)
      if (!logs.size) return { note: 'Brak zapisanych sesji tego klienta.' }
      const { data, error } = await db
        .from('set_logs')
        .select('log_id, reps, load_kg, exercises(name_pl)')
        .in('log_id', [...logs.keys()])
        .eq('done', true)
        .not('load_kg', 'is', null)
        .limit(5000)
      if (error) throw error
      const best = new Map<string, { exercise: string; max_kg: number; reps: number; date: string; e1rm: number }>()
      for (const s of (data ?? []) as any[]) {
        const name = s.exercises?.name_pl ?? '?'
        const e1rm = s.reps ? s.load_kg * (1 + s.reps / 30) : s.load_kg
        const cur = best.get(name)
        if (!cur || e1rm > cur.e1rm) best.set(name, { exercise: name, max_kg: s.load_kg, reps: s.reps, date: logs.get(s.log_id)!, e1rm: Math.round(e1rm * 10) / 10 })
      }
      return [...best.values()].sort((a, b) => b.e1rm - a.e1rm)
    }
    case 'attendance': {
      let q = db.from('sessions').select('client_id, status, clients(full_name)').gte('starts_at', String(input.from)).lt('starts_at', `${input.to}T23:59:59`)
      if (input.client_id) q = q.eq('client_id', String(input.client_id))
      const { data, error } = await q.limit(5000)
      if (error) throw error
      const by = new Map<string, Record<string, unknown>>()
      for (const s of (data ?? []) as any[]) {
        const r = by.get(s.client_id) ?? { client_id: s.client_id, name: s.clients?.full_name, completed: 0, planned: 0, cancelled: 0, no_show: 0 }
        const k = s.status === 'completed' ? 'completed' : s.status === 'cancelled' ? 'cancelled' : s.status === 'no_show' ? 'no_show' : 'planned'
        r[k] = (r[k] as number) + 1
        by.set(s.client_id, r)
      }
      return [...by.values()]
    }
    case 'movement_analyses': {
      let q = db
        .from('movement_analyses')
        .select('id, client_id, exercise_key, label, recorded_at, view, reps, reps_actual, is_reference, notes, findings, clients(full_name)')
        .order('recorded_at', { ascending: false })
        .limit(input.analysis_id ? 1 : 15)
      if (input.analysis_id) q = q.eq('id', String(input.analysis_id))
      else if (input.client_id) q = q.eq('client_id', String(input.client_id))
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map((a: any) => {
        const reps = (a.reps ?? []) as { metrics: Record<string, number | null> }[]
        const avg: Record<string, number> = {}
        for (const k of new Set(reps.flatMap((r) => Object.keys(r.metrics ?? {})))) {
          const v = reps.map((r) => r.metrics[k]).filter((x): x is number => typeof x === 'number')
          if (v.length) avg[k] = Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10
        }
        return {
          id: a.id,
          client_id: a.client_id,
          who: a.clients?.full_name ?? 'trenerka (np. wzorzec)',
          exercise: a.exercise_key,
          date: a.recorded_at,
          view: a.view,
          label: a.label,
          reference: a.is_reference,
          reps_detected: reps.length,
          reps_actual: a.reps_actual,
          avg_metrics: avg,
          findings: a.findings,
          notes: a.notes,
        }
      })
    }
    case 'client_plan': {
      const id = String(input.client_id)
      const { data: progs, error: pe } = await db.from('programs').select('id, name, status, start_date, description').eq('client_id', id).order('created_at', { ascending: false }).limit(10)
      if (pe) throw pe
      const prog = (progs ?? []).find((p) => p.status === 'active') ?? progs?.[0]
      if (!prog) return { note: 'Klient nie ma żadnego planu.' }
      const { data, error } = await db
        .from('program_weeks')
        .select('position, phase, notes, workouts(id, position, name, notes, workout_exercises(id, exercise_id, position, group_label, sets, reps, load, tempo, rest_sec, rpe, notes, exercises(name_pl)))')
        .eq('program_id', prog.id)
        .order('position')
      if (error) throw error
      const byPos = (a: any, b: any) => a.position - b.position
      return {
        program: prog,
        weeks: (data ?? []).map((w: any) => ({
          week: w.position + 1,
          phase: w.phase,
          notes: w.notes,
          workouts: [...(w.workouts ?? [])].sort(byPos).map((wo: any) => ({
            workout_id: wo.id,
            name: wo.name,
            notes: wo.notes,
            exercises: [...(wo.workout_exercises ?? [])].sort(byPos).map((e: any) => ({
              workout_exercise_id: e.id,
              exercise_id: e.exercise_id,
              exercise: e.exercises?.name_pl,
              group: e.group_label,
              sets: e.sets,
              reps: e.reps,
              load: e.load,
              tempo: e.tempo,
              rest_sec: e.rest_sec,
              rpe: e.rpe,
              notes: e.notes,
            })),
          })),
        })),
      }
    }
    case 'schedule': {
      let q = db
        .from('sessions')
        .select('id, client_id, starts_at, ends_at, status, notes, clients(full_name)')
        .gte('starts_at', String(input.from))
        .lt('starts_at', `${input.to}T23:59:59`)
        .order('starts_at')
        .limit(300)
      if (input.client_id) q = q.eq('client_id', String(input.client_id))
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map((s: any) => ({ client_id: s.client_id, name: s.clients?.full_name, starts_at: s.starts_at, ends_at: s.ends_at, status: s.status, notes: s.notes }))
    }
    case 'find_exercises': {
      let q = db.from('exercises').select('id, name_pl, name_en, movement_pattern, muscle_groups, equipment, level').order('name_pl').limit(40)
      if (input.query) {
        const s = String(input.query).replace(/[%_,()]/g, '').trim()
        if (s) q = q.or(`name_pl.ilike.%${s}%,name_en.ilike.%${s}%`)
      }
      if (input.pattern) q = q.eq('movement_pattern', String(input.pattern))
      const { data, error } = await q
      if (error) throw error
      return data?.length ? data : { note: 'Nic nie znaleziono – spróbuj innego słowa (także po angielsku) albo samego wzorca ruchu.' }
    }
    case 'clients_with_limitation': {
      const { data, error } = await db.from('clients').select('id, full_name, limitations, archived').contains('limitations', [String(input.limitation)])
      if (error) throw error
      return data
    }
  }
  throw new Error(`Nieznane narzędzie: ${name}`)
}

// ----- Propozycje zmian w planie: model tylko proponuje; zapis robi aplikacja po dwóch potwierdzeniach trenerki -----
const FIELDS = ['sets', 'reps', 'load', 'tempo', 'rest_sec', 'rpe', 'notes'] as const
type Field = (typeof FIELDS)[number]
interface ChangeIn extends Record<Field, string | number | null> {
  type: 'update' | 'swap' | 'add' | 'remove'
  workout_exercise_id: string | null
  workout_id: string | null
  exercise_id: string | null
  reason: string
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WHERE = 'id, name, program_weeks(position, programs(id, name, status, client_id, is_template))'

async function buildProposal(db: SupabaseClient, input: { summary: string; changes: ChangeIn[] }) {
  const changes = Array.isArray(input.changes) ? input.changes.slice(0, 30) : []
  if (!changes.length) throw new Error('Brak zmian.')
  const ids = (k: 'workout_exercise_id' | 'workout_id' | 'exercise_id') => [...new Set(changes.map((c) => c[k]).filter((v): v is string => !!v && UUID.test(v)))]
  const [we, wo, ex] = await Promise.all([
    ids('workout_exercise_id').length
      ? db.from('workout_exercises').select(`id, workout_id, exercise_id, position, group_label, sets, reps, load, tempo, rest_sec, rpe, notes, progression, exercises(name_pl), workouts(${WHERE})`).in('id', ids('workout_exercise_id'))
      : { data: [], error: null },
    ids('workout_id').length ? db.from('workouts').select(WHERE).in('id', ids('workout_id')) : { data: [], error: null },
    ids('exercise_id').length ? db.from('exercises').select('id, name_pl').in('id', ids('exercise_id')) : { data: [], error: null },
  ])
  if (we.error) throw we.error
  if (wo.error) throw wo.error
  if (ex.error) throw ex.error
  const weBy = new Map((we.data as any[]).map((r) => [r.id, r]))
  const woBy = new Map((wo.data as any[]).map((r) => [r.id, r]))
  const exBy = new Map((ex.data as any[]).map((r) => [r.id, r.name_pl as string]))

  const clean = (c: ChangeIn) => {
    const out: Partial<Record<Field, string | number>> = {}
    if (c.sets != null) out.sets = Math.max(1, Math.min(20, Math.round(Number(c.sets))))
    if (c.rest_sec != null) out.rest_sec = Math.max(0, Math.min(900, Math.round(Number(c.rest_sec))))
    if (c.rpe != null) {
      const r = Number(c.rpe)
      if (!(r >= 1 && r <= 10)) throw new Error('RPE musi być w zakresie 1–10.')
      out.rpe = Math.round(r * 2) / 2
    }
    for (const k of ['reps', 'load', 'tempo', 'notes'] as const) if (c[k] != null && String(c[k]).trim()) out[k] = String(c[k]).trim().slice(0, k === 'notes' ? 300 : 40)
    return out
  }
  let program: { id: string; name: string; status: string; is_template: boolean } | null = null
  const out = changes.map((c) => {
    const row = c.workout_exercise_id ? weBy.get(c.workout_exercise_id) : null
    const workout = c.type === 'add' ? (c.workout_id ? woBy.get(c.workout_id) : null) : row?.workouts
    if (c.type !== 'add' && !row) throw new Error(`Nie ma pozycji planu o workout_exercise_id ${c.workout_exercise_id} – pobierz plan przez client_plan.`)
    if (c.type === 'add' && !workout) throw new Error(`Nie ma treningu o workout_id ${c.workout_id} – pobierz plan przez client_plan.`)
    const p = workout?.program_weeks?.programs
    if (!p) throw new Error('Nie udało się ustalić planu dla tej zmiany.')
    if (program && program.id !== p.id) throw new Error('Wszystkie zmiany w jednej propozycji muszą dotyczyć jednego planu.')
    program = { id: p.id, name: p.name, status: p.status, is_template: p.is_template }
    const where = `Tydz. ${(workout.program_weeks.position ?? 0) + 1} · ${workout.name}`
    const fields = clean(c)
    const base = { type: c.type, where, reason: String(c.reason ?? '').slice(0, 200), we_id: row?.id ?? null, workout_id: workout.id as string }
    if (c.type === 'add' || c.type === 'swap') {
      if (!c.exercise_id || !exBy.has(c.exercise_id)) throw new Error('Ćwiczenie do dodania/zamiany musi pochodzić z bazy – znajdź je przez find_exercises i podaj exercise_id.')
    }
    if (c.type === 'add') return { ...base, exercise: exBy.get(c.exercise_id!)!, new_exercise_id: c.exercise_id, after: fields }
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const k of FIELDS) {
      if (fields[k] === undefined || String(fields[k]) === String(row[k] ?? '')) continue
      before[k] = row[k]
      after[k] = fields[k]
    }
    if (c.type === 'remove') return { ...base, exercise: row.exercises?.name_pl ?? '?', exercise_id: row.exercise_id }
    if (c.type === 'swap') {
      if (c.exercise_id === row.exercise_id) throw new Error('Zamiana na to samo ćwiczenie.')
      return { ...base, exercise: row.exercises?.name_pl ?? '?', exercise_id: row.exercise_id, new_exercise: exBy.get(c.exercise_id!)!, new_exercise_id: c.exercise_id, before, after }
    }
    if (!Object.keys(after).length) throw new Error(`Brak różnic względem obecnych wartości dla „${row.exercises?.name_pl}” (${where}).`)
    return { ...base, exercise: row.exercises?.name_pl ?? '?', exercise_id: row.exercise_id, before, after }
  })
  return { id: crypto.randomUUID(), summary: String(input.summary ?? '').slice(0, 300), program: program!, changes: out }
}

async function ask(db: SupabaseClient, history: { role: 'user' | 'assistant'; content: string }[], context?: { client_id?: string | null; analysis_id?: string | null }) {
  const today = new Date().toISOString().slice(0, 10)
  const system = `Jesteś asystentem trenerki personalnej w jej aplikacji. Odpowiadasz po polsku, krótko i konkretnie, wyłącznie na podstawie danych z narzędzi – nie zgaduj liczb ani dat.
Styl: precyzyjnie i bezpośrednio. Krótkie zdania. Najpierw odpowiedź, potem najwyżej kilka punktów z konkretami (liczby, daty, nazwy). Bez wstępów, bez powtarzania pytania, bez ogólników, bez asekuracyjnych zastrzeżeń i bez podsumowań na końcu. Nie dopisuj rad, o które nikt nie prosił. Dłużej tylko wtedy, gdy trenerka wyraźnie o to poprosi.
Daty i godziny z narzędzi są w UTC – podawaj je w czasie polskim (Europe/Warsaw), bez dopisku o strefie.
Gdy wymieniasz klienta, dodaj link w formacie Markdown do jego karty: [Imię Nazwisko](/klienci/<id>) albo do zakładki: [postępy](/klienci/<id>?tab=progress), [historia](/klienci/<id>?tab=history), [ruch](/klienci/<id>?tab=ruch). Innych linków nie twórz.
Link do analizy ruchu: [analiza](/analiza/<id>).
Technika: korzystaj z movement_analyses. Uwagi (findings) pochodzą z automatycznej analizy nagrania – to wskazania do potwierdzenia przez trenerkę, nie diagnoza; nie stawiaj rozpoznań medycznych. Gdy omawiasz analizę, podaj: 1) najważniejsze 1–3 rzeczy do poprawy w kolejności ważności, 2) co powiedzieć klientowi (krótkie komendy), 3) 2–4 ćwiczenia korekcyjne lub regresje – wyłącznie takie, które znalazłeś w bazie przez find_exercises, z uwzględnieniem ograniczeń z karty klienta.
Zmiany w planie: sam niczego nie zapisujesz. Gdy trenerka prosi o zmianę w planie albo zgadza się na Twoją sugestię, wywołaj propose_plan_changes – zobaczy kartę z przyciskiem „Zastosuj” i sama zatwierdzi. Po wywołaniu napisz krótko, co proponujesz i dlaczego; nigdy nie pisz, że zmiana została wprowadzona. Nie proponuj karty, gdy trenerka pyta tylko o opinię – najpierw opisz sugestie i zapytaj, czy przygotować zmianę. Uwzględniaj ograniczenia z karty klienta.
Jeśli pytanie dotyczy danych, których narzędzia nie dają (np. finanse, sprawy spoza treningu), powiedz o tym wprost.`
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((m) => ({ role: m.role, content: m.content }))
  // Bieżąca data jako wiadomość operatora na końcu – stała część promptu zostaje w cache.
  const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null)
  const ctx = [
    uuid(context?.client_id) ? `Rozmowa została otwarta z karty klienta o id ${uuid(context?.client_id)} – pytania bez wskazania osoby dotyczą tego klienta.` : '',
    uuid(context?.analysis_id) ? `Rozmowa została otwarta z analizy ruchu o id ${uuid(context?.analysis_id)} – pobierz ją narzędziem movement_analyses.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  messages.push({ role: 'system', content: `Dzisiaj jest ${today}. ${ctx}`.trim() } as unknown as Anthropic.Beta.BetaMessageParam)
  const client = anthropic()
  const proposals: unknown[] = []
  const done = (answer: string) => ({ answer, proposals })
  const model = await modelFor(db, 'assistant')
  for (let i = 0; i < 10; i++) {
    const msg = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      ...fallbackFor(model),
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
      tools: TOOLS,
      messages,
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
    logUsage('ask', model, msg.usage as Usage, (msg as { model?: string }).model)
    if (msg.stop_reason === 'refusal') return done(textOf(msg))
    if (msg.stop_reason !== 'tool_use') return done(textOf(msg) || (proposals.length ? 'Przygotowałem propozycję zmian – sprawdź kartę poniżej.' : 'Brak odpowiedzi.'))
    messages.push({ role: 'assistant', content: msg.content })
    const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    const results = await Promise.all(
      uses.map(async (u) => {
        try {
          if (u.name === 'propose_plan_changes') {
            const p = await buildProposal(db, u.input as { summary: string; changes: ChangeIn[] })
            proposals.push(p)
            return {
              type: 'tool_result' as const,
              tool_use_id: u.id,
              content: `Propozycja (${p.changes.length} zmian w planie „${p.program.name}”) została pokazana trenerce jako karta do zatwierdzenia. NIC nie zostało zapisane – nie pisz, że zmiana jest wprowadzona.`,
            }
          }
          const out = await runTool(db, u.name, u.input as Record<string, unknown>)
          return { type: 'tool_result' as const, tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000) }
        } catch (e) {
          return { type: 'tool_result' as const, tool_use_id: u.id, content: `Błąd: ${(e as Error).message}`, is_error: true }
        }
      }),
    )
    messages.push({ role: 'user', content: results })
  }
  return done('Nie udało się zebrać odpowiedzi w rozsądnej liczbie kroków – zadaj węższe pytanie.')
}

// ======================================================================
// Tłumaczenie wskazówek technicznych ćwiczeń (EN → PL) – partiami, structured output, bez danych osobowych.
const TRANSLATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'pl'], properties: { id: { type: 'string' }, pl: { type: 'string' } } } },
  },
} as const
async function translate(items: { id: string; name: string; text: string }[], model: string) {
  const batch = items.slice(0, 25).filter((i) => typeof i.id === 'string' && typeof i.text === 'string' && i.text.length < 6000)
  if (!batch.length) return { items: [] }
  const msg = await anthropic().beta.messages.create({
    model,
    max_tokens: 16000,
    ...(model === MODEL ? FALLBACK : {}),
    output_config: { effort: 'low', format: { type: 'json_schema', schema: TRANSLATE_SCHEMA } },
    system: [
      {
        type: 'text',
        text: 'Tłumaczysz instrukcje techniki ćwiczeń siłowych z angielskiego na polski dla aplikacji trenerki personalnej. Język naturalny, poprawna terminologia siłowniana (np. sztanga, hantle, wyciąg, łopatki, wyprost, przysiad), tryb rozkazujący 2. osoby jak w instrukcji. Zachowaj podział na kroki (każdy w osobnej linii). Nie dodawaj treści, nie skracaj. Zwróć te same id.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: JSON.stringify(batch.map((i) => ({ id: i.id, exercise: i.name, text: i.text }))) }],
  } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
  logUsage('translate', model, msg.usage as Usage, (msg as { model?: string }).model)
  if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'Za długa partia – zmniejsz liczbę ćwiczeń w jednym wywołaniu.')
  const out = JSON.parse(textOf(msg)) as { items: { id: string; pl: string }[] }
  const ids = new Set(batch.map((i) => i.id))
  return { items: out.items.filter((i) => ids.has(i.id) && i.pl.trim()), usage: msg.usage }
}

// ======================================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('Authorization')
  if (!(await isTrainer(auth))) return json({ error: 'Brak uprawnień' }, 401)
  const db = asUser(auth!)
  try {
    const body = await req.json()
    // Czy AI jest włączone (klucz w sekretach) – aplikacja pokazuje wtedy opcję "z AI" obok generatora z reguł.
    if (body.action === 'status') return json({ ai: !!Deno.env.get('ANTHROPIC_API_KEY') })
    if (body.action === 'plan') return json(await generatePlan(db, body as PlanInput))
    if (body.action === 'translate') return json(await translate(Array.isArray(body.items) ? body.items : [], body.model === 'claude-haiku-5-5' ? 'claude-haiku-5-5' : MODEL))
    if (body.action === 'ask') {
      const history = Array.isArray(body.messages) ? body.messages.filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : []
      if (!history.length || history.at(-1).role !== 'user') return json({ error: 'Brak pytania' }, 400)
      return json(await ask(db, history, body.context))
    }
    return json({ error: 'Nieznana akcja' }, 400)
  } catch (e) {
    console.error(e)
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Za dużo zapytań do AI – spróbuj za chwilę.' }, 429)
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'Nieprawidłowy klucz ANTHROPIC_API_KEY.' }, 503)
    if (e instanceof Anthropic.APIError) return json({ error: `Błąd AI (${e.status}): ${e.message}` }, 502)
    return json({ error: (e as Error).message }, 500)
  }
})
