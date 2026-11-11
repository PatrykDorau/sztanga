-- Prośba klienta o stały termin (co tydzień): po akceptacji trenerki powstaje seria od tej sesji.
alter table public.sessions add column if not exists weekly_request boolean not null default false;

drop function if exists public.request_slot(timestamptz, uuid);
create or replace function public.request_slot(slot timestamptz, move_from uuid default null, weekly boolean default false)
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

  insert into public.sessions (client_id, starts_at, ends_at, status, booked_by_client, gym_id, moved_from, weekly_request)
  values (cid, slot, slot + make_interval(mins => s.session_minutes), 'pending', true, gid, move_from,
          coalesce(weekly, false) and move_from is null)
  returning id into sid;

  delete from public.waitlist where client_id = cid and day = (slot at time zone 'Europe/Warsaw')::date;
  return sid;
end;
$$;
revoke execute on function public.request_slot(timestamptz, uuid, boolean) from public, anon;
grant execute on function public.request_slot(timestamptz, uuid, boolean) to authenticated;

create or replace function public.book_slot(slot timestamptz)
returns uuid language sql security definer set search_path = '' as $$ select public.request_slot(slot, null, false) $$;

-- Akceptacja: przełożenie odwołuje stary termin; prośba cotygodniowa zakłada serię od tej sesji.
create or replace function public.apply_session_move()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  srid uuid;
  local timestamp;
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    if new.moved_from is not null then
      update public.sessions
      set status = 'cancelled', cancelled_at = now(),
          cancel_reason = 'Przełożona na ' || to_char(new.starts_at at time zone 'Europe/Warsaw', 'DD.MM HH24:MI')
      where id = new.moved_from and status in ('pending', 'confirmed');
    end if;
    if new.weekly_request and new.series_id is null then
      local := new.starts_at at time zone 'Europe/Warsaw';
      insert into public.session_series (client_id, weekday, start_time, duration_minutes, start_date, gym_id)
      values (new.client_id, extract(isodow from local)::int, local::time,
              (extract(epoch from (new.ends_at - new.starts_at)) / 60)::int, local::date, new.gym_id)
      returning id into srid;
      update public.sessions set series_id = srid where id = new.id;
      perform public.generate_series_sessions(srid);
    end if;
  end if;
  return new;
end;
$$;
