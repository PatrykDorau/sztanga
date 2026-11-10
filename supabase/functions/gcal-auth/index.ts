// Połączenie Google Calendar trenerki (OAuth 2.0, offline access).
//  POST {return_to}  (z aplikacji, nagłówek Authorization trenerki) → { url } do zgody Google
//  GET  ?code&state  (przekierowanie z Google) → zapis tokenów → powrót do aplikacji
import { admin, AUTH_URL, cors, googleCreds, isTrainer, json, randomToken, SYNC_URL } from '../_shared/google.ts'

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
].join(' ')

// Dokąd wolno wrócić po zgodzie – lokalny dev + adresy z sekretu APP_ORIGINS (np. "https://trener.example.pl").
function allowedOrigin(returnTo: string) {
  try {
    const o = new URL(returnTo).origin
    const extra = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    return ['http://localhost:3000', ...extra].includes(o) ? o : null
  } catch {
    return null
  }
}

function back(origin: string | null, query: string) {
  return new Response(null, { status: 302, headers: { Location: `${origin ?? 'http://localhost:3000'}/grafik/google?${query}` } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = admin()

  try {
    if (req.method === 'POST') {
      if (!(await isTrainer(req.headers.get('Authorization')))) return json({ error: 'Tylko trenerka może połączyć kalendarz' }, 403)
      const { return_to } = await req.json().catch(() => ({}))
      const origin = allowedOrigin(String(return_to ?? ''))
      if (!origin) return json({ error: 'Niedozwolony adres powrotu – dodaj go do sekretu APP_ORIGINS' }, 400)

      const state = randomToken()
      await db
        .from('google_connection')
        .update({ oauth_state: state, oauth_state_expires: new Date(Date.now() + 10 * 60_000).toISOString(), oauth_return_to: origin })
        .eq('id', 1)

      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({
        client_id: googleCreds().id,
        redirect_uri: AUTH_URL,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent', // zawsze zwraca refresh token
        include_granted_scopes: 'true',
        state,
      }).toString()
      return json({ url: url.toString() })
    }

    // GET – powrót z Google
    const p = new URL(req.url).searchParams
    const { data: g } = await db.from('google_connection').select('oauth_state, oauth_state_expires, oauth_return_to').eq('id', 1).single()
    const origin = g?.oauth_return_to ?? null
    if (p.get('error')) return back(origin, 'blad=' + encodeURIComponent(p.get('error')!))
    if (!p.get('state') || p.get('state') !== g?.oauth_state || new Date(g?.oauth_state_expires ?? 0) < new Date()) {
      return back(origin, 'blad=state')
    }

    const { id, secret } = googleCreds()
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, code: p.get('code') ?? '', redirect_uri: AUTH_URL, grant_type: 'authorization_code' }),
    })
    const tok = await res.json()
    if (!res.ok || !tok.refresh_token) return back(origin, 'blad=token')

    // E-mail konta z id_token (przyszedł bezpośrednio z Google po TLS – tylko do wyświetlenia).
    let email: string | null = null
    try {
      email = JSON.parse(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? null
    } catch {
      /* brak e-maila nie blokuje połączenia */
    }

    await db
      .from('google_connection')
      .update({
        refresh_token: tok.refresh_token,
        access_token: tok.access_token,
        access_token_expires: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
        email,
        sync_token: null,
        oauth_state: null,
        oauth_state_expires: null,
        connected_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', 1)

    // Pierwszy import od razu (nie czekamy na wynik).
    const { data: secretVal } = await db.rpc('gcal_sync_secret')
    fetch(SYNC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-secret': String(secretVal) }, body: '{"reason":"connected"}' }).catch(() => null)

    return back(origin, 'polaczono=1')
  } catch (e) {
    console.error(e)
    return req.method === 'POST' ? json({ error: (e as Error).message }, 500) : back(null, 'blad=serwer')
  }
})
