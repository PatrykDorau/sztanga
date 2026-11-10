// Tłumaczenie zaimportowanych instrukcji technicznych (EN → PL) przez funkcję „ai” (Claude), partiami po 20.
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
  for (let i = 0; i < rows.length && !signal.stop; i += 20) {
    const batch = rows.slice(i, i + 20).filter((r) => r.cues)
    const { data: res, error: e } = await supabase.functions.invoke('ai', {
      body: { action: 'translate', model, items: batch.map((r) => ({ id: r.id, name: r.name_en ?? r.name_pl, text: r.cues })) },
    })
    if (e) throw new Error((await (e as { context?: Response }).context?.json?.().catch(() => null))?.error ?? e.message)
    const out = res as { items: { id: string; pl: string }[]; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number } }
    for (const it of out.items) {
      const { error: ue } = await supabase.from('exercises').update({ cues: it.pl.trim(), cues_lang: 'pl' }).eq('id', it.id)
      if (ue) throw ue
    }
    if (out.usage) usd += (out.usage.input_tokens * PRICE[model][0] + out.usage.output_tokens * PRICE[model][1]) / 1e6
    done += batch.length
    onProgress(done, rows.length, usd)
  }
  return { done, usd }
}
