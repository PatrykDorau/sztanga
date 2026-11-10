-- Dwustronna synchronizacja z Google Calendar trenerki + siłownie (Bodywork BW, Forto FO).
--
-- Konwencja w kalendarzu (jak prowadzi go trenerka):
--   "Imię Nazwisko (BW)"  → sesja klienta na siłowni o kodzie BW (kolor wydarzenia = kolor siłowni)
--   "Free" / "Free (FO)"  → wolny termin do rezerwacji
--   inne (prywatne, całodniowe) → "Zajęte": blokuje rezerwacje, klienci nie widzą szczegółów
-- Import i eksport robi Edge Function gcal-sync (service role). Baza tylko przechowuje stan i budzi funkcję.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ===== Siłownie =====
create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique check (code ~ '^[A-Z0-9]{1,4}$'),
  color_id int not null check (color_id between 1 and 11),   -- kolory wydarzeń Google Calendar (1–11)
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index gyms_one_default on public.gyms (is_default) where is_default;
alter table public.gyms enable row level security;
create policy "siłownie: odczyt zalogowani" on public.gyms for select to authenticated using (true);
create policy "siłownie: trenerka" on public.gyms for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
insert into public.gyms (name, code, color_id, is_default) values
  ('Bodywork', 'BW', 11, true),   -- 11 = Pomidor (czerwony)
  ('Forto', 'FO', 7, false);      -- 7 = Paw (niebieski)

alter table public.availability_rules add column gym_id uuid references public.gyms (id) on delete set null;
alter table public.availability_exceptions add column gym_id uuid references public.gyms (id) on delete set null;
create index availability_rules_gym_idx on public.availability_rules (gym_id);
create index availability_exceptions_gym_idx on public.availability_exceptions (gym_id);

-- ===== Sesje ↔ wydarzenia =====
alter table public.sessions
  add column gym_id uuid references public.gyms (id) on delete set null,
  add column gcal_event_id text unique,
  add column gcal_dirty boolean not null default false,     -- zmiana w aplikacji czeka na wysłanie do Google
  add column gcal_synced_at timestamptz,                    -- ustawia tylko synchronizacja (pętla nie wraca)
  add column from_free_event boolean not null default false; -- po odwołaniu wydarzenie wraca jako "Free"
create index sessions_gym_idx on public.sessions (gym_id);

alter table public.session_series add column gym_id uuid references public.gyms (id) on delete set null;
create index session_series_gym_idx on public.session_series (gym_id);

-- Generowanie serii z siłownią (reszta bez zmian względem fazy 3).
create or replace function public.generate_series_sessions(sid uuid, until_day date default (current_date + 56))
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sr public.session_series;
  n int;
begin
  if not public.is_trainer() then
    raise exception 'Tylko trenerka' using errcode = '42501';
  end if;
  select * into sr from public.session_series where id = sid;
  insert into public.sessions (client_id, starts_at, ends_at, status, series_id, gym_id)
  select sr.client_id,
         (d::date + sr.start_time) at time zone 'Europe/Warsaw',
         ((d::date + sr.start_time) at time zone 'Europe/Warsaw') + make_interval(mins => sr.duration_minutes),
         'confirmed', sr.id, sr.gym_id
  from generate_series(greatest(sr.start_date, current_date), least(coalesce(sr.end_date, until_day), until_day), interval '1 day') d
  where extract(isodow from d) = sr.weekday
    and not exists (
      select 1 from public.sessions x
      where x.series_id = sr.id and x.starts_at = (d::date + sr.start_time) at time zone 'Europe/Warsaw'
    );
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.generate_series_sessions(uuid, date) from public, anon;
grant execute on function public.generate_series_sessions(uuid, date) to authenticated;

-- Istniejące sesje: domyślna siłownia.
update public.sessions set gym_id = (select id from public.gyms where is_default) where gym_id is null;
create index sessions_dirty_idx on public.sessions (gcal_dirty) where gcal_dirty;

-- ===== Lustro kalendarza (to, czego nie ma w tabeli sessions: Free, Zajęte, do przypisania) =====
create table public.calendar_events (
  gcal_event_id text primary key,
  kind text not null check (kind in ('free', 'busy', 'unmatched', 'session')),
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  color_id int,
  gym_id uuid references public.gyms (id) on delete set null,
  session_id uuid references public.sessions (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index calendar_events_time_idx on public.calendar_events (starts_at, ends_at);
create index calendar_events_kind_idx on public.calendar_events (kind);
create index calendar_events_gym_idx on public.calendar_events (gym_id);
create index calendar_events_session_idx on public.calendar_events (session_id);
alter table public.calendar_events enable row level security;
create policy "kalendarz: trenerka" on public.calendar_events for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- Dopasowanie tytułów wydarzeń do klientów. client_id null = "to nie klient" (traktuj jako Zajęte).
create table public.client_aliases (
  alias_norm text primary key,      -- znormalizowany tytuł: małe litery, bez polskich znaków i dopisków
  client_id uuid references public.clients (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index client_aliases_client_idx on public.client_aliases (client_id);
alter table public.client_aliases enable row level security;
create policy "aliasy: trenerka" on public.client_aliases for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- ===== Połączenie z Google (tylko service role – brak polityk = brak dostępu z aplikacji) =====
create table public.google_connection (
  id int primary key default 1 check (id = 1),
  email text,
  calendar_id text not null default 'primary',
  refresh_token text,
  access_token text,
  access_token_expires timestamptz,
  sync_token text,
  channel_id text,
  channel_resource_id text,
  channel_token text,
  channel_expires timestamptz,
  oauth_state text,
  oauth_state_expires timestamptz,
  oauth_return_to text,
  sync_lock_until timestamptz,
  sync_requested boolean not null default false,
  last_sync_at timestamptz,
  last_error text,
  connected_at timestamptz
);
insert into public.google_connection (id) values (1);
alter table public.google_connection enable row level security;
revoke all on public.google_connection from anon, authenticated;

-- Stan połączenia dla ekranu ustawień (bez tokenów).
create or replace function public.google_status()
returns table (connected boolean, email text, calendar_id text, last_sync_at timestamptz, last_error text, watching boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select g.refresh_token is not null, g.email, g.calendar_id, g.last_sync_at, g.last_error,
         coalesce(g.channel_expires > now(), false)
  from public.google_connection g
  where g.id = 1 and public.is_trainer();
$$;
revoke execute on function public.google_status() from public, anon;
grant execute on function public.google_status() to authenticated;

-- Wybór kalendarza przez trenerkę (reszta pól zmienia tylko Edge Function).
create or replace function public.google_set_calendar(cal text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  update public.google_connection
  set calendar_id = cal, sync_token = null, channel_id = null, channel_resource_id = null, channel_expires = null
  where id = 1;
  delete from public.calendar_events;
end;
$$;
revoke execute on function public.google_set_calendar(text) from public, anon;
grant execute on function public.google_set_calendar(text) to authenticated;

create or replace function public.google_disconnect()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  update public.google_connection
  set refresh_token = null, access_token = null, access_token_expires = null, sync_token = null,
      channel_id = null, channel_resource_id = null, channel_token = null, channel_expires = null,
      email = null, connected_at = null, last_error = null
  where id = 1;
  delete from public.calendar_events;
end;
$$;
revoke execute on function public.google_disconnect() from public, anon;
grant execute on function public.google_disconnect() to authenticated;

-- ===== Budzenie synchronizacji =====
-- Sekret wewnętrzny (baza → Edge Function). Losowy, w Vault; funkcja odczytuje go jako service role.
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'gcal_sync_secret', 'Wywołania gcal-sync z bazy');

create or replace function public.gcal_sync_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'gcal_sync_secret' limit 1;
$$;
revoke execute on function public.gcal_sync_secret() from public, anon, authenticated;
grant execute on function public.gcal_sync_secret() to service_role;

create or replace function public.kick_gcal_sync(reason text default 'db')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.google_connection where id = 1 and refresh_token is not null) then
    return;
  end if;
  perform net.http_post(
    url := 'https://kbqbmdzjuusbmyhrdqke.supabase.co/functions/v1/gcal-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', public.gcal_sync_secret()),
    body := jsonb_build_object('reason', reason)
  );
end;
$$;
revoke execute on function public.kick_gcal_sync(text) from public, anon, authenticated;

-- Zmiana sesji w aplikacji → oznacz do wysłania. Zapis z synchronizacji (zmienia gcal_synced_at) nie oznacza.
create or replace function public.sessions_mark_dirty()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.gcal_synced_at is null then new.gcal_dirty := true; end if;
  elsif new.gcal_synced_at is not distinct from old.gcal_synced_at then
    if (new.starts_at, new.ends_at, new.status, new.client_id, new.gym_id) is distinct from
       (old.starts_at, old.ends_at, old.status, old.client_id, old.gym_id) then
      new.gcal_dirty := true;
    end if;
  end if;
  return new;
end;
$$;
create trigger sessions_mark_dirty before insert or update on public.sessions
  for each row execute function public.sessions_mark_dirty();

-- Usunięcie sesji w aplikacji → usuń wydarzenie (albo przywróć "Free"). Zapamiętujemy, co zrobić.
create table public.gcal_deletions (
  gcal_event_id text primary key,
  restore_free boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.gcal_deletions enable row level security;
revoke all on public.gcal_deletions from anon, authenticated;

create or replace function public.sessions_track_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.gcal_event_id is not null then
    insert into public.gcal_deletions (gcal_event_id, restore_free)
    values (old.gcal_event_id, old.from_free_event)
    on conflict (gcal_event_id) do nothing;
  end if;
  return old;
end;
$$;
create trigger sessions_track_delete after delete on public.sessions
  for each row execute function public.sessions_track_delete();

-- Po każdej zmianie sesji: jeśli coś czeka na wysłanie do Google, obudź synchronizację (asynchronicznie, pg_net).
-- Wyzwalacze wierszowe AFTER (np. sessions_track_delete) wykonują się przed tym wyzwalaczem instrukcji.
create or replace function public.sessions_kick_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.sessions where gcal_dirty) or exists (select 1 from public.gcal_deletions) then
    perform public.kick_gcal_sync('db');
  end if;
  return null;
end;
$$;
create trigger sessions_kick_sync after insert or update or delete on public.sessions
  for each statement execute function public.sessions_kick_sync();

-- Co 5 minut: zapasowa synchronizacja (gdy powiadomienie z Google nie dotrze) i odnowienie kanału.
select cron.schedule('gcal-sync', '*/5 * * * *', $$ select public.kick_gcal_sync('cron') $$);

-- ===== Wolne terminy: szablon + wyjątki + wydarzenia "Free"; minus sesje i wydarzenia "Zajęte" =====
drop function if exists public.free_slots(date, date);
create or replace function public.free_slots(from_day date, to_day date)
returns table (starts_at timestamptz, ends_at timestamptz, gym_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select * from public.booking_settings where id = 1),
  def as (select id from public.gyms where is_default limit 1),
  days as (
    select d::date as day from generate_series(from_day, least(to_day, from_day + 62), interval '1 day') d
  ),
  windows as (
    select ((dd.day + r.start_time) at time zone 'Europe/Warsaw') as w_start,
           ((dd.day + r.end_time) at time zone 'Europe/Warsaw') as w_end,
           coalesce(r.gym_id, (select id from def)) as gym_id
    from days dd
    join public.availability_rules r on r.weekday = extract(isodow from dd.day)
    where not exists (select 1 from public.availability_exceptions e where e.day = dd.day and not e.is_extra)
    union all
    select ((e.day + e.start_time) at time zone 'Europe/Warsaw'),
           ((e.day + e.end_time) at time zone 'Europe/Warsaw'),
           coalesce(e.gym_id, (select id from def))
    from public.availability_exceptions e join days dd on dd.day = e.day
    where e.is_extra
    union all
    -- wolne godziny zaznaczone w Google Calendar jako "Free"
    select c.starts_at, c.ends_at, coalesce(c.gym_id, (select id from def))
    from public.calendar_events c
    where c.kind = 'free'
      and c.starts_at < ((to_day + 1)::timestamp at time zone 'Europe/Warsaw')
      and c.ends_at > (from_day::timestamp at time zone 'Europe/Warsaw')
  ),
  candidates as (
    select w.w_start + make_interval(mins => g * s.slot_step_minutes) as starts_at, s.session_minutes, w.w_end, w.gym_id
    from windows w, s,
      generate_series(0, greatest(0, (extract(epoch from (w.w_end - w.w_start)) / 60 / s.slot_step_minutes)::int)) g
  )
  select distinct on (c.starts_at) c.starts_at, c.starts_at + make_interval(mins => c.session_minutes), c.gym_id
  from candidates c, s
  where c.starts_at + make_interval(mins => c.session_minutes) <= c.w_end
    and c.starts_at >= now() + make_interval(hours => s.min_notice_hours)
    and c.starts_at <= now() + make_interval(days => s.booking_horizon_days)
    and not exists (
      select 1 from public.sessions x
      where x.status in ('pending', 'confirmed')
        and tstzrange(x.starts_at, x.ends_at) && tstzrange(c.starts_at, c.starts_at + make_interval(mins => c.session_minutes))
    )
    and not exists (
      select 1 from public.calendar_events b
      where b.kind in ('busy', 'unmatched')
        and tstzrange(b.starts_at, b.ends_at) && tstzrange(c.starts_at, c.starts_at + make_interval(mins => c.session_minutes))
    )
  order by c.starts_at;
$$;
revoke execute on function public.free_slots(date, date) from public, anon;
grant execute on function public.free_slots(date, date) to authenticated;

-- Rezerwacja: siłownia z wolnego terminu; jeśli termin to wydarzenie "Free", synchronizacja je przemianuje.
create or replace function public.book_slot(slot timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  s public.booking_settings;
  sid uuid;
  gid uuid;
begin
  select id into cid from public.clients where user_id = auth.uid() and not archived limit 1;
  if cid is null then
    raise exception 'Konto nie jest powiązane z klientem trenerki' using errcode = '42501';
  end if;
  select * into s from public.booking_settings where id = 1;
  perform pg_advisory_xact_lock(hashtext('booking'));

  select f.gym_id into gid
  from public.free_slots((slot at time zone 'Europe/Warsaw')::date, (slot at time zone 'Europe/Warsaw')::date) f
  where f.starts_at = slot;
  if not found then
    raise exception 'Ten termin jest już zajęty albo niedostępny' using errcode = 'P0001';
  end if;

  insert into public.sessions (client_id, starts_at, ends_at, status, booked_by_client, gym_id)
  values (cid, slot, slot + make_interval(mins => s.session_minutes),
          case when s.require_approval then 'pending'::public.session_status else 'confirmed'::public.session_status end,
          true, gid)
  returning id into sid;

  delete from public.waitlist where client_id = cid and day = (slot at time zone 'Europe/Warsaw')::date;
  return sid;
end;
$$;
revoke execute on function public.book_slot(timestamptz) from public, anon;
grant execute on function public.book_slot(timestamptz) to authenticated;
