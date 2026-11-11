// Widok klienta: które sekcje aplikacji klient widzi (trenerka ustawia na karcie klienta, kolumna clients.client_view).
// To wybór tego, co pokazać – nie zabezpieczenie: klient i tak ma prawo do swoich danych.
import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'

export type ViewKey = 'plan' | 'sessions' | 'exercises' | 'progress' | 'records' | 'history' | 'measurements' | 'analyses'
export const VIEW_SECTIONS: { key: ViewKey; label: string; hint: string; def: boolean }[] = [
  { key: 'plan', label: 'Plan treningowy', hint: 'aktywny i zakończone plany', def: true },
  { key: 'sessions', label: 'Terminy', hint: 'najbliższe sesje, zapisy i odwołania', def: true },
  { key: 'exercises', label: 'Baza ćwiczeń', hint: 'opisy, filmy i animacje ćwiczeń', def: true },
  { key: 'progress', label: 'Wykresy ćwiczeń', hint: 'ciężar i objętość każdego ćwiczenia', def: true },
  { key: 'records', label: 'Rekordy', hint: 'najlepsze ciężary', def: true },
  { key: 'history', label: 'Historia treningów', hint: 'odbyte sesje z seriami', def: true },
  { key: 'measurements', label: 'Pomiary i testy', hint: 'waga, obwody, testy sprawności', def: false },
  { key: 'analyses', label: 'Analizy ruchu', hint: 'nagrania z kamery i uwagi', def: false },
]
export type ClientView = Partial<Record<ViewKey, boolean>>
export const shows = (cv: ClientView | null | undefined, k: ViewKey) => cv?.[k] ?? VIEW_SECTIONS.find((s) => s.key === k)!.def
export const PROGRESS_KEYS: ViewKey[] = ['progress', 'records', 'history', 'measurements', 'analyses']

// ----- Po stronie klienta: własna karta (RLS zwraca tylko jego rekord) -----
const mine = ref<{ id: string; client_view: ClientView } | null>(null)
let loading: Promise<void> | null = null
export function loadMyView(force = false) {
  if (force) loading = null
  loading ??= (async () => {
    const { data } = await supabase.from('clients').select('id, client_view').limit(1).maybeSingle()
    mine.value = (data as typeof mine.value) ?? null
  })()
  return loading
}
export const myClientId = computed(() => mine.value?.id ?? null)
export const myView = (k: ViewKey) => shows(mine.value?.client_view, k)
export const myProgressAny = computed(() => PROGRESS_KEYS.some((k) => shows(mine.value?.client_view, k)))
export function resetMyView() {
  mine.value = null
  loading = null
}
