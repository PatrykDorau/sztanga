-- Odwołania i przełożenia tylko telefonicznie (klient widzi numer trenerki), wolne godziny ukryte dla klientów,
-- dopóki trenerka ich nie włączy.
alter table public.booking_settings
  add column if not exists trainer_phone text,
  add column if not exists show_availability boolean not null default false;

-- Klient nie odwołuje sesji w aplikacji – tylko telefonicznie.
create or replace function public.cancel_my_session(sid uuid, reason text default null)
returns void language plpgsql security definer set search_path to ''
as $function$
declare
  phone text;
begin
  select trainer_phone into phone from public.booking_settings where id = 1;
  raise exception 'Odwołanie tylko telefonicznie%', coalesce(': ' || nullif(phone, ''), '') using errcode = 'P0001';
end;
$function$;

-- Prośba o termin: tylko gdy trenerka pokazuje wolne godziny; bez przekładania istniejących sesji.
create or replace function public.request_slot(slot timestamptz, move_from uuid default null, weekly boolean default false)
returns uuid language plpgsql security definer set search_path to ''
as $function$
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
  if move_from is not null then
    raise exception 'Przełożenie tylko telefonicznie%', coalesce(': ' || nullif(s.trainer_phone, ''), '') using errcode = 'P0001';
  end if;
  if not s.show_availability then
    raise exception 'Zapisy przez aplikację są wyłączone – skontaktuj się z trenerką%', coalesce(': ' || nullif(s.trainer_phone, ''), '') using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('booking'));

  select f.gym_id into gid
  from public.free_slots((slot at time zone 'Europe/Warsaw')::date, (slot at time zone 'Europe/Warsaw')::date) f
  where f.starts_at = slot;
  if not found then
    raise exception 'Ten termin jest już zajęty albo niedostępny' using errcode = 'P0001';
  end if;

  insert into public.sessions (client_id, starts_at, ends_at, status, booked_by_client, gym_id, moved_from, weekly_request)
  values (cid, slot, slot + make_interval(mins => s.session_minutes), 'pending', true, gid, null, coalesce(weekly, false))
  returning id into sid;

  delete from public.waitlist where client_id = cid and day = (slot at time zone 'Europe/Warsaw')::date;
  return sid;
end;
$function$;

-- Wolne terminy: trenerka widzi zawsze, klient tylko gdy są włączone.
create or replace function public.free_slots(from_day date, to_day date)
returns table(starts_at timestamptz, ends_at timestamptz, gym_id uuid)
language sql stable security definer set search_path to ''
as $function$
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
  where ((select public.is_trainer()) or s.show_availability)
    and c.starts_at + make_interval(mins => c.session_minutes) <= c.w_end
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
    and not exists (
      select 1 from public.group_classes g
      where not g.cancelled
        and tstzrange(g.starts_at, g.ends_at) && tstzrange(c.starts_at, c.starts_at + make_interval(mins => c.session_minutes))
    )
  order by c.starts_at;
$function$;
