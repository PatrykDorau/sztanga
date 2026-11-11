-- 1) Linki z terminami: data ważności ustawiana przez trenerkę (wcześniej na sztywno 30 dni od utworzenia).
alter table public.reschedule_offers add column if not exists expires_at timestamptz;
update public.reschedule_offers set expires_at = created_at + interval '30 days' where expires_at is null;
alter table public.reschedule_offers alter column expires_at set default now() + interval '7 days';

create or replace function public.reschedule_offer(link_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'first_name', coalesce(split_part(c.full_name, ' ', 1), split_part(o.prospect_name, ' ', 1)),
    'is_new', o.client_id is null,
    'contact_name', o.contact_name,
    'current', (select jsonb_build_object('weekday', sr.weekday, 'start_time', to_char(sr.start_time, 'HH24:MI'), 'duration_minutes', sr.duration_minutes)
                from public.session_series sr where sr.id = o.series_id),
    'slots', o.slots,
    'note', o.note,
    'status', o.status,
    'chosen', o.chosen,
    'preferred', o.preferred,
    'backup', o.backup,
    'expires_at', o.expires_at,
    'gyms', (select coalesce(jsonb_object_agg(g.id, g.name), '{}'::jsonb) from public.gyms g)
  )
  from public.reschedule_offers o left join public.clients c on c.id = o.client_id
  where o.token = link_token and o.status <> 'cancelled' and coalesce(o.expires_at, o.created_at + interval '30 days') > now();
$$;

create or replace function public.choose_reschedule_multi(link_token text, pref int[], backup_ix int[], p_note text,
  p_name text default null, p_phone text default null, p_email text default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  o public.reschedule_offers;
  n int;
  i int;
  p jsonb := '[]'::jsonb;
  b jsonb := '[]'::jsonb;
begin
  select * into o from public.reschedule_offers
  where token = link_token and status in ('open', 'chosen') and coalesce(expires_at, created_at + interval '30 days') > now();
  if o.id is null then return false; end if;
  n := jsonb_array_length(o.slots);
  if coalesce(array_length(pref, 1), 0) not between 1 and 5 or coalesce(array_length(backup_ix, 1), 0) > 20 then return false; end if;
  foreach i in array pref loop
    if i < 0 or i >= n then return false; end if;
    p := p || jsonb_build_array(o.slots -> i);
  end loop;
  if backup_ix is not null then
    foreach i in array backup_ix loop
      if i < 0 or i >= n or i = any (pref) then return false; end if;
      b := b || jsonb_build_array(o.slots -> i);
    end loop;
  end if;
  if o.client_id is null and (char_length(trim(coalesce(p_name, ''))) < 2
      or (char_length(trim(coalesce(p_phone, ''))) < 6 and position('@' in coalesce(p_email, '')) = 0)) then
    return false;
  end if;
  update public.reschedule_offers
  set chosen = p -> 0, preferred = p, backup = nullif(b, '[]'::jsonb),
      chosen_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
      chosen_at = now(), status = 'chosen',
      contact_name = coalesce(nullif(left(trim(coalesce(p_name, '')), 120), ''), contact_name),
      contact_phone = coalesce(nullif(left(trim(coalesce(p_phone, '')), 40), ''), contact_phone),
      contact_email = coalesce(nullif(left(trim(coalesce(p_email, '')), 200), ''), contact_email)
  where id = o.id;
  return true;
end;
$$;

-- 2) Zajęcia grupowe w Google Calendar (jak sesje): wysyłane po zmianie, odwołane oznaczane „ODWOŁANE”.
alter table public.group_classes
  add column if not exists gcal_event_id text,
  add column if not exists gcal_dirty boolean not null default false,
  add column if not exists gcal_synced_at timestamptz;

create or replace function public.group_classes_mark_dirty()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.gcal_synced_at is null then new.gcal_dirty := true; end if;
  elsif new.gcal_synced_at is not distinct from old.gcal_synced_at then
    if (new.starts_at, new.ends_at, new.kind, new.cancelled, new.gym_id) is distinct from
       (old.starts_at, old.ends_at, old.kind, old.cancelled, old.gym_id) then
      new.gcal_dirty := true;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists group_classes_mark_dirty on public.group_classes;
create trigger group_classes_mark_dirty before insert or update on public.group_classes
  for each row execute function public.group_classes_mark_dirty();

-- Usunięte zajęcia: wydarzenie zostaje w Google jako odwołane (decyzja w panelu) – ta sama kolejka co sesje.
create or replace function public.group_classes_track_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.gcal_event_id is not null then
    insert into public.gcal_deletions (gcal_event_id, restore_free) values (old.gcal_event_id, false)
    on conflict (gcal_event_id) do nothing;
  end if;
  return old;
end;
$$;
drop trigger if exists group_classes_track_delete on public.group_classes;
create trigger group_classes_track_delete after delete on public.group_classes
  for each row execute function public.group_classes_track_delete();

create or replace function public.group_classes_kick_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.group_classes where gcal_dirty) or exists (select 1 from public.gcal_deletions) then
    perform public.kick_gcal_sync('db');
  end if;
  return null;
end;
$$;
drop trigger if exists group_classes_kick_sync on public.group_classes;
create trigger group_classes_kick_sync after insert or update or delete on public.group_classes
  for each statement execute function public.group_classes_kick_sync();

-- Istniejące zajęcia (dodane przed tą zmianą) – do wysłania przy najbliższej synchronizacji.
update public.group_classes set gcal_dirty = true where gcal_event_id is null and not cancelled and starts_at > now();
