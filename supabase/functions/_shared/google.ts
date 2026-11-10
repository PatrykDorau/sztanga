// Wspólne dla gcal-auth i gcal-sync: klient Supabase (service role), tokeny Google, wywołania API Kalendarza.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'

export const PROJECT_URL = Deno.env.get('SUPABASE_URL')!
export const SYNC_URL = `${PROJECT_URL}/functions/v1/gcal-sync`
export const AUTH_URL = `${PROJECT_URL}/functions/v1/gcal-auth`
export const TZ = 'Europe/Warsaw'

export function admin(): SupabaseClient {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!key) throw new Error('Brak SUPABASE_SERVICE_ROLE_KEY w środowisku funkcji')
  return createClient(PROJECT_URL, key, { auth: { persistSession: false } })
}

/** Klient działający jako zalogowany użytkownik (do sprawdzenia, czy to trenerka). */
export function asUser(authHeader: string): SupabaseClient {
  return createClient(PROJECT_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
}

export async function isTrainer(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return false
  const { data, error } = await asUser(authHeader).rpc('is_trainer')
  return !error && data === true
}

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export function googleCreds() {
  const id = Deno.env.get('GOOGLE_CLIENT_ID')
  const secret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  if (!id || !secret) throw new Error('Brak GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET w sekretach Edge Functions')
  return { id, secret }
}

export const randomToken = (bytes = 24) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!)

export class GoogleAuthError extends Error {}

/** Ważny access token – odświeżany z refresh tokena, zapisywany w google_connection. */
export async function accessToken(db: SupabaseClient): Promise<string> {
  const { data: g, error } = await db.from('google_connection').select('refresh_token, access_token, access_token_expires').eq('id', 1).single()
  if (error) throw error
  if (!g.refresh_token) throw new GoogleAuthError('Kalendarz Google nie jest połączony')
  if (g.access_token && g.access_token_expires && new Date(g.access_token_expires).getTime() > Date.now() + 60_000) return g.access_token

  const { id, secret } = googleCreds()
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: g.refresh_token, grant_type: 'refresh_token' }),
  })
  const body = await res.json()
  if (!res.ok) {
    if (body.error === 'invalid_grant') {
      // dostęp cofnięty albo token wygasł (aplikacja w trybie testowym Google: 7 dni) – trzeba połączyć ponownie
      await db.from('google_connection').update({ refresh_token: null, access_token: null, last_error: 'Połączenie z Google wygasło – połącz kalendarz ponownie.' }).eq('id', 1)
      throw new GoogleAuthError('Połączenie z Google wygasło')
    }
    throw new Error(`Google token: ${body.error_description ?? body.error ?? res.status}`)
  }
  await db
    .from('google_connection')
    .update({ access_token: body.access_token, access_token_expires: new Date(Date.now() + body.expires_in * 1000).toISOString() })
    .eq('id', 1)
  return body.access_token
}

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function gapi<T = any>(token: string, path: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v)
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const body = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new GoogleApiError(res.status, body?.error?.message ?? `Google API ${res.status}`)
  return body as T
}

export const calPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}`
