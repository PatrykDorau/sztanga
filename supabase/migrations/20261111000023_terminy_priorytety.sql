-- Terminy dla nowej osoby: kilka terminów priorytetowych i kilka rezerwowych (trenerka wybiera, które przyjąć).
alter table public.reschedule_offers
  add column if not exists preferred jsonb, -- terminy „najbardziej mi pasuje” (kolejność = priorytet)
  add column if not exists backup jsonb; -- terminy „mogę też”

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
    'gyms', (select coalesce(jsonb_object_agg(g.id, g.name), '{}'::jsonb) from public.gyms g)
  )
  from public.reschedule_offers o left join public.clients c on c.id = o.client_id
  where o.token = link_token and o.status <> 'cancelled' and o.created_at > now() - interval '30 days';
$$;

-- Wybór kilku terminów (indeksy z oferty): priorytetowe (1–5) i rezerwowe (0–20). Pierwszy priorytetowy = „chosen”.
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
  where token = link_token and status in ('open', 'chosen') and created_at > now() - interval '30 days';
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
revoke execute on function public.choose_reschedule_multi(text, int[], int[], text, text, text, text) from public;
grant execute on function public.choose_reschedule_multi(text, int[], int[], text, text, text, text) to anon, authenticated;
