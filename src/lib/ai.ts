// Wywołania funkcji "ai" (Claude po stronie serwera; klucz nigdy nie trafia do przeglądarki).
import { supabase } from '@/lib/supabase'
import type { Proposal } from '@/lib/planActions'

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai', { body })
  if (error) throw new Error((await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message)
  return data as T
}

export interface PlanRequest {
  client_id: string | null
  goal: string
  level: 'beginner' | 'intermediate' | 'advanced'
  days: number
  weeks: number
  minutes: number | null
  equipment: string[]
  limitations: string[]
  notes: string | null
  split?: SplitType // typ treningu (auto = wg liczby dni)
  gym_id?: string | null // siłownia – tylko dostępny tam sprzęt
}
export type SplitType = 'auto' | 'fbw' | 'upper_lower' | 'push_pull' | 'ppl' | 'bro'
export const SPLIT_LABEL: Record<SplitType, string> = {
  auto: 'Automatycznie',
  fbw: 'FBW (całe ciało)',
  upper_lower: 'Góra / dół',
  push_pull: 'Push / pull',
  ppl: 'Push / pull / nogi',
  bro: 'Split na partie',
}
export const SPLIT_HINT: Record<SplitType, string> = {
  auto: '1–3 dni: FBW, 4–5: góra/dół, 6: push/pull/nogi',
  fbw: 'każdy trening na całe ciało – najlepsze przy 2–3 dniach',
  upper_lower: 'naprzemiennie góra i dół ciała – 2–4 dni',
  push_pull: 'pchanie + czworogłowe / przyciąganie + tył uda – 2–4 dni',
  ppl: 'pchanie, przyciąganie, nogi – 3 lub 6 dni',
  bro: 'klatka, plecy, nogi, barki, ręce – 4–5 dni, dla zaawansowanych',
}
/** Czy AI jest skonfigurowane po stronie serwera (bez klucza działa tylko generator z reguł). */
export const aiStatus = () => call<{ ai: boolean }>({ action: 'status' }).catch(() => ({ ai: false }))
export const generatePlan =(req: PlanRequest) => call<{ program_id: string; warnings: string[] }>({ action: 'plan', ...req })

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  proposals?: Proposal[] // karty zmian w planie do zatwierdzenia przez trenerkę
}
/** Kontekst rozmowy: asystent otwarty z karty klienta albo z analizy ruchu. */
export interface ChatContext {
  client_id?: string | null
  analysis_id?: string | null
}
const STATE_NOTE = { pending: 'czeka na decyzję trenerki', applied: 'trenerka zatwierdziła – zapisana w planie', undone: 'zastosowana, a potem cofnięta przez trenerkę', rejected: 'odrzucona przez trenerkę' }
/** Do modelu idzie sam tekst rozmowy + dopisek, co trenerka zrobiła z kartami propozycji. */
export const askAssistant = (messages: ChatMessage[], context?: ChatContext) =>
  call<{ answer: string; proposals?: Proposal[] }>({
    action: 'ask',
    context,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content + (m.proposals ?? []).map((p) => `\n[Karta propozycji „${p.summary}”: ${STATE_NOTE[p.state ?? 'pending']}]`).join(''),
    })),
  })

/** Bezpieczne wyświetlanie odpowiedzi: tekst + pogrubienia + wewnętrzne linki (/…), nic więcej. */
export type Piece = { kind: 'text' | 'bold'; text: string } | { kind: 'link'; text: string; to: string } | { kind: 'br' }
export function pieces(md: string): Piece[] {
  const out: Piece[] = []
  for (const [li, line] of md.split('\n').entries()) {
    if (li) out.push({ kind: 'br' })
    const re = /\[([^\]]+)\]\((\/[^)\s]*)\)|\*\*([^*]+)\*\*/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) })
      if (m[1]) out.push({ kind: 'link', text: m[1], to: m[2] })
      else out.push({ kind: 'bold', text: m[3] })
      last = re.lastIndex
    }
    if (last < line.length) out.push({ kind: 'text', text: line.slice(last) })
  }
  return out
}
