// Ustawienia aplikacji (tabela app_settings, jeden wiersz) – przełączniki funkcji dla trenerki.
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

/** Zgody rodzica (formularz w raporcie i sekcja na karcie dziecka). Domyślnie wyłączone. */
export const parentConsent = ref(false)
let loaded: Promise<void> | null = null

export function loadAppSettings(force = false) {
  if (loaded && !force) return loaded
  loaded = (async () => {
    const { data } = await supabase.from('app_settings').select('parent_consent').eq('id', 1).maybeSingle()
    parentConsent.value = !!data?.parent_consent
  })().catch(() => {
    loaded = null
  })
  return loaded
}

export async function setParentConsent(v: boolean) {
  const { error } = await supabase.from('app_settings').update({ parent_consent: v, updated_at: new Date().toISOString() }).eq('id', 1)
  if (error) throw error
  parentConsent.value = v
}
