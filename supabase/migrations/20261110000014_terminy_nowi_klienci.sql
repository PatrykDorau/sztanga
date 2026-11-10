-- Propozycje stałych terminów także dla nowych osób (jeszcze nie klientów): link bez klienta, osoba podaje imię i kontakt,
-- wybór trafia do oczekujących; akceptacja trenerki tworzy klienta i serię w kalendarzu.
alter table public.reschedule_offers alter column client_id drop not null;
alter table public.reschedule_offers
  add column if not exists prospect_name text check (char_length(prospect_name) <= 120), -- imię wpisane przez trenerkę (opcjonalnie)
  add column if not exists contact_name text check (char_length(contact_name) <= 120),
  add column if not exists contact_phone text check (char_length(contact_phone) <= 40),
  add column if not exists contact_email text check (char_length(contact_email) <= 200);

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
    'gyms', (select coalesce(jsonb_object_agg(g.id, g.name), '{}'::jsonb) from public.gyms g)
  )
  from public.reschedule_offers o left join public.clients c on c.id = o.client_id
  where o.token = link_token and o.status <> 'cancelled' and o.created_at > now() - interval '30 days';
$$;

drop function if exists public.choose_reschedule(text, int, text);
create or replace function public.choose_reschedule(link_token text, slot_index int, p_note text,
  p_name text default null, p_phone text default null, p_email text default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare o public.reschedule_offers;
begin
  select * into o from public.reschedule_offers
  where token = link_token and status in ('open', 'chosen') and created_at > now() - interval '30 days';
  if o.id is null or slot_index < 0 or slot_index >= jsonb_array_length(o.slots) then return false; end if;
  -- Nowa osoba: imię i telefon albo e-mail są wymagane (trenerka musi wiedzieć, kto to).
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
revoke execute on function public.choose_reschedule(text, int, text, text, text, text) from public;
grant execute on function public.choose_reschedule(text, int, text, text, text, text) to anon, authenticated;
