// Powiadomienia push: zapis subskrypcji tej przeglądarki/telefonu (trenerka) i zgłaszanie zdarzeń do funkcji „notify”.
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushState = ref<'unsupported' | 'off' | 'on' | 'denied' | 'nokey'>('off')

const b64 = (s: string) => {
  const p = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0))
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function refreshPushState() {
  if (!pushSupported()) return (pushState.value = 'unsupported')
  if (Notification.permission === 'denied') return (pushState.value = 'denied')
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  pushState.value = sub ? 'on' : 'off'
}

/** Włącza powiadomienia na tym urządzeniu (pyta o zgodę). */
export async function enablePush() {
  if (!pushSupported()) throw new Error('Ta przeglądarka nie obsługuje powiadomień. Na iPhonie: najpierw dodaj aplikację do ekranu początkowego.')
  const { data } = await supabase.functions.invoke('notify', { body: { action: 'key' } })
  const key = (data as { key: string | null } | null)?.key
  if (!key) {
    pushState.value = 'nokey'
    throw new Error('Powiadomienia nie są jeszcze skonfigurowane na serwerze (klucze VAPID).')
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') {
    pushState.value = perm === 'denied' ? 'denied' : 'off'
    throw new Error('Brak zgody na powiadomienia.')
  }
  const reg = (await registration()) ?? (await navigator.serviceWorker.ready)
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }))
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { data: u } = await supabase.auth.getUser()
  const { error } = await supabase.from('push_subscriptions').upsert({ user_id: u.user!.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' })
  if (error) throw error
  pushState.value = 'on'
}

export async function disablePush() {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  pushState.value = 'off'
}

/** Klient: daj znać trenerce (prośba / przełożenie / odwołanie). Błąd powiadomienia nie blokuje akcji. */
export function notifySession(type: 'request' | 'cancel', sessionId: string) {
  supabase.functions.invoke('notify', { body: { action: 'session', type, session_id: sessionId } }).catch(() => null)
}
/** Link z terminami (bez konta). */
export function notifyOffer(token: string) {
  supabase.functions.invoke('notify', { body: { action: 'offer', token } }).catch(() => null)
}
