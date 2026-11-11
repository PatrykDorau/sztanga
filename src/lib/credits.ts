// Kredyty Anthropic (szacunek): saldo wpisane przez trenerkę z konsoli Anthropic minus koszt wywołań zapisanych od tego momentu
// (tabela ai_usage, wypełnia ją funkcja „ai”). Anthropic nie udostępnia salda konta przez zwykły klucz API.
import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface UsageRow {
  created_at: string
  action: 'ask' | 'plan' | 'translate'
  model: string
  cost_usd: number
}
export const credits = ref<{ balance: number | null; at: string | null; topup: number; spent: number; rows: UsageRow[] } | null>(null)

export async function loadCredits() {
  const { data: s } = await supabase.from('app_settings').select('credit_balance_usd, credit_balance_at, credit_topup_usd').eq('id', 1).maybeSingle()
  const at = (s?.credit_balance_at as string | null) ?? null
  let q = supabase.from('ai_usage').select('created_at, action, model, cost_usd').order('created_at', { ascending: false }).limit(2000)
  if (at) q = q.gte('created_at', at)
  const { data: rows } = await q
  const list = ((rows ?? []) as UsageRow[]).map((r) => ({ ...r, cost_usd: Number(r.cost_usd) }))
  credits.value = {
    balance: s?.credit_balance_usd != null ? Number(s.credit_balance_usd) : null,
    at,
    topup: Number(s?.credit_topup_usd ?? 5),
    spent: list.reduce((a, r) => a + r.cost_usd, 0),
    rows: list,
  }
  return credits.value
}

/** Szacowane pozostałe saldo i jego udział w doładowaniu (0..1). */
export const remaining = computed(() => (credits.value?.balance == null ? null : Math.max(0, credits.value.balance - credits.value.spent)))
export const remainingPct = computed(() => (remaining.value == null || !credits.value ? null : remaining.value / (credits.value.topup || 1)))
/** Ostrzeżenie: mniej niż 10% doładowania. */
export const lowCredits = computed(() => remainingPct.value != null && remainingPct.value < 0.1)

export async function setBalance(balance: number, topup: number) {
  const { error } = await supabase
    .from('app_settings')
    .update({ credit_balance_usd: balance, credit_balance_at: new Date().toISOString(), credit_topup_usd: topup, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw error
  await loadCredits()
}

export const usd = (n: number | null | undefined, d = 2) => (n == null ? '—' : `${n.toFixed(d).replace('.', ',')} USD`)
export const ACTION_LABEL: Record<UsageRow['action'], string> = { ask: 'Asystent', plan: 'Generator planu', translate: 'Tłumaczenie' }
