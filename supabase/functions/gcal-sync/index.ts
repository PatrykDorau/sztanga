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

const PAST_DAYS = 60 // pełny import: od 60 dni wstecz (historia sesji do dashboardu)
const FUTURE_DAYS = 180 // … do pół roku naprzód (cykliczne wydarzenia bez końca dawałyby lata wystąpień)
const REFRESH_DAYS = 90 // gdy okno importu kończy się bliżej niż za tyle dni – pełny import z nowym oknem
const MAX_EVENTS = 400 // na jedno wywołanie (limit CPU funkcji) – reszta w kolejnym, od zapisanej strony
// Odwołane w aplikacji: wydarzenie zostaje w Google z tym dopiskiem, grafitowe, „dostępny” – usuwa je trenerka z panelu.
const CANCELLED_PREFIX = 'ODWOŁANE · '
const CANCELLED_COLOR = '8' // grafit
const FROM_APP = 'Aplikacja' // dopisek (opis wydarzenia) – widać, co dodała aplikacja
const stamp = () => new Date().toLocaleString('pl-PL', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const isCancelledTitle = (t: string) => /^odwo[łl]ane\b/i.test(t.trim())

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

async function pull(db: SupabaseClient, token: string, calendarId: string, gyms: Gym[]): Promise<{ processed: number; partial: boolean }> {
  const [{ data: g }, { data: clients }, { data: aliasRows }] = await Promise.all([
    db.from('google_connection').select('sync_token, sync_window_end, import_page_token, import_time_min, import_time_max').eq('id', 1).single(),
    db.from('clients').select('id, full_name').eq('archived', false),
    db.from('client_aliases').select('alias_norm, client_id'),
  ])
  const aliases = new Map<string, string | null>((aliasRows ?? []).map((a) => [a.alias_norm, a.client_id]))
  const clientList = (clients ?? []) as ClientRef[]

  let syncToken: string | null = g?.sync_token ?? null
  // Okno pełnego importu się kończy – zaczynamy pełny import od nowa (z nowym oknem).
  if (syncToken && (!g?.sync_window_end || new Date(g.sync_window_end).getTime() < Date.now() + REFRESH_DAYS * 864e5)) syncToken = null
  // Pełny import przerwany wcześniej (limit) – kontynuujemy od zapisanej strony, z tym samym oknem.
  let pageToken: string | undefined = !syncToken ? (g?.import_page_token ?? undefined) : undefined
  let win = { min: g?.import_time_min as string | null, max: g?.import_time_max as string | null }
  if (!syncToken && !pageToken) {
    win = { min: new Date(Date.now() - PAST_DAYS * 864e5).toISOString(), max: new Date(Date.now() + FUTURE_DAYS * 864e5).toISOString() }
    await db.from('google_connection').update({ import_time_min: win.min, import_time_max: win.max, import_page_token: null }).eq('id', 1)
  }
  let nextSyncToken: string | undefined
  let processed = 0

  for (;;) {
    const query: Record<string, string> = { singleEvents: 'true', showDeleted: 'true', maxResults: '250' }
    if (pageToken) query.pageToken = pageToken
    if (syncToken) query.syncToken = syncToken
    else {
      query.timeMin = win.min ?? new Date(Date.now() - PAST_DAYS * 864e5).toISOString()
      query.timeMax = win.max ?? new Date(Date.now() + FUTURE_DAYS * 864e5).toISOString()
    }

    let page: { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }
    try {
      page = await gapi(token, `${calPath(calendarId)}/events`, { query })
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 410 && (syncToken || pageToken)) {
        // Token synchronizacji (albo strony) wygasł – pełny import od nowa.
        syncToken = null
        pageToken = undefined
        win = { min: new Date(Date.now() - PAST_DAYS * 864e5).toISOString(), max: new Date(Date.now() + FUTURE_DAYS * 864e5).toISOString() }
        await db.from('google_connection').update({ sync_token: null, import_page_token: null, import_time_min: win.min, import_time_max: win.max }).eq('id', 1)
        continue
      }
      throw e
    }
    const items = page.items ?? []
    // Jedno zapytanie o sesje powiązane z całą stroną i zbiorcze zapisy kopii wydarzeń – mniej pracy na wydarzenie.
    const linkedMap = new Map<string, Linked>()
    for (let i = 0; i < items.length; i += 100) {
      const ids = items.slice(i, i + 100).map((x) => x.id)
      const { data: ls } = await db.from('sessions').select('id, status, gcal_dirty, starts_at, gcal_event_id').in('gcal_event_id', ids)
      for (const l of (ls ?? []) as (Linked & { gcal_event_id: string })[]) linkedMap.set(l.gcal_event_id, l)
    }
    const ops: Ops = { del: [], up: [] }
    for (const ev of items) {
      const recolor = await applyEvent(db, ev, gyms, clientList, aliases, linkedMap.get(ev.id) ?? null, ops)
      // Trening wpisany ręcznie w Google dostaje kolor swojej siłowni (sam tytuł zostaje bez zmian).
      if (recolor) {
        await gapi(token, `${calPath(calendarId)}/events/${encodeURIComponent(ev.id)}`, { method: 'PATCH', body: JSON.stringify({ colorId: String(recolor) }) }).catch((e) =>
          console.error('recolor', e),
        )
      }
      processed++
    }
    await flushOps(db, ops)
    if (page.nextPageToken) {
      pageToken = page.nextPageToken
      // Limit na jedno wywołanie: zapisz stronę pełnego importu i dokończ w następnym.
      if (!syncToken && processed >= MAX_EVENTS) {
        await db.from('google_connection').update({ import_page_token: pageToken }).eq('id', 1)
        return { processed, partial: true }
      }
    } else {
      nextSyncToken = page.nextSyncToken
      break
    }
  }
  if (nextSyncToken) {
    const done = !syncToken // koniec pełnego importu – zapamiętaj okno
    await db
      .from('google_connection')
      .update({ sync_token: nextSyncToken, import_page_token: null, ...(done ? { sync_window_end: win.max } : {}) })
      .eq('id', 1)
  }
  return { processed, partial: false }
}

interface Linked {
  id: string
  status: string
  gcal_dirty: boolean
  starts_at: string
}
interface Ops {
  del: string[]
  up: Record<string, unknown>[]
}
async function flushOps(db: SupabaseClient, ops: Ops) {
  // To samo wydarzenie mogło być na stronie dwa razy – liczy się ostatni stan.
  const last = new Map<string, Record<string, unknown> | null>()
  for (const id of ops.del) last.set(id, null)
  for (const r of ops.up) last.set(r.gcal_event_id as string, r)
  const del = [...last].filter(([, r]) => !r).map(([id]) => id)
  const up = [...last.values()].filter((r): r is Record<string, unknown> => !!r)
  for (let i = 0; i < del.length; i += 200) await db.from('calendar_events').delete().in('gcal_event_id', del.slice(i, i + 200))
  for (let i = 0; i < up.length; i += 200) await db.from('calendar_events').upsert(up.slice(i, i + 200))
}

/** Zwraca colorId, jeśli wydarzenie-trening trzeba przekolorować na kolor siłowni. */
async function applyEvent(
  db: SupabaseClient,
  e: GEvent,
  gyms: Gym[],
  clients: ClientRef[],
  aliases: Map<string, string | null>,
  linked: Linked | null,
  ops: Ops,
): Promise<number | null> {
  const now = new Date().toISOString()
  const unmirror = () => void ops.del.push(e.id)
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
    unmirror()
    return null
  }
  const t = eventTimes(e)
  if (!t) return null
  const title = (e.summary ?? '').trim()
  const colorId = e.colorId ? Number(e.colorId) : null
  const gym = gymFor(title, colorId, gyms)

  // Zajęcia grupowe wysłane z aplikacji – są już w grafiku (tabela group_classes), nie dublujemy ich jako „zajęte”.
  if (e.extendedProperties?.private?.trenerGroupId) {
    unmirror()
    return null
  }

  // Oznaczone jako odwołane (przez aplikację albo ręcznie) – nie blokuje grafiku i nie tworzy sesji.
  if (isCancelledTitle(title)) {
    await cancelLinked('Odwołane w Google Calendar')
    unmirror()
    return null
  }

  // "Pokaż jako: dostępny" (domyślne dla całodniowych) – nie blokuje grafiku.
  if (e.transparency === 'transparent' && !isFree(title)) {
    await cancelLinked('Zmienione w Google Calendar')
    unmirror()
    return null
  }

  const mirror = (kind: 'free' | 'busy' | 'unmatched') =>
    void ops.up.push({
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
    return null
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
    unmirror()
    return gym && colorId !== gym.color_id ? gym.color_id : null
  }

  // Nie klient: kandydat do przypisania albo prywatne "Zajęte".
  await cancelLinked('Zmienione w Google Calendar')
  const gymColors = new Set(gyms.map((g) => g.color_id))
  const candidate =
    match !== 'ignored' && !t.allDay && looksLikePerson(splitTitle(title).base) && (splitTitle(title).code !== null || colorId === null || gymColors.has(colorId))
  await mirror(candidate ? 'unmatched' : 'busy')
  return null
}

// ===================== Eksport: aplikacja → Google =====================
async function push(db: SupabaseClient, token: string, calendarId: string, gyms: Gym[]) {
  const base = `${calPath(calendarId)}/events`
  const now = () => new Date().toISOString()
  let n = 0

  const gone = (e: unknown) => e instanceof GoogleApiError && [404, 410].includes(e.status)
  /** Oznacz wydarzenie jako odwołane (bez usuwania) i dopisz je do listy w panelu. */
  const markCancelled = async (eventId: string, info: { title?: string | null; starts?: string; ends?: string; sessionId?: string | null; restoreFree: boolean; reason: 'cancelled' | 'deleted' }) => {
    const path = `${base}/${encodeURIComponent(eventId)}`
    let ev: GEvent | null = null
    try {
      ev = await gapi<GEvent>(token, path)
    } catch (e) {
      if (gone(e)) return // już nie ma w Google
      throw e
    }
    if (ev.status === 'cancelled') return
    const old = (ev.summary ?? info.title ?? '').trim()
    const title = isCancelledTitle(old) ? old : `${CANCELLED_PREFIX}${old}`
    await gapi(token, path, {
      method: 'PATCH',
      body: JSON.stringify({
        summary: title,
        description: `${FROM_APP} · odwołane ${stamp()}`,
        colorId: CANCELLED_COLOR,
        transparency: 'transparent',
        status: 'confirmed',
        extendedProperties: { private: { trenerSessionId: '', trenerGroupId: '' } },
      }),
    })
    await db.from('gcal_cancelled').upsert({
      gcal_event_id: eventId,
      title: isCancelledTitle(old) ? old.replace(/^odwo[łl]ane\s*·?\s*/i, '') : old,
      starts_at: ev.start?.dateTime ?? info.starts ?? null,
      ends_at: ev.end?.dateTime ?? info.ends ?? null,
      session_id: info.sessionId ?? null,
      restore_free: info.restoreFree,
      reason: info.reason,
      action: null,
    })
    await db.from('calendar_events').delete().eq('gcal_event_id', eventId)
  }

  // 0) Decyzje z panelu „Odwołane w kalendarzu”: usuń z Google (albo przywróć „Free”) / zostaw.
  const { data: decided } = await db.from('gcal_cancelled').select('gcal_event_id, restore_free, action').not('action', 'is', null)
  for (const d of decided ?? []) {
    if (d.action === 'delete') {
      const path = `${base}/${encodeURIComponent(d.gcal_event_id)}`
      try {
        if (d.restore_free) await gapi(token, path, { method: 'PATCH', body: JSON.stringify({ summary: 'Free', status: 'confirmed', colorId: null, transparency: 'opaque' }) })
        else await gapi(token, path, { method: 'DELETE' })
      } catch (e) {
        if (!gone(e)) throw e
      }
    }
    await db.from('gcal_cancelled').delete().eq('gcal_event_id', d.gcal_event_id)
    n++
  }

  // 1) Sesje usunięte w aplikacji – oznaczamy, nie usuwamy.
  const { data: dels } = await db.from('gcal_deletions').select('gcal_event_id, restore_free')
  for (const d of dels ?? []) {
    await markCancelled(d.gcal_event_id, { restoreFree: d.restore_free, reason: 'deleted' })
    await db.from('gcal_deletions').delete().eq('gcal_event_id', d.gcal_event_id)
    n++
  }

  // 2) Sesje zmienione w aplikacji + przyszłe sesje sprzed podłączenia Google (nigdy niesynchronizowane).
  const { data: dirty } = await db
    .from('sessions')
    .select('id, client_id, starts_at, ends_at, status, gym_id, gcal_event_id, from_free_event, clients(full_name)')
    .or(`gcal_dirty.eq.true,and(gcal_synced_at.is.null,gcal_event_id.is.null,status.in.(pending,confirmed),starts_at.gt.${now()})`)
    .order('starts_at')
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
      description: FROM_APP,
      extendedProperties: { private: { trenerSessionId: s.id } },
    }
    const done = (patch: Record<string, unknown> = {}) =>
      db.from('sessions').update({ gcal_dirty: false, gcal_synced_at: now(), ...patch }).eq('id', s.id)

    try {
      if (s.status === 'cancelled') {
        // Odwołana w aplikacji – w Google zostaje jako „ODWOŁANE · …” do decyzji trenerki (panel).
        if (s.gcal_event_id) {
          await markCancelled(s.gcal_event_id, { title: body.summary, starts: s.starts_at, ends: s.ends_at, sessionId: s.id, restoreFree: !!s.from_free_event, reason: 'cancelled' })
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

  // 3) Zajęcia grupowe z aplikacji (siłowy, obwód, core…): tytuł „Obwód (BW)”, kolor siłowni, dopisek „Aplikacja”.
  const { data: groups } = await db
    .from('group_classes')
    .select('id, starts_at, ends_at, gym_id, kind, cancelled, gcal_event_id')
    .eq('gcal_dirty', true)
    .order('starts_at')
    .limit(100)
  for (const c of (groups ?? []) as any[]) {
    const gym = gyms.find((g) => g.id === c.gym_id) ?? gyms.find((g) => g.is_default) ?? null
    const done = (patch: Record<string, unknown> = {}) => db.from('group_classes').update({ gcal_dirty: false, gcal_synced_at: now(), ...patch }).eq('id', c.id)
    const body = {
      summary: eventTitle(c.kind, gym?.code ?? null),
      start: { dateTime: c.starts_at, timeZone: TZ },
      end: { dateTime: c.ends_at, timeZone: TZ },
      colorId: gym ? String(gym.color_id) : undefined,
      status: 'confirmed',
      description: `${FROM_APP} · zajęcia grupowe`,
      extendedProperties: { private: { trenerGroupId: c.id } },
    }
    try {
      if (c.cancelled) {
        if (c.gcal_event_id) await markCancelled(c.gcal_event_id, { title: body.summary, starts: c.starts_at, ends: c.ends_at, restoreFree: false, reason: 'cancelled' })
        await done({ gcal_event_id: null })
      } else if (c.gcal_event_id) {
        await gapi(token, `${base}/${encodeURIComponent(c.gcal_event_id)}`, { method: 'PATCH', body: JSON.stringify(body) })
        await done()
      } else {
        const created = await gapi<{ id: string }>(token, base, { method: 'POST', body: JSON.stringify(body) })
        await done({ gcal_event_id: created.id })
      }
      n++
    } catch (e) {
      if (gone(e) && c.gcal_event_id) await db.from('group_classes').update({ gcal_event_id: null }).eq('id', c.id)
      else throw e
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
    let partial = false
    try {
      for (let round = 0; round < 3; round++) {
        const r = await pull(db, token, calendarId, gyms)
        pulled += r.processed
        partial = r.partial
        if (partial) break // pełny import w toku – wysyłka i reszta po jego zakończeniu
        pushed += await push(db, token, calendarId, gyms)
        const { data: again } = await db.from('google_connection').select('sync_requested').eq('id', 1).single()
        if (!again?.sync_requested) break
        await db.from('google_connection').update({ sync_requested: false }).eq('id', 1)
      }
      if (!partial) {
        await ensureWatch(db, token, calendarId).catch((e) => console.error('watch', e))
        await db.from('google_connection').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('id', 1)
      }
    } finally {
      await db.from('google_connection').update({ sync_lock_until: null }).eq('id', 1)
    }
    // Import w porcjach: od razu następna porcja (blokada już zwolniona).
    if (partial) await db.rpc('kick_gcal_sync', { reason: 'import' }).then(() => null, (e: unknown) => console.error('kick', e))
    return json({ ok: true, pulled, pushed, partial })
  } catch (e) {
    console.error(e)
    const msg = e instanceof GoogleAuthError ? e.message : `Błąd synchronizacji: ${(e as Error).message}`
    await db.from('google_connection').update({ last_error: msg }).eq('id', 1)
    return json({ error: msg }, e instanceof GoogleAuthError ? 409 : 500)
  }
})
