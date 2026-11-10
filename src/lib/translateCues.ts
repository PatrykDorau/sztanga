// Tłumaczenie zaimportowanych instrukcji technicznych (EN → PL) przez funkcję „ai” (Claude), partiami po 10, 4 naraz.
// Wynik zapisuje się od razu – przerwanie i ponowne uruchomienie kontynuuje od nieprzetłumaczonych.
import { supabase } from '@/lib/supabase'

export type TranslateModel = 'claude-opus-5-5' | 'claude-haiku-5-5'
/** Cena za 1 mln tokenów (wejście / wyjście) w USD – do szacunku kosztu. */
export const PRICE: Record<TranslateModel, [number, number]> = { 'claude-opus-5-5': [4, 20], 'claude-haiku-5-5': [0.1, 0.5] }

export async function pendingCount() {
  const { count } = await supabase.from('exercises').select('id', { count: 'exact', head: true }).eq('cues_lang', 'en')
  return count ?? 0
}

export async function translateAll(model: TranslateModel, onProgress: (done: number, total: number, usd: number) => void, signal: { stop: boolean }) {
  const { data, error } = await supabase.from('exercises').select('id, name_en, name_pl, cues').eq('cues_lang', 'en').order('name_en').limit(2000)
  if (error) throw error
  const rows = (data ?? []) as { id: string; name_en: string | null; name_pl: string; cues: string | null }[]
  let done = 0
  let usd = 0
  onProgress(0, rows.length, 0)
  const batches: (typeof rows)[] = []
  // Po 10 – przy 20 długie instrukcje potrafiły przekroczyć limit odpowiedzi modelu.
  for (let i = 0; i < rows.length; i += 10) batches.push(rows.slice(i, i + 10).filter((r) => r.cues))
  // 4 partie naraz – każda to osobne wywołanie Claude (ok. minuta), więc całość trwa kilkanaście minut zamiast godziny.
  let next = 0
  async function worker() {
    while (next < batches.length && !signal.stop) {
      const batch = batches[next++]
      const { data: res, error: e } = await supabase.functions.invoke('ai', {
        body: { action: 'translate', model, items: batch.map((r) => ({ id: r.id, name: r.name_en ?? r.name_pl, text: r.cues })) },
      })
      if (e) throw new Error((await (e as { context?: Response }).context?.json?.().catch(() => null))?.error ?? e.message)
      const out = res as { items: { id: string; pl: string }[]; usage?: { input_tokens: number; output_tokens: number } }
      for (const it of out.items) {
        const { error: ue } = await supabase.from('exercises').update({ cues: it.pl.trim(), cues_lang: 'pl' }).eq('id', it.id)
        if (ue) throw ue
      }
      if (out.usage) usd += (out.usage.input_tokens * PRICE[model][0] + out.usage.output_tokens * PRICE[model][1]) / 1e6
      done += batch.length
      onProgress(done, rows.length, usd)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  return { done, usd }
}
