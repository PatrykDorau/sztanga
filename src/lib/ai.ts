// Wywołania funkcji "ai" (Claude po stronie serwera; klucz nigdy nie trafia do przeglądarki).
import { supabase } from '@/lib/supabase'

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
}
/** Czy AI jest skonfigurowane po stronie serwera (bez klucza działa tylko generator z reguł). */
export const aiStatus = () => call<{ ai: boolean }>({ action: 'status' }).catch(() => ({ ai: false }))
export const generatePlan =(req: PlanRequest) => call<{ program_id: string; warnings: string[] }>({ action: 'plan', ...req })

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
export const askAssistant = (messages: ChatMessage[]) => call<{ answer: string }>({ action: 'ask', messages })

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
