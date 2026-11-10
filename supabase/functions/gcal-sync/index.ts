// Dwustronna synchronizacja Google Calendar ↔ aplikacja.
// Wywoływana przez: bazę (zmiana sesji, pg_net), cron co 5 min, powiadomienia Google (webhook),
// aplikację (przycisk "Synchronizuj teraz" / lista kalendarzy – nagłówek Authorization trenerki).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'
import {
  accessToken,
  admin,
  calPath,
  cors,
  gapi,
  GoogleApiError,
  GoogleAuthError,
  isTrainer,
  json,
  randomToken,
  SYNC_URL,
  TZ,
} from '../_shared/google.ts'
import { eventTitle, gymFor, isFree, looksLikePerson, matchClient, splitTitle, type ClientRef, type Gym } from '../_shared/titles.ts'

interface GEvent {
  id: string
  status: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  colorId?: string
  transparency?: 'opaque' | 'transparent'
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  extendedProperties?: { private?: Record<string, string> }
}

const PAST_DAYS = 60 // pierwszy import: od 60 dni wstecz (historia sesji do dashboardu)

// ===================== Autoryzacja wywołania =====================
async function authorize(req: Request, db: SupabaseClient): Promise<'internal' | 'google' | 'trainer' | null> {
  const secret = req.headers.get('x-sync-secret')
  if (secret) {
    const { data } = await db.rpc('gcal_sync_secret')
    return secret === data ? 'internal' : null
  }
  const channelToken = req.headers.get('x-goog-channel-token')
  if (channelToken) {
    const { data } = await db.from('google_connection').select('channel_token').eq('id', 1).single()
    return data?.channel_token && channelToken === data.channel_token ? 'google' : null
  }
  return (await isTrainer(req.headers.get('Authorization'))) ? 'trainer' : null
}

// ===================== Blokada (jedna synchronizacja naraz) =====================
async function acquireLock(db: SupabaseClient) {
  const now = new Date().toISOString()
  const { data } = await db
    .from('google_connection')
    .update({ sync_lock_until: new Date(Date.now() + 120_000).toISOString(), sync_requested: false })
    .eq('id', 1)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${now}`)
    .select('id')
  if (data?.length) return true
  // Trwa inna synchronizacja – poproś ją o jeszcze jedno przejście.
  await db.from('google_connection').update({ sync_requested: true }).eq('id', 1)
  return false
}

// ===================== Import: Google → aplikacja =====================
function eventTimes(e: GEvent) {
  if (e.start?.dateTime && e.end?.dateTime) return { starts: e.start.dateTime, ends: e.end.dateTime, allDay: false }
  if (e.start?.date && e.end?.date) {
    // Wydarzenie całodniowe: północ czasu polskiego (przybliżenie strefy wystarcza do blokowania dnia).
    const toIso = (d: string) => new Date(`${d}T00:00:00+01:00`).toISOString()
    return { starts: toIso(e.start.date), ends: toIso(e.end.date), allDay: true }
  }
  return null
}

async function pull(db: SupabaseClient, token: string, calendarId: string, gyms: Gym[]) {
  const [{ data: g }, { data: clients }, { data: aliasRows }] = await Promise.all([
    db.from('google_connection').select('sync_token').eq('id', 1).single(),
    db.from('clients').select('id, full_name').eq('archived', false),
    db.from('client_aliases').select('alias_norm, client_id'),
  ])
  const aliases = new Map<string, string | null>((aliasRows ?? []).map((a) => [a.alias_norm, a.client_id]))
  const clientList = (clients ?? []) as ClientRef[]

  let syncToken: string | null = g?.sync_token ?? null
  let pageToken: string | undefined
  let nextSyncToken: string | undefined
  let processed = 0

  for (;;) {
    const query: Record<string, string> = { singleEvents: 'true', showDeleted: 'true', maxResults: '250' }
    if (pageToken) query.pageToken = pageToken
    if (syncToken) query.syncToken = syncToken
    else query.timeMin = new Date(Date.now() - PAST_DAYS * 864e5).toISOString()

    let page: { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }
    try {
      page = await gapi(token, `${calPath(calendarId)}/events`, { query })
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 410 && syncToken) {
        // Token synchronizacji wygasł – pełny import od nowa.
        syncToken = null
        pageToken = undefined
        continue
      }
      throw e
    }
    for (const ev of page.items ?? []) {
      await applyEvent(db, ev, gyms, clientList, aliases)
      processed++
    }
    if (page.nextPageToken) pageToken = page.nextPageToken
    else {
      nextSyncToken = page.nextSyncToken
      break
    }
  }
  if (nextSyncToken) await db.from('google_connection').update({ sync_token: nextSyncToken }).eq('id', 1)
  return processed
}

async function applyEvent(db: SupabaseClient, e: GEvent, gyms: Gym[], clients: ClientRef[], aliases: Map<string, string | null>) {
  const now = new Date().toISOString()
  const { data: linked } = await db.from('sessions').select('id, status, gcal_dirty, starts_at').eq('gcal_event_id', e.id).maybeSingle()
  const cancelLinked = async (reason: string) => {
    if (linked && ['pending', 'confirmed'].includes(linked.status) && linked.starts_at > now) {
      await db
        .from('sessions')
        .update({ status: 'cancelled', cancelled_at: now, cancel_reason: reason, gcal_event_id: null, gcal_synced_at: now, gcal_dirty: false })
        .eq('id', linked.id)
    } else if (linked) {
      await db.from('sessions').update({ gcal_event_id: null, gcal_synced_at: now, gcal_dirty: false }).eq('id', linked.id)
    }
  }

  // Usunięte w Google
  if (e.status === 'cancelled') {
    await cancelLinked('Usunięte w Google Calendar')
    await db.from('calendar_events').delete().eq('gcal_event_id', e.id)
    return
  }
  const t = eventTimes(e)
  if (!t) return
  const title = (e.summary ?? '').trim()
  const colorId = e.colorId ? Number(e.colorId) : null
  const gym = gymFor(title, colorId, gyms)

  // "Pokaż jako: dostępny" (domyślne dla całodniowych) – nie blokuje grafiku.
  if (e.transparency === 'transparent' && !isFree(title)) {
    await cancelLinked('Zmienione w Google Calendar')
    await db.from('calendar_events').delete().eq('gcal_event_id', e.id)
    return
  }

  const mirror = (kind: 'free' | 'busy' | 'unmatched') =>
    db.from('calendar_events').upsert({
      gcal_event_id: e.id,
      kind,
      title: title || null,
      starts_at: t.starts,
      ends_at: t.ends,
      all_day: t.allDay,
      color_id: colorId,
      gym_id: gym?.id ?? null,
      session_id: null,
      updated_at: now,
    })

  if (isFree(title)) {
    // Trenerka zwolniła termin w Google (sesja → Free) – odwołaj sesję w aplikacji.
    await cancelLinked('Zwolnione w Google Calendar (Free)')
    await mirror('free')
    return
  }

  const match = t.allDay ? null : matchClient(title, clients, aliases)
  // Wydarzenie utworzone przez aplikację, zanim zapisaliśmy jego id (np. przerwana synchronizacja).
  const appSessionId = e.extendedProperties?.private?.trenerSessionId

  if (match && match !== 'ignored') {
    const fields = {
      client_id: match,
      starts_at: t.starts,
      ends_at: t.ends,
      gym_id: gym?.id ?? null,
      gcal_event_id: e.id,
      gcal_synced_at: now,
    }
    const targetId = linked?.id ?? appSessionId
    if (targetId) {
      // Zmiana z aplikacji czeka na wysłanie – nie nadpisuj jej starszym stanem z Google.
      const { data: cur } = await db.from('sessions').select('gcal_dirty, status').eq('id', targetId).maybeSingle()
      if (cur && !cur.gcal_dirty) {
        const status = e.status === 'tentative' ? 'pending' : cur.status === 'cancelled' || cur.status === 'pending' ? 'confirmed' : cur.status
        await db.from('sessions').update({ ...fields, status }).eq('id', targetId)
      } else if (cur) {
        await db.from('sessions').update({ gcal_event_id: e.id, gcal_synced_at: now }).eq('id', targetId)
      } else {
        await db.from('sessions').insert({ ...fields, status: 'confirmed' })
      }
    } else {
      await db.from('sessions').insert({ ...fields, status: e.status === 'tentative' ? 'pending' : 'confirmed' })
    }
    await db.from('calendar_events').delete().eq('gcal_event_id', e.id)
    return
  }

  // Nie klient: kandydat do przypisania albo prywatne "Zajęte".
  await cancelLinked('Zmienione w Google Calendar')
  const gymColors = new Set(gyms.map((g) => g.color_id))
  const candidate =
    match !== 'ignored' && !t.allDay && looksLikePerson(splitTitle(title).base) && (splitTitle(title).code !== null || colorId === null || gymColors.has(colorId))
  await mirror(candidate ? 'unmatched' : 'busy')
}

// ===================== Eksport: aplikacja → Google =====================
async function push(db: SupabaseClient, token: string, calendarId: string, gyms: Gym[]) {
  const base = `${calPath(calendarId)}/events`
  const now = () => new Date().toISOString()
  let n = 0

  // 1) Sesje usunięte w aplikacji
  const { data: dels } = await db.from('gcal_deletions').select('gcal_event_id, restore_free')
  for (const d of dels ?? []) {
    try {
      if (d.restore_free) await gapi(token, `${base}/${encodeURIComponent(d.gcal_event_id)}`, { method: 'PATCH', body: JSON.stringify({ summary: 'Free', status: 'confirmed' }) })
      else await gapi(token, `${base}/${encodeURIComponent(d.gcal_event_id)}`, { method: 'DELETE' })
    } catch (e) {
      if (!(e instanceof GoogleApiError && [404, 410].includes(e.status))) throw e
    }
    await db.from('gcal_deletions').delete().eq('gcal_event_id', d.gcal_event_id)
    n++
  }

  // 2) Sesje zmienione w aplikacji
  const { data: dirty } = await db
    .from('sessions')
    .select('id, client_id, starts_at, ends_at, status, gym_id, gcal_event_id, from_free_event, clients(full_name)')
    .eq('gcal_dirty', true)
    .limit(100)
  for (const s of (dirty ?? []) as any[]) {
    const gym = gyms.find((g) => g.id === s.gym_id) ?? gyms.find((g) => g.is_default) ?? null
    const name: string = s.clients?.full_name ?? 'Klient'
    const body = {
      summary: eventTitle(name, gym?.code ?? null),
      start: { dateTime: s.starts_at, timeZone: TZ },
      end: { dateTime: s.ends_at, timeZone: TZ },
      colorId: gym ? String(gym.color_id) : undefined,
      status: s.status === 'pending' ? 'tentative' : 'confirmed',
      extendedProperties: { private: { trenerSessionId: s.id } },
    }
    const done = (patch: Record<string, unknown> = {}) =>
      db.from('sessions').update({ gcal_dirty: false, gcal_synced_at: now(), ...patch }).eq('id', s.id)

    try {
      if (s.status === 'cancelled') {
        if (s.gcal_event_id) {
          const path = `${base}/${encodeURIComponent(s.gcal_event_id)}`
          try {
            if (s.from_free_event) {
              // Termin wraca jako wolny – tak jak przed rezerwacją.
              await gapi(token, path, { method: 'PATCH', body: JSON.stringify({ summary: 'Free', status: 'confirmed', extendedProperties: { private: { trenerSessionId: '' } } }) })
            } else {
              await gapi(token, path, { method: 'DELETE' })
            }
          } catch (e) {
            if (!(e instanceof GoogleApiError && [404, 410].includes(e.status))) throw e
          }
        }
        await done({ gcal_event_id: null })
      } else if (s.gcal_event_id) {
        await gapi(token, `${base}/${encodeURIComponent(s.gcal_event_id)}`, { method: 'PATCH', body: JSON.stringify(body) })
        await done()
      } else {
        // Nowa sesja: jeśli trafia w wydarzenie "Free" – przemianuj je (jak trenerka robi to ręcznie).
        const { data: free } = await db
          .from('calendar_events')
          .select('gcal_event_id')
          .eq('kind', 'free')
          .lte('starts_at', s.starts_at)
          .gte('ends_at', s.ends_at)
          .limit(1)
          .maybeSingle()
        if (free) {
          await gapi(token, `${base}/${encodeURIComponent(free.gcal_event_id)}`, { method: 'PATCH', body: JSON.stringify(body) })
          await db.from('calendar_events').delete().eq('gcal_event_id', free.gcal_event_id)
          await done({ gcal_event_id: free.gcal_event_id, from_free_event: true })
        } else {
          const created = await gapi<{ id: string }>(token, base, { method: 'POST', body: JSON.stringify(body) })
          await done({ gcal_event_id: created.id, from_free_event: false })
        }
      }
      n++
    } catch (e) {
      if (e instanceof GoogleApiError && [404, 410].includes(e.status) && s.gcal_event_id) {
        // Wydarzenie zniknęło z Google – następnym razem utworzymy nowe.
        await db.from('sessions').update({ gcal_event_id: null }).eq('id', s.id)
      } else throw e
    }
  }
  return n
}

// ===================== Powiadomienia z Google (kanał watch) =====================
async function ensureWatch(db: SupabaseClient, token: string, calendarId: string) {
  const { data: g } = await db.from('google_connection').select('channel_id, channel_resource_id, channel_expires').eq('id', 1).single()
  if (g?.channel_expires && new Date(g.channel_expires).getTime() > Date.now() + 864e5) return
  if (g?.channel_id && g.channel_resource_id) {
    await gapi(token, '/channels/stop', { method: 'POST', body: JSON.stringify({ id: g.channel_id, resourceId: g.channel_resource_id }) }).catch(() => null)
  }
  const channelToken = randomToken()
  const res = await gapi<{ id: string; resourceId: string; expiration: string }>(token, `${calPath(calendarId)}/events/watch`, {
    method: 'POST',
    body: JSON.stringify({ id: crypto.randomUUID(), type: 'web_hook', address: SYNC_URL, token: channelToken, params: { ttl: String(7 * 86400) } }),
  })
  await db
    .from('google_connection')
    .update({ channel_id: res.id, channel_resource_id: res.resourceId, channel_token: channelToken, channel_expires: new Date(Number(res.expiration)).toISOString() })
    .eq('id', 1)
}

// ===================== Wejście =====================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = admin()
  const who = await authorize(req, db)
  if (!who) return json({ error: 'Brak uprawnień' }, 401)

  // Google wysyła najpierw "sync" (potwierdzenie kanału) – nic do zrobienia.
  if (who === 'google' && req.headers.get('x-goog-resource-state') === 'sync') return json({ ok: true })

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}

  try {
    const token = await accessToken(db)
    const { data: conn } = await db.from('google_connection').select('calendar_id').eq('id', 1).single()
    const calendarId = conn?.calendar_id ?? 'primary'

    if (body.action === 'calendars') {
      if (who !== 'trainer') return json({ error: 'Brak uprawnień' }, 403)
      const list = await gapi<{ items: any[] }>(token, '/users/me/calendarList', { query: { minAccessRole: 'writer' } })
      return json({ calendars: list.items.map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary, primary: !!c.primary, color: c.backgroundColor })) })
    }

    if (!(await acquireLock(db))) return json({ ok: true, queued: true }, 202)
    const { data: gymRows } = await db.from('gyms').select('id, code, color_id, is_default')
    const gyms = (gymRows ?? []) as Gym[]
    let pulled = 0
    let pushed = 0
    try {
      for (let round = 0; round < 3; round++) {
        pulled += await pull(db, token, calendarId, gyms)
        pushed += await push(db, token, calendarId, gyms)
        const { data: again } = await db.from('google_connection').select('sync_requested').eq('id', 1).single()
        if (!again?.sync_requested) break
        await db.from('google_connection').update({ sync_requested: false }).eq('id', 1)
      }
      await ensureWatch(db, token, calendarId).catch((e) => console.error('watch', e))
      await db.from('google_connection').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('id', 1)
    } finally {
      await db.from('google_connection').update({ sync_lock_until: null }).eq('id', 1)
    }
    return json({ ok: true, pulled, pushed })
  } catch (e) {
    console.error(e)
    const msg = e instanceof GoogleAuthError ? e.message : `Błąd synchronizacji: ${(e as Error).message}`
    await db.from('google_connection').update({ last_error: msg }).eq('id', 1)
    return json({ error: msg }, e instanceof GoogleAuthError ? 409 : 500)
  }
})
