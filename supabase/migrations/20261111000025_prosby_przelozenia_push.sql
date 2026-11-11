-- Rezerwacje jako prośby do trenerki, przekładanie sesji przez klienta, wolne terminy tylko z siłowni klienta,
-- subskrypcje powiadomień push.

-- ===== Wolne terminy: klient z przypisaną siłownią widzi tylko jej godziny (trenerka – wszystkie) =====
create or replace function public.free_slots(from_day date, to_day date)
returns table (starts_at timestamptz, ends_at timestamptz, gym_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select * from public.booking_settings where id = 1),
  def as (select id from public.gyms where is_default limit 1),
  me as (select c.gym_id from public.clients c where c.user_id = auth.uid() and not c.archived and c.gym_id is not null limit 1),
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
    and (not exists (select 1 from me) or c.gym_id = (select gym_id from me))
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

-- ===== Przełożenie: nowa sesja-prośba wskazuje starą; po potwierdzeniu stara jest odwoływana =====
alter table public.sessions add column if not exists moved_from uuid references public.sessions (id) on delete set null;

-- Prośba klienta o termin (zawsze do potwierdzenia przez trenerkę). move_from = przełożenie istniejącej sesji.
create or replace function public.request_slot(slot timestamptz, move_from uuid default null)
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
  old public.sessions;
begin
  select id into cid from public.clients where user_id = auth.uid() and not archived limit 1;
  if cid is null then
    raise exception 'Konto nie jest powiązane z klientem trenerki' using errcode = '42501';
  end if;
  if move_from is not null then
    select * into old from public.sessions where id = move_from and client_id = cid;
    if old.id is null or old.status not in ('pending', 'confirmed') or old.starts_at < now() then
      raise exception 'Tej sesji nie można przełożyć' using errcode = 'P0001';
    end if;
    -- poprzednia, jeszcze niepotwierdzona prośba o przełożenie tej sesji – zastępujemy ją nową
    update public.sessions set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Zmiana prośby o przełożenie'
    where moved_from = move_from and status = 'pending';
  end if;
  select * into s from public.booking_settings where id = 1;
  perform pg_advisory_xact_lock(hashtext('booking'));

  select f.gym_id into gid
  from public.free_slots((slot at time zone 'Europe/Warsaw')::date, (slot at time zone 'Europe/Warsaw')::date) f
  where f.starts_at = slot;
  if not found then
    raise exception 'Ten termin jest już zajęty albo niedostępny' using errcode = 'P0001';
  end if;

  insert into public.sessions (client_id, starts_at, ends_at, status, booked_by_client, gym_id, moved_from)
  values (cid, slot, slot + make_interval(mins => s.session_minutes), 'pending', true, gid, move_from)
  returning id into sid;

  delete from public.waitlist where client_id = cid and day = (slot at time zone 'Europe/Warsaw')::date;
  return sid;
end;
$$;
revoke execute on function public.request_slot(timestamptz, uuid) from public, anon;
grant execute on function public.request_slot(timestamptz, uuid) to authenticated;

-- Stare wywołanie (starsze wersje aplikacji) – też jako prośba.
create or replace function public.book_slot(slot timestamptz)
returns uuid language sql security definer set search_path = '' as $$ select public.request_slot(slot, null) $$;
revoke execute on function public.book_slot(timestamptz) from public, anon;
grant execute on function public.book_slot(timestamptz) to authenticated;

create or replace function public.apply_session_move()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.moved_from is not null and new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    update public.sessions
    set status = 'cancelled', cancelled_at = now(),
        cancel_reason = 'Przełożona na ' || to_char(new.starts_at at time zone 'Europe/Warsaw', 'DD.MM HH24:MI')
    where id = new.moved_from and status in ('pending', 'confirmed');
  end if;
  return new;
end;
$$;
drop trigger if exists sessions_apply_move on public.sessions;
create trigger sessions_apply_move after update of status on public.sessions
  for each row execute function public.apply_session_move();

-- ===== Powiadomienia push (Web Push) =====
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push: własne" on public.push_subscriptions;
create policy "push: własne" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
