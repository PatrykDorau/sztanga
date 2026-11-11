// Ustawienia aplikacji (tabela app_settings, jeden wiersz) – przełączniki funkcji dla trenerki.
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

/** Zgody rodzica (formularz w raporcie i sekcja na karcie dziecka). Domyślnie wyłączone. */
export const parentConsent = ref(false)

/** Modele Claude: asystent (czat) i generator planu. Koszt z klucza Anthropic trenerki. */
export type AiModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5'
export const AI_MODELS: { id: AiModel; name: string; price: string; hint: string }[] = [
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', price: '0,10 / 0,50 USD', hint: 'najtańszy, szybki – wystarcza do pytań i prostych zadań' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', price: '2 / 10 USD', hint: 'dobry kompromis – staranne plany i dłuższe odpowiedzi' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', price: '4 / 20 USD', hint: 'najmocniejszy, najdroższy' },
]
export const modelAssistant = ref<AiModel>('claude-haiku-5-5')
export const modelPlan = ref<AiModel>('claude-sonnet-5-5')
let loaded: Promise<void> | null = null

export function loadAppSettings(force = false) {
  if (loaded && !force) return loaded
  loaded = (async () => {
    const { data } = await supabase.from('app_settings').select('parent_consent, model_assistant, model_plan').eq('id', 1).maybeSingle()
    parentConsent.value = !!data?.parent_consent
    if (data?.model_assistant) modelAssistant.value = data.model_assistant as AiModel
    if (data?.model_plan) modelPlan.value = data.model_plan as AiModel
  })().catch(() => {
    loaded = null
  })
  return loaded
}

export async function setModel(kind: 'assistant' | 'plan', m: AiModel) {
  const { error } = await supabase.from('app_settings').update({ [kind === 'assistant' ? 'model_assistant' : 'model_plan']: m, updated_at: new Date().toISOString() }).eq('id', 1)
  if (error) throw error
  if (kind === 'assistant') modelAssistant.value = m
  else modelPlan.value = m
}

export async function setParentConsent(v: boolean) {
  const { error } = await supabase.from('app_settings').update({ parent_consent: v, updated_at: new Date().toISOString() }).eq('id', 1)
  if (error) throw error
  parentConsent.value = v
}
