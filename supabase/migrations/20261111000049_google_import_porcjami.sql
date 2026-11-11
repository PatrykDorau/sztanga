-- Google Calendar: pełny import w porcjach (limit CPU funkcji przerywał import dużego kalendarza z cyklicznymi wydarzeniami)
-- i sprzątanie po poprzednim kalendarzu przy odłączeniu / zmianie kalendarza.
alter table public.google_connection
  add column if not exists import_page_token text,      -- strona pełnego importu do kontynuacji
  add column if not exists import_time_min timestamptz, -- okno pełnego importu (te same parametry przy kolejnych stronach)
  add column if not exists import_time_max timestamptz,
  add column if not exists sync_window_end timestamptz; -- do kiedy sięga zaimportowane okno – potem pełny import od nowa

-- Wspólne sprzątanie: wydarzenia, odwołane do decyzji i kolejka usunięć dotyczą starego kalendarza – w nowym ich nie ma.
-- Sesje i zajęcia tracą powiązanie ze starym kalendarzem; przyszłe trafią do nowego przy synchronizacji.
create or replace function public.google_forget_calendar()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.calendar_events where true;
  delete from public.gcal_cancelled where true;
  delete from public.gcal_deletions where true;
  update public.sessions
  set gcal_event_id = null, gcal_synced_at = null,
      gcal_dirty = (starts_at > now() and status in ('pending', 'confirmed'))
  where gcal_event_id is not null;
  update public.group_classes
  set gcal_event_id = null, gcal_synced_at = null, gcal_dirty = (starts_at > now() and not cancelled)
  where gcal_event_id is not null;
  update public.google_connection
  set sync_token = null, import_page_token = null, import_time_min = null, import_time_max = null, sync_window_end = null,
      sync_lock_until = null
  where id = 1;
end;
$$;
revoke execute on function public.google_forget_calendar() from public, anon, authenticated;

create or replace function public.google_set_calendar(cal text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  if (select calendar_id from public.google_connection where id = 1) is not distinct from cal then return; end if;
  perform public.google_forget_calendar();
  update public.google_connection
  set calendar_id = cal, channel_id = null, channel_resource_id = null, channel_expires = null
  where id = 1;
end;
$$;

create or replace function public.google_disconnect()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  perform public.google_forget_calendar();
  update public.google_connection
  set refresh_token = null, access_token = null, access_token_expires = null,
      channel_id = null, channel_resource_id = null, channel_token = null, channel_expires = null,
      email = null, connected_at = null, last_error = null, calendar_id = 'primary'
  where id = 1;
end;
$$;

-- Klienci tworzeni automatycznie z kalendarza: po usunięciu klienta jego tytuł zostaje jako „to nie klient”
-- (alias z client_id = null), żeby synchronizacja nie utworzyła go od nowa.
alter table public.client_aliases drop constraint if exists client_aliases_client_id_fkey;
alter table public.client_aliases
  add constraint client_aliases_client_id_fkey foreign key (client_id) references public.clients (id) on delete set null;

-- Pełny import od nowa po wdrożeniu: wydarzenia „Imię Nazwisko” staną się klientami i sesjami.
update public.google_connection set sync_token = null where id = 1;

-- Teraz: odwołane z poprzedniego kalendarza (sprzed podłączenia nowego) nie dotyczą obecnego.
delete from public.gcal_cancelled c using public.google_connection g
where g.id = 1 and g.connected_at is not null and c.created_at < g.connected_at;
update public.google_connection set sync_lock_until = null, import_page_token = null where id = 1;
