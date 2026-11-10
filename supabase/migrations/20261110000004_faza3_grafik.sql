-- Faza 3: grafik, dostępność, sesje (rezerwacje), sesje cykliczne, lista oczekujących, zgłoszenia na konsultację.
-- Strefa czasowa grafiku: Europe/Warsaw (czas przechowywany jako timestamptz).

-- ===== Ustawienia rezerwacji (jeden wiersz – aplikacja dla jednej trenerki) =====
create table public.booking_settings (
  id int primary key default 1 check (id = 1),
  session_minutes int not null default 60 check (session_minutes between 15 and 240),
  slot_step_minutes int not null default 30 check (slot_step_minutes in (15, 30, 60)),
  min_notice_hours int not null default 12 check (min_notice_hours >= 0),
  cancel_limit_hours int not null default 24 check (cancel_limit_hours >= 0),
  booking_horizon_days int not null default 28 check (booking_horizon_days between 1 and 120),
  require_approval boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.booking_settings (id) values (1);
alter table public.booking_settings enable row level security;
create policy "ustawienia: odczyt zalogowani" on public.booking_settings for select to authenticated using (true);
create policy "ustawienia: trenerka" on public.booking_settings for update to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- ===== Dostępność: tygodniowy szablon + wyjątki =====
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  weekday int not null check (weekday between 1 and 7),   -- 1 = poniedziałek (ISO)
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
alter table public.availability_rules enable row level security;
create policy "dostępność: trenerka" on public.availability_rules for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- Wyjątek: cały dzień wolny (start/end null) albo dodatkowe godziny pracy (is_extra).
create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  start_time time,
  end_time time,
  is_extra boolean not null default false,
  reason text,
  check ((start_time is null and end_time is null and not is_extra) or (start_time is not null and end_time > start_time))
);
create index availability_exceptions_day_idx on public.availability_exceptions (day);
alter table public.availability_exceptions enable row level security;
create policy "wyjątki: trenerka" on public.availability_exceptions for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- ===== Sesje =====
create type public.session_status as enum ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');

create table public.session_series (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),
  start_time time not null,
  duration_minutes int not null default 60,
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now()
);
create index session_series_client_idx on public.session_series (client_id);
alter table public.session_series enable row level security;
create policy "serie: trenerka" on public.session_series for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.session_status not null default 'confirmed',
  workout_id uuid references public.workouts (id) on delete set null,
  series_id uuid references public.session_series (id) on delete set null,
  notes text,
  booked_by_client boolean not null default false,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index sessions_starts_idx on public.sessions (starts_at);
create index sessions_client_idx on public.sessions (client_id, starts_at);
create index sessions_series_idx on public.sessions (series_id);
create index sessions_workout_idx on public.sessions (workout_id);
alter table public.sessions enable row level security;

create policy "sesje: trenerka" on public.sessions for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
-- Klient tylko czyta swoje; rezerwuje i odwołuje wyłącznie przez funkcje book_slot / cancel_my_session.
create policy "sesje: klient czyta swoje" on public.sessions for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- ===== Lista oczekujących =====
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (client_id, day)
);
create index waitlist_day_idx on public.waitlist (day);
alter table public.waitlist enable row level security;
create policy "oczekujący: trenerka" on public.waitlist for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "oczekujący: klient swoje" on public.waitlist for all to authenticated
  using (client_id in (select public.my_client_ids()))
  with check (client_id in (select public.my_client_ids()));

-- ===== Zgłoszenia na pierwszą konsultację (bez konta) =====
create table public.consultation_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(full_name) between 2 and 120),
  email text check (email is null or length(email) <= 200),
  phone text check (phone is null or length(phone) <= 40),
  preferred_at timestamptz,
  message text check (message is null or length(message) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'converted', 'rejected')),
  created_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);
alter table public.consultation_requests enable row level security;
create policy "konsultacje: każdy może zgłosić" on public.consultation_requests for insert to anon, authenticated
  with check (status = 'new');
create policy "konsultacje: trenerka" on public.consultation_requests for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- ===== Wolne terminy =====
-- Liczone z szablonu dostępności i wyjątków, minus zajęte sesje, z wyprzedzeniem min_notice.
-- security definer: klient widzi tylko wolne godziny, nigdy cudze sesje.
create or replace function public.free_slots(from_day date, to_day date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select * from public.booking_settings where id = 1),
  days as (
    select d::date as day from generate_series(from_day, least(to_day, from_day + 62), interval '1 day') d
  ),
  windows as (
    -- szablon tygodniowy, chyba że dzień jest w całości wolny
    select dd.day, r.start_time, r.end_time
    from days dd
    join public.availability_rules r on r.weekday = extract(isodow from dd.day)
    where not exists (
      select 1 from public.availability_exceptions e
      where e.day = dd.day and not e.is_extra
    )
    union all
    -- dodatkowe godziny w wyjątkach
    select e.day, e.start_time, e.end_time
    from public.availability_exceptions e
    join days dd on dd.day = e.day
    where e.is_extra
  ),
  candidates as (
    select
      ((w.day + w.start_time) at time zone 'Europe/Warsaw') + make_interval(mins => g * s.slot_step_minutes) as starts_at,
      s.session_minutes,
      ((w.day + w.end_time) at time zone 'Europe/Warsaw') as window_end
    from windows w, s,
      generate_series(0, (extract(epoch from (w.end_time - w.start_time)) / 60 / s.slot_step_minutes)::int) g
  )
  select distinct c.starts_at, c.starts_at + make_interval(mins => c.session_minutes)
  from candidates c, s
  where c.starts_at + make_interval(mins => c.session_minutes) <= c.window_end
    and c.starts_at >= now() + make_interval(hours => s.min_notice_hours)
    and c.starts_at <= now() + make_interval(days => s.booking_horizon_days)
    and not exists (
      select 1 from public.sessions x
      where x.status in ('pending', 'confirmed')
        and tstzrange(x.starts_at, x.ends_at) && tstzrange(c.starts_at, c.starts_at + make_interval(mins => c.session_minutes))
    )
  order by 1;
$$;
revoke execute on function public.free_slots(date, date) from public, anon;
grant execute on function public.free_slots(date, date) to authenticated;

-- ===== Rezerwacja przez klienta =====
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
begin
  select id into cid from public.clients where user_id = auth.uid() and not archived limit 1;
  if cid is null then
    raise exception 'Konto nie jest powiązane z klientem trenerki' using errcode = '42501';
  end if;
  select * into s from public.booking_settings where id = 1;

  -- blokada, żeby dwie osoby nie zarezerwowały tego samego terminu jednocześnie
  perform pg_advisory_xact_lock(hashtext('booking'));

  if not exists (
    select 1 from public.free_slots((slot at time zone 'Europe/Warsaw')::date, (slot at time zone 'Europe/Warsaw')::date) f
    where f.starts_at = slot
  ) then
    raise exception 'Ten termin jest już zajęty albo niedostępny' using errcode = 'P0001';
  end if;

  insert into public.sessions (client_id, starts_at, ends_at, status, booked_by_client)
  values (cid, slot, slot + make_interval(mins => s.session_minutes),
          case when s.require_approval then 'pending'::public.session_status else 'confirmed'::public.session_status end, true)
  returning id into sid;

  delete from public.waitlist where client_id = cid and day = (slot at time zone 'Europe/Warsaw')::date;
  return sid;
end;
$$;
revoke execute on function public.book_slot(timestamptz) from public, anon;
grant execute on function public.book_slot(timestamptz) to authenticated;

-- ===== Odwołanie przez klienta =====
create or replace function public.cancel_my_session(sid uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.sessions;
  s public.booking_settings;
begin
  select * into x from public.sessions
  where id = sid and client_id in (select public.my_client_ids());
  if x.id is null then
    raise exception 'Nie znaleziono sesji' using errcode = 'P0002';
  end if;
  if x.status not in ('pending', 'confirmed') then
    raise exception 'Tej sesji nie można już odwołać' using errcode = 'P0001';
  end if;
  select * into s from public.booking_settings where id = 1;
  if x.starts_at < now() + make_interval(hours => s.cancel_limit_hours) then
    raise exception 'Do sesji zostało mniej niż % h – odwołanie tylko po kontakcie z trenerką', s.cancel_limit_hours
      using errcode = 'P0001';
  end if;

  update public.sessions
  set status = 'cancelled', cancelled_at = now(), cancel_reason = left(reason, 500)
  where id = sid;

  -- zwolniony termin: powiadom listę oczekujących (kto pierwszy zarezerwuje, ten ma)
  update public.waitlist set notified_at = now()
  where day = (x.starts_at at time zone 'Europe/Warsaw')::date and notified_at is null;
end;
$$;
revoke execute on function public.cancel_my_session(uuid, text) from public, anon;
grant execute on function public.cancel_my_session(uuid, text) to authenticated;

-- ===== Sesje cykliczne: generowanie wystąpień =====
-- Tworzy brakujące sesje serii do podanej daty (domyślnie 8 tygodni naprzód). Bez duplikatów.
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
  insert into public.sessions (client_id, starts_at, ends_at, status, series_id)
  select sr.client_id,
         (d::date + sr.start_time) at time zone 'Europe/Warsaw',
         ((d::date + sr.start_time) at time zone 'Europe/Warsaw') + make_interval(mins => sr.duration_minutes),
         'confirmed', sr.id
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
