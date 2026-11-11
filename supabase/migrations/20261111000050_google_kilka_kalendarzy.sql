-- Google Calendar: synchronizacja kilku kalendarzy z jednego konta (np. czerwony = treningi BW, główny niebieski = Forto
-- i sprawy prywatne). Każdy kalendarz ma swój stan importu i powiadomień oraz (opcjonalnie) siłownię:
--  • wydarzenia bez koloru / dopisku dostają siłownię kalendarza,
--  • sesje i zajęcia z aplikacji trafiają do kalendarza swojej siłowni (bez przypisanego – do kalendarza głównego).

create table if not exists public.google_calendars (
  calendar_id text primary key,                 -- id z Google ('primary' dla głównego)
  name text,
  gym_id uuid references public.gyms (id) on delete set null,
  sync_token text,
  import_page_token text,
  import_time_min timestamptz,
  import_time_max timestamptz,
  sync_window_end timestamptz,
  channel_id text,
  channel_resource_id text,
  channel_token text,
  channel_expires timestamptz,
  created_at timestamptz not null default now()
);
alter table public.google_calendars enable row level security;
revoke all on public.google_calendars from anon, authenticated; -- tokeny – tylko funkcje (service role) i RPC poniżej

-- Z którego kalendarza jest wydarzenie / do którego wysłano sesję (null = kalendarz główny – dane sprzed tej zmiany).
alter table public.calendar_events add column if not exists gcal_calendar_id text;
alter table public.sessions add column if not exists gcal_calendar_id text;
alter table public.group_classes add column if not exists gcal_calendar_id text;
alter table public.gcal_cancelled add column if not exists gcal_calendar_id text;
alter table public.gcal_deletions add column if not exists gcal_calendar_id text;

-- Obecny kalendarz główny jako pierwszy z listy (ze stanem importu).
insert into public.google_calendars (calendar_id, name, sync_token, import_page_token, import_time_min, import_time_max, sync_window_end,
                                     channel_id, channel_resource_id, channel_token, channel_expires)
select g.calendar_id, 'Główny', g.sync_token, g.import_page_token, g.import_time_min, g.import_time_max, g.sync_window_end,
       g.channel_id, g.channel_resource_id, g.channel_token, g.channel_expires
from public.google_connection g where g.id = 1 and g.refresh_token is not null
on conflict (calendar_id) do nothing;
update public.calendar_events set gcal_calendar_id = (select calendar_id from public.google_connection where id = 1) where gcal_calendar_id is null;
update public.sessions set gcal_calendar_id = (select calendar_id from public.google_connection where id = 1) where gcal_event_id is not null and gcal_calendar_id is null;
update public.group_classes set gcal_calendar_id = (select calendar_id from public.google_connection where id = 1) where gcal_event_id is not null and gcal_calendar_id is null;

-- Usunięte sesje / zajęcia: zapamiętaj też kalendarz wydarzenia.
create or replace function public.sessions_track_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.gcal_event_id is not null then
    insert into public.gcal_deletions (gcal_event_id, restore_free, gcal_calendar_id)
    values (old.gcal_event_id, old.from_free_event, old.gcal_calendar_id)
    on conflict (gcal_event_id) do nothing;
  end if;
  return old;
end;
$$;
create or replace function public.group_classes_track_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.gcal_event_id is not null then
    insert into public.gcal_deletions (gcal_event_id, restore_free, gcal_calendar_id) values (old.gcal_event_id, false, old.gcal_calendar_id)
    on conflict (gcal_event_id) do nothing;
  end if;
  return old;
end;
$$;

-- Sprzątanie po kalendarzu, którego już nie synchronizujemy (null = wszystkie).
create or replace function public.google_forget_calendar_one(cal text)
returns void language plpgsql security definer set search_path = '' as $$
declare main text := (select calendar_id from public.google_connection where id = 1);
begin
  delete from public.calendar_events where cal is null or coalesce(gcal_calendar_id, main) = cal;
  delete from public.gcal_cancelled where cal is null or coalesce(gcal_calendar_id, main) = cal;
  delete from public.gcal_deletions where cal is null or coalesce(gcal_calendar_id, main) = cal;
  update public.sessions
  set gcal_event_id = null, gcal_calendar_id = null, gcal_synced_at = null,
      gcal_dirty = (starts_at > now() and status in ('pending', 'confirmed'))
  where gcal_event_id is not null and (cal is null or coalesce(gcal_calendar_id, main) = cal);
  update public.group_classes
  set gcal_event_id = null, gcal_calendar_id = null, gcal_synced_at = null, gcal_dirty = (starts_at > now() and not cancelled)
  where gcal_event_id is not null and (cal is null or coalesce(gcal_calendar_id, main) = cal);
end;
$$;
revoke execute on function public.google_forget_calendar_one(text) from public, anon, authenticated;

create or replace function public.google_forget_calendar()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.google_forget_calendar_one(null);
  delete from public.google_calendars where true;
  update public.google_connection
  set sync_token = null, import_page_token = null, import_time_min = null, import_time_max = null, sync_window_end = null,
      sync_lock_until = null
  where id = 1;
end;
$$;
revoke execute on function public.google_forget_calendar() from public, anon, authenticated;

-- Lista synchronizowanych kalendarzy (bez tokenów) – dla ekranu Google Calendar.
create or replace function public.google_calendars_list()
returns table (calendar_id text, name text, gym_id uuid, is_main boolean, imported boolean)
language sql stable security definer set search_path = '' as $$
  select c.calendar_id, c.name, c.gym_id, c.calendar_id = g.calendar_id, c.sync_token is not null
  from public.google_calendars c, public.google_connection g
  where g.id = 1 and public.is_trainer()
  order by c.calendar_id = g.calendar_id desc, c.created_at;
$$;
revoke execute on function public.google_calendars_list() from public, anon;
grant execute on function public.google_calendars_list() to authenticated;

-- Zapis wyboru: [{id, name, gym_id}], main = kalendarz główny (musi być na liście).
create or replace function public.google_set_calendars(cals jsonb, main text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(cals, '[]'::jsonb)) = 0 then raise exception 'Wybierz co najmniej jeden kalendarz.'; end if;
  if not exists (select 1 from jsonb_array_elements(cals) x where x ->> 'id' = main) then raise exception 'Kalendarz główny musi być zaznaczony.'; end if;
  -- Odznaczone: sprzątanie i usunięcie stanu.
  for r in select c.calendar_id from public.google_calendars c
           where not exists (select 1 from jsonb_array_elements(cals) x where x ->> 'id' = c.calendar_id) loop
    perform public.google_forget_calendar_one(r.calendar_id);
    delete from public.google_calendars where calendar_id = r.calendar_id;
  end loop;
  insert into public.google_calendars (calendar_id, name, gym_id)
  select x ->> 'id', x ->> 'name', nullif(x ->> 'gym_id', '')::uuid from jsonb_array_elements(cals) x
  on conflict (calendar_id) do update set name = excluded.name, gym_id = excluded.gym_id;
  update public.google_connection set calendar_id = main where id = 1;
  -- Wydarzenia z kalendarzy z nową siłownią – pełny import, żeby przeliczyć siłownie.
  update public.google_calendars set sync_token = null, import_page_token = null where sync_token is not null and calendar_id in (
    select x ->> 'id' from jsonb_array_elements(cals) x);
end;
$$;
revoke execute on function public.google_set_calendars(jsonb, text) from public, anon;
grant execute on function public.google_set_calendars(jsonb, text) to authenticated;

-- Stary wybór jednego kalendarza: teraz ustawia kalendarz główny (i dodaje go do listy).
create or replace function public.google_set_calendar(cal text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  insert into public.google_calendars (calendar_id) values (cal) on conflict (calendar_id) do nothing;
  update public.google_connection set calendar_id = cal where id = 1;
end;
$$;

-- Status: „zmiany na bieżąco”, gdy każdy synchronizowany kalendarz ma aktywny kanał powiadomień.
create or replace function public.google_status()
returns table (connected boolean, email text, calendar_id text, last_sync_at timestamptz, last_error text, watching boolean)
language sql stable security definer set search_path = '' as $$
  select g.refresh_token is not null, g.email, g.calendar_id, g.last_sync_at, g.last_error,
         exists (select 1 from public.google_calendars) and not exists (
           select 1 from public.google_calendars c where c.channel_expires is null or c.channel_expires <= now())
  from public.google_connection g
  where g.id = 1 and public.is_trainer();
$$;

-- Po wdrożeniu: import od nowa (tytuły „… forto”, samo imię, okno miesiąc do przodu).
update public.google_calendars set sync_token = null, import_page_token = null, sync_window_end = null where true;
