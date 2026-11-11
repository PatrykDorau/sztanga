-- Zajęcia grupowe prowadzone przez trenerkę (trening siłowy, obwodowy, core, PZZ, funkcjonalny…):
-- widoczne w grafiku, blokują godziny dla rezerwacji klientów, liczone w miesięcznym zestawieniu dla siłowni.
create table public.group_classes (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  gym_id uuid references public.gyms (id) on delete set null,
  kind text not null, -- nazwa zajęć, np. „Trening siłowy”, „Obwód”
  participants int check (participants is null or participants >= 0),
  cancelled boolean not null default false,
  notes text,
  repeat_id uuid, -- wspólne dla zajęć dodanych jako „co tydzień”
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index group_classes_starts_idx on public.group_classes (starts_at);
alter table public.group_classes enable row level security;
create policy "group_classes trener" on public.group_classes for all to authenticated using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- Wolne terminy: zajęcia grupowe zajmują czas trenerki tak samo jak sesje.
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
    and not exists (
      select 1 from public.group_classes g
      where not g.cancelled
        and tstzrange(g.starts_at, g.ends_at) && tstzrange(c.starts_at, c.starts_at + make_interval(mins => c.session_minutes))
    )
  order by c.starts_at;
$function$;
