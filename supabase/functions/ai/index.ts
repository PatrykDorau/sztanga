// AI dla trenerki (Claude): generator szkicu planu i asystent nad danymi.
// Wywołuje tylko zalogowana trenerka; dane czytane i zapisywane jej uprawnieniami (RLS), klucz Anthropic zostaje na serwerze.
//   POST { action: 'plan', ...formularz }      → { program_id, warnings }
//   POST { action: 'ask', messages: [...] }    → { answer }
import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'
import { asUser, cors, isTrainer, json } from '../_shared/google.ts'

const MODEL = 'claude-opus-5-5'
// Gdy model odmówi (filtry bezpieczeństwa), API samo ponawia na modelu zapasowym.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as const

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
  client_id?: string | null
  goal: string
  level: 'beginner' | 'intermediate' | 'advanced'
  days: number
  weeks: number
  minutes?: number | null
  equipment: string[]
  limitations: string[]
  notes?: string | null
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
  const { data: all, error } = await db.from('exercises').select('id, name_pl, movement_pattern, muscle_groups, equipment, level, contraindications')
  if (error) throw error
  const allowed = (all ?? []).filter(
    (e) => (e.equipment as string[]).every((q) => equipment.includes(q)) && !(e.contraindications as string[]).some((c) => limitations.includes(c)),
  )
  if (allowed.length < 8) throw new HttpError(400, 'Za mało ćwiczeń pasujących do sprzętu i ograniczeń – dodaj sprzęt albo ćwiczenia do bazy.')
  const codeToId = new Map(allowed.map((e, i) => [`e${i + 1}`, e.id as string]))
  const catalog = allowed
    .map((e, i) => `e${i + 1} | ${e.name_pl} | ${e.movement_pattern ?? '-'} | ${(e.muscle_groups as string[]).join(',')} | ${e.level}`)
    .join('\n')

  const system = `Jesteś doświadczonym trenerem personalnym i układasz SZKIC planu treningowego, który trenerka potem poprawi.
Zasady:
- Używaj WYŁĄCZNIE ćwiczeń z katalogu poniżej, wpisując ich kod (np. "e42") w polu "code". Nie wymyślaj ćwiczeń ani kodów.
- Dokładnie ${weeks} tyg., w każdym dokładnie ${days} treningów. Kolejne tygodnie progresują (objętość, ciężar, RPE); jeśli to ma sens, ostatni tydzień może być deloadem.
- Na trening 4–8 ćwiczeń: najpierw złożone, potem akcesoryjne. Superserie oznacz tą samą literą w "group" (A, B…), pozostałe null.
- "reps" jako tekst, np. "8", "8-10", "30 s". "load" opisowo, np. "RPE 7", "60% 1RM", "masa ciała". "rest_sec" w sekundach.
- Nazwy treningów i opisy po polsku, krótko. "description" planu: 1–2 zdania o celu i logice.
- Fazy tygodni tylko z listy: ${PHASES.join(', ')}.

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
    `Dostępny sprzęt: ${equipment.join(', ')}`,
    `Ograniczenia / kontuzje: ${limitations.length ? limitations.join(', ') : 'brak'}`,
    input.notes ? `Uwagi trenerki: ${input.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const stream = anthropic().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    ...FALLBACK,
    // Katalog jest stały między wywołaniami z tym samym filtrem – cache obniża koszt kolejnych prób.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
    messages: [{ role: 'user', content: brief }],
  } as unknown as Anthropic.Beta.MessageCreateParamsStreaming)
  const msg = await stream.finalMessage()
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
      let q = db.from('clients').select('id, full_name, client_group, archived').order('full_name').limit(100)
      if (input.query) q = q.ilike('full_name', `%${String(input.query).replace(/[%_]/g, '')}%`)
      const { data, error } = await q
      if (error) throw error
      return data
    }
    case 'client_profile': {
      const id = String(input.client_id)
      const [c, p, m] = await Promise.all([
        db.from('clients').select('id, full_name, client_group, birth_date, goals, limitations, equipment, notes, archived').eq('id', id).maybeSingle(),
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
    case 'clients_with_limitation': {
      const { data, error } = await db.from('clients').select('id, full_name, limitations, archived').contains('limitations', [String(input.limitation)])
      if (error) throw error
      return data
    }
  }
  throw new Error(`Nieznane narzędzie: ${name}`)
}

async function ask(db: SupabaseClient, history: { role: 'user' | 'assistant'; content: string }[]) {
  const today = new Date().toISOString().slice(0, 10)
  const system = `Jesteś asystentem trenerki personalnej w jej aplikacji. Odpowiadasz po polsku, krótko i konkretnie, wyłącznie na podstawie danych z narzędzi – nie zgaduj liczb ani dat.
Gdy wymieniasz klienta, dodaj link w formacie Markdown do jego karty: [Imię Nazwisko](/klienci/<id>) albo do zakładki: [postępy](/klienci/<id>?tab=progress), [historia](/klienci/<id>?tab=history), [ruch](/klienci/<id>?tab=ruch). Innych linków nie twórz.
Jeśli pytanie dotyczy danych, których narzędzia nie dają (np. finanse, sprawy spoza treningu), powiedz o tym wprost.`
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((m) => ({ role: m.role, content: m.content }))
  // Bieżąca data jako wiadomość operatora na końcu – stała część promptu zostaje w cache.
  messages.push({ role: 'system', content: `Dzisiaj jest ${today}.` } as unknown as Anthropic.Beta.BetaMessageParam)
  const client = anthropic()
  for (let i = 0; i < 8; i++) {
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
      tools: TOOLS,
      messages,
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
    if (msg.stop_reason === 'refusal') return textOf(msg)
    if (msg.stop_reason !== 'tool_use') return textOf(msg) || 'Brak odpowiedzi.'
    messages.push({ role: 'assistant', content: msg.content })
    const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    const results = await Promise.all(
      uses.map(async (u) => {
        try {
          const out = await runTool(db, u.name, u.input as Record<string, unknown>)
          return { type: 'tool_result' as const, tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000) }
        } catch (e) {
          return { type: 'tool_result' as const, tool_use_id: u.id, content: `Błąd: ${(e as Error).message}`, is_error: true }
        }
      }),
    )
    messages.push({ role: 'user', content: results })
  }
  return 'Nie udało się zebrać odpowiedzi w rozsądnej liczbie kroków – zadaj węższe pytanie.'
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
    if (body.action === 'ask') {
      const history = Array.isArray(body.messages) ? body.messages.filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : []
      if (!history.length || history.at(-1).role !== 'user') return json({ error: 'Brak pytania' }, 400)
      return json({ answer: await ask(db, history) })
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
