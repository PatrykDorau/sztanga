// Kolizje przy dodawaniu do grafiku: co już jest w tym czasie – wydarzenia z Google Calendar (np. „Ortodonta”),
// sesje i zajęcia grupowe. Ostrzeżenie, nie blokada – trenerka decyduje.
import { supabase } from '@/lib/supabase'

export interface Window {
  starts_at: string
  ends_at: string
}
export interface Conflict {
  title: string
  starts_at: string
  ends_at: string
  kind: 'google' | 'session' | 'group'
}

/** Wszystko, co nachodzi na podane terminy (pomija wpis o id `ignoreId`, np. edytowany). */
export async function findConflicts(windows: Window[], ignoreId?: string | null): Promise<Conflict[]> {
  if (!windows.length) return []
  const from = windows.reduce((m, w) => (w.starts_at < m ? w.starts_at : m), windows[0].starts_at)
  const to = windows.reduce((m, w) => (w.ends_at > m ? w.ends_at : m), windows[0].ends_at)
  const [ev, se, gr] = await Promise.all([
    supabase.from('calendar_events').select('gcal_event_id, kind, title, starts_at, ends_at').in('kind', ['busy', 'unmatched']).lt('starts_at', to).gt('ends_at', from),
    supabase.from('sessions').select('id, starts_at, ends_at, clients(full_name)').in('status', ['pending', 'confirmed']).lt('starts_at', to).gt('ends_at', from),
    supabase.from('group_classes').select('id, kind, starts_at, ends_at').eq('cancelled', false).lt('starts_at', to).gt('ends_at', from),
  ])
  const all: (Conflict & { id: string })[] = [
    ...((ev.data ?? []) as { gcal_event_id: string; title: string | null; starts_at: string; ends_at: string }[]).map((e) => ({
      id: e.gcal_event_id,
      title: e.title || 'Zajęte (Google Calendar)',
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      kind: 'google' as const,
    })),
    ...((se.data ?? []) as unknown as { id: string; starts_at: string; ends_at: string; clients: { full_name: string } | null }[]).map((s) => ({
      id: s.id,
      title: s.clients?.full_name ?? 'Sesja',
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      kind: 'session' as const,
    })),
    ...((gr.data ?? []) as { id: string; kind: string; starts_at: string; ends_at: string }[]).map((g) => ({ id: g.id, title: g.kind, starts_at: g.starts_at, ends_at: g.ends_at, kind: 'group' as const })),
  ]
  const hit = (c: Window) => windows.some((w) => c.starts_at < w.ends_at && c.ends_at > w.starts_at)
  return all.filter((c) => c.id !== ignoreId && hit(c)).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}

const KIND_LABEL: Record<Conflict['kind'], string> = { google: 'w kalendarzu Google', session: 'sesja', group: 'zajęcia grupowe' }
export function conflictText(c: Conflict) {
  const d = new Date(c.starts_at)
  const day = d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric' })
  const t = (iso: string) => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
  return `${c.title} – ${day} ${t(c.starts_at)}–${t(c.ends_at)} (${KIND_LABEL[c.kind]})`
}
