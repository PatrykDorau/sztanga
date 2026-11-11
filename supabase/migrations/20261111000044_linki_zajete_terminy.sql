-- Linki z terminami: termin wybrany już przez kogoś innego (z innego linku) albo zajęty stałą serią jest „zajęty”
-- – klient widzi go jako zajęty i nie może go wybrać. Kto pierwszy, ten lepszy (blokada przy zapisie).

-- Czy termin tygodniowy (weekday, start_time, duration_minutes) koliduje z wyborem z innego linku albo ze stałą serią.
create or replace function public.reschedule_slot_taken(offer_id uuid, own_series uuid, slot jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  with s as (
    select (slot ->> 'weekday')::int as wd,
           (slot ->> 'start_time')::time as st,
           (slot ->> 'start_time')::time + make_interval(mins => coalesce((slot ->> 'duration_minutes')::int, 60)) as en
  )
  select exists (
    -- Ktoś inny wybrał ten termin (czeka na zatwierdzenie trenerki).
    select 1 from public.reschedule_offers r, s
    where r.id <> offer_id and r.status = 'chosen' and r.chosen is not null
      and (r.chosen ->> 'weekday')::int = s.wd
      and (r.chosen ->> 'start_time')::time < s.en
      and s.st < (r.chosen ->> 'start_time')::time + make_interval(mins => coalesce((r.chosen ->> 'duration_minutes')::int, 60))
  ) or exists (
    -- Stały termin innego klienta (np. po zatwierdzeniu wyboru z innego linku).
    select 1 from public.session_series sr, s
    where sr.id is distinct from own_series
      and sr.weekday = s.wd
      and (sr.end_date is null or sr.end_date >= current_date)
      and sr.start_time < s.en
      and s.st < sr.start_time + make_interval(mins => sr.duration_minutes)
  );
$$;
revoke execute on function public.reschedule_slot_taken(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.reschedule_offer(link_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'first_name', coalesce(split_part(c.full_name, ' ', 1), split_part(o.prospect_name, ' ', 1)),
    'is_new', o.client_id is null,
    'contact_name', o.contact_name,
    'current', (select jsonb_build_object('weekday', sr.weekday, 'start_time', to_char(sr.start_time, 'HH24:MI'), 'duration_minutes', sr.duration_minutes)
                from public.session_series sr where sr.id = o.series_id),
    'slots', o.slots,
    'taken', (select coalesce(jsonb_agg(t.i - 1), '[]'::jsonb)
              from jsonb_array_elements(o.slots) with ordinality as t(slot, i)
              where o.status <> 'applied' and public.reschedule_slot_taken(o.id, o.series_id, t.slot)),
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

create or replace function public.choose_reschedule(link_token text, slot_index int, p_note text,
  p_name text default null, p_phone text default null, p_email text default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare o public.reschedule_offers;
begin
  -- Dwie osoby naraz: zapisy po kolei, druga zobaczy termin jako zajęty.
  perform pg_advisory_xact_lock(hashtext('reschedule_choose'));
  select * into o from public.reschedule_offers
  where token = link_token and status in ('open', 'chosen') and coalesce(expires_at, created_at + interval '30 days') > now();
  if o.id is null or slot_index < 0 or slot_index >= jsonb_array_length(o.slots) then return false; end if;
  if public.reschedule_slot_taken(o.id, o.series_id, o.slots -> slot_index) then return false; end if;
  if o.client_id is null and (char_length(trim(coalesce(p_name, ''))) < 2
      or (char_length(trim(coalesce(p_phone, ''))) < 6 and position('@' in coalesce(p_email, '')) = 0)) then
    return false;
  end if;
  update public.reschedule_offers
  set chosen = o.slots -> slot_index,
      chosen_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
      chosen_at = now(), status = 'chosen',
      contact_name = coalesce(nullif(left(trim(coalesce(p_name, '')), 120), ''), contact_name),
      contact_phone = coalesce(nullif(left(trim(coalesce(p_phone, '')), 40), ''), contact_phone),
      contact_email = coalesce(nullif(left(trim(coalesce(p_email, '')), 200), ''), contact_email)
  where id = o.id;
  return true;
end;
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
  perform pg_advisory_xact_lock(hashtext('reschedule_choose'));
  select * into o from public.reschedule_offers
  where token = link_token and status in ('open', 'chosen') and coalesce(expires_at, created_at + interval '30 days') > now();
  if o.id is null then return false; end if;
  n := jsonb_array_length(o.slots);
  if coalesce(array_length(pref, 1), 0) not between 1 and 5 or coalesce(array_length(backup_ix, 1), 0) > 20 then return false; end if;
  foreach i in array pref loop
    if i < 0 or i >= n then return false; end if;
    p := p || jsonb_build_array(o.slots -> i);
  end loop;
  -- Pierwszy wybór (ten, który blokuje termin innym) nie może być już zajęty.
  if public.reschedule_slot_taken(o.id, o.series_id, p -> 0) then return false; end if;
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
