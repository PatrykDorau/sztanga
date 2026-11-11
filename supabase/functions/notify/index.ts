// Powiadomienia push dla trenerki: prośba o trening, przełożenie, odwołanie (klient zalogowany)
// i wybór stałego terminu z linku (nowa osoba / klient bez konta – po tokenie linku).
// Treść składa serwer z danych w bazie – wywołujący podaje tylko, co się stało i której sesji dotyczy.
import webpush from 'npm:web-push@3.6.7'
import { admin, cors, json, TZ } from '../_shared/google.ts'

const PUB = Deno.env.get('VAPID_PUBLIC_KEY')
const PRIV = Deno.env.get('VAPID_PRIVATE_KEY')
if (PUB && PRIV) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:powiadomienia@example.com', PUB, PRIV)

function when(iso: string) {
  const d = new Date(iso)
  const p = Object.fromEntries(new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.weekday} ${p.day}.${p.month}, ${p.hour}:${p.minute}`
}
const WEEKDAY = ['', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.']
const slotText = (s: { weekday: number; start_time: string }) => `${WEEKDAY[s.weekday]} ${s.start_time}`

type Msg = { title: string; body: string; url: string; tag: string }

async function sendToTrainers(msg: Msg) {
  if (!PUB || !PRIV) return { sent: 0, reason: 'brak kluczy VAPID' }
  const db = admin()
  const { data: trainers } = await db.from('profiles').select('id').eq('role', 'trainer')
  const ids = (trainers ?? []).map((t) => t.id)
  if (!ids.length) return { sent: 0 }
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ids)
  let sent = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 86400 })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      // subskrypcja wygasła albo przeglądarka ją usunęła – sprzątamy
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id)
    }
  }
  return { sent }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json().catch(() => ({}))
    if (body.action === 'key') return json({ key: PUB ?? null })

    const db = admin()
    if (body.action === 'session') {
      // Zalogowany klient: tylko o swojej sesji.
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data: u } = await db.auth.getUser(jwt)
      if (!u?.user) return json({ error: 'Brak logowania' }, 401)
      const { data: s } = await db.from('sessions').select('id, starts_at, status, cancel_reason, moved_from, weekly_request, client_id, clients(full_name, user_id)').eq('id', String(body.session_id)).maybeSingle()
      const c = (s as unknown as { clients: { full_name: string; user_id: string | null } } | null)?.clients
      if (!s || c?.user_id !== u.user.id) return json({ error: 'Nie znaleziono sesji' }, 404)
      const name = c.full_name
      let msg: Msg
      if (body.type === 'cancel') {
        msg = { title: 'Odwołanie treningu', body: `${name} – ${when(s.starts_at)}${s.cancel_reason ? ` („${s.cancel_reason}”)` : ''}`, url: '/grafik', tag: `s-${s.id}` }
      } else if (s.moved_from) {
        const { data: old } = await db.from('sessions').select('starts_at').eq('id', s.moved_from).maybeSingle()
        msg = { title: 'Prośba o przełożenie', body: `${name}: ${old ? when(old.starts_at) : '?'} → ${when(s.starts_at)}`, url: '/grafik', tag: `s-${s.id}` }
      } else {
        msg = s.weekly_request
          ? { title: 'Prośba o stały termin', body: `${name} – co tydzień od ${when(s.starts_at)}`, url: '/grafik', tag: `s-${s.id}` }
          : { title: 'Prośba o termin', body: `${name} – ${when(s.starts_at)}`, url: '/grafik', tag: `s-${s.id}` }
      }
      return json(await sendToTrainers(msg))
    }

    if (body.action === 'offer') {
      // Link bez konta: dowodem jest token propozycji, i to tylko gdy właśnie dokonano wyboru.
      const { data: o } = await db.from('reschedule_offers').select('id, status, chosen, preferred, backup, client_id, contact_name, prospect_name, chosen_at, clients(full_name)').eq('token', String(body.token)).maybeSingle()
      if (!o || o.status !== 'chosen' || !o.chosen_at || Date.now() - new Date(o.chosen_at).getTime() > 10 * 60_000) return json({ error: 'Brak świeżego wyboru' }, 404)
      const name = (o as unknown as { clients: { full_name: string } | null }).clients?.full_name ?? o.contact_name ?? o.prospect_name ?? 'Nowa osoba'
      const pref = (o.preferred ?? (o.chosen ? [o.chosen] : [])) as { weekday: number; start_time: string }[]
      const extra = (o.backup ?? []).length ? ` (+${(o.backup ?? []).length} rezerwowe)` : ''
      return json(
        await sendToTrainers({
          title: o.client_id ? 'Wybór nowego stałego terminu' : 'Nowa osoba wybrała terminy',
          body: `${name}: ${pref.map(slotText).join(', ')}${extra}`,
          url: '/grafik/zgloszenia',
          tag: `o-${o.id}`,
        }),
      )
    }
    return json({ error: 'Nieznana akcja' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
