// Faza 6: dane sportowców i dzieci – ankiety gotowości, obciążenie sesji, linki bez konta, zgody, wyzwania drużynowe.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type { LoadLog, Readiness } from '@/lib/sport'

function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

export interface ClientLink {
  id: string
  client_id: string
  purpose: 'readiness' | 'parent'
  token: string
  created_at: string
  revoked_at: string | null
}
export interface Consent {
  id: string
  client_id: string
  kind: 'parent_data' | 'health' | 'video' | 'results_sharing'
  granted_by: string
  source: 'trainer' | 'link'
  granted_at: string
  revoked_at: string | null
}
export const CONSENT_LABEL: Record<Consent['kind'], string> = {
  parent_data: 'Przetwarzanie danych dziecka',
  health: 'Dane o zdrowiu (kontuzje, ograniczenia)',
  video: 'Nagrania wideo do analizy ruchu',
  results_sharing: 'Udostępnianie wyników rodzicowi przez link',
}
export interface Challenge {
  id: string
  title: string
  description: string | null
  unit: string
  team_target: number
  starts_on: string
  ends_on: string
  challenge_entries?: { client_id: string; value: number }[]
}
export type LoadRow = LoadLog & { id: string; client_id: string }

export const useSportStore = defineStore('sport', () => {
  const readiness = ref<Readiness[]>([])

  /** Ankiety z okresu (dla panelu: wszyscy; dla karty: jeden klient). */
  async function loadReadiness(from: string, clientId?: string) {
    let q = supabase.from('readiness').select('*').gte('day', from).order('day')
    if (clientId) q = q.eq('client_id', clientId)
    const rows = ok(await q) as Readiness[]
    const keep = readiness.value.filter((r) => (clientId ? r.client_id !== clientId : false) || r.day < from)
    readiness.value = [...keep, ...rows]
    return rows
  }
  async function saveReadiness(r: Readiness) {
    const row = ok(
      await supabase
        .from('readiness')
        .upsert({ ...r, id: undefined, source: 'trainer' }, { onConflict: 'client_id,day' })
        .select('*')
        .single(),
    ) as Readiness
    readiness.value = [...readiness.value.filter((x) => !(x.client_id === r.client_id && x.day === r.day)), row]
    return row
  }

  async function loads(clientId: string, from: string): Promise<LoadRow[]> {
    return ok(
      await supabase.from('session_logs').select('id, client_id, started_at, finished_at, srpe, duration_min').eq('client_id', clientId).gte('started_at', from).order('started_at'),
    ) as LoadRow[]
  }
  async function setLoad(logId: string, patch: { srpe?: number | null; duration_min?: number | null }) {
    ok(await supabase.from('session_logs').update(patch).eq('id', logId))
  }

  // ----- Linki bez konta -----
  async function link(clientId: string, purpose: ClientLink['purpose'], create = false): Promise<ClientLink | null> {
    const rows = ok(
      await supabase.from('client_links').select('*').eq('client_id', clientId).eq('purpose', purpose).is('revoked_at', null).order('created_at', { ascending: false }).limit(1),
    ) as ClientLink[]
    if (rows[0] || !create) return rows[0] ?? null
    return ok(await supabase.from('client_links').insert({ client_id: clientId, purpose }).select('*').single()) as ClientLink
  }
  async function revokeLink(id: string) {
    ok(await supabase.from('client_links').update({ revoked_at: new Date().toISOString() }).eq('id', id))
  }
  const linkUrl = (l: ClientLink) => `${location.origin}/${l.purpose === 'readiness' ? 'g' : 'r'}/${l.token}`

  // ----- Zgody -----
  async function consents(clientId: string) {
    return ok(await supabase.from('consents').select('*').eq('client_id', clientId).order('granted_at', { ascending: false })) as Consent[]
  }
  async function addConsent(clientId: string, kind: Consent['kind'], grantedBy: string) {
    ok(await supabase.from('consents').insert({ client_id: clientId, kind, granted_by: grantedBy.trim(), source: 'trainer' }))
  }
  async function revokeConsent(id: string) {
    ok(await supabase.from('consents').update({ revoked_at: new Date().toISOString() }).eq('id', id))
  }

  // ----- Wyzwania -----
  async function challenges() {
    return ok(await supabase.from('challenges').select('*, challenge_entries(client_id, value)').order('starts_on', { ascending: false }).limit(50)) as Challenge[]
  }
  async function createChallenge(c: Omit<Challenge, 'id' | 'challenge_entries'>) {
    return ok(await supabase.from('challenges').insert(c).select('*, challenge_entries(client_id, value)').single()) as Challenge
  }
  async function removeChallenge(id: string) {
    ok(await supabase.from('challenges').delete().eq('id', id))
  }
  async function setEntry(challengeId: string, clientId: string, value: number | null) {
    if (value == null) ok(await supabase.from('challenge_entries').delete().eq('challenge_id', challengeId).eq('client_id', clientId))
    else ok(await supabase.from('challenge_entries').upsert({ challenge_id: challengeId, client_id: clientId, value }, { onConflict: 'challenge_id,client_id' }))
  }

  return { readiness, loadReadiness, saveReadiness, loads, setLoad, link, revokeLink, linkUrl, consents, addConsent, revokeConsent, challenges, createChallenge, removeChallenge, setEntry }
})
