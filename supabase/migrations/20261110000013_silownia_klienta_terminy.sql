-- 1) Siłownia klienta (filtr na liście klientów). Uzupełnienie: najczęstsza siłownia z jego sesji.
alter table public.clients add column if not exists gym_id uuid references public.gyms (id) on delete set null;
create index if not exists clients_gym_idx on public.clients (gym_id);
update public.clients c set gym_id = x.gym_id
from (
  select distinct on (s.client_id) s.client_id, s.gym_id
  from public.sessions s where s.gym_id is not null
  group by s.client_id, s.gym_id
  order by s.client_id, count(*) desc
) x
where x.client_id = c.id and c.gym_id is null;

-- 2) Analiza ruchu: ciężar użyty w nagraniu (prędkość → moc, profil obciążenie–prędkość).
alter table public.movement_analyses add column if not exists load_kg numeric(6, 1) check (load_kg between 0 and 1000);

-- 3) Propozycja zmiany stałego terminu: trenerka wybiera terminy w tygodniu, klient wybiera jeden pod linkiem.
create table public.reschedule_offers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  series_id uuid references public.session_series (id) on delete set null,
  token text not null unique default replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'),
  -- [{weekday: 1–7, start_time: "HH:MM", duration_minutes, gym_id}]
  slots jsonb not null check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) between 1 and 60),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'chosen', 'applied', 'cancelled')),
  chosen jsonb,
  chosen_note text check (char_length(chosen_note) <= 500),
  chosen_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index reschedule_offers_client_idx on public.reschedule_offers (client_id, status);
alter table public.reschedule_offers enable row level security;
create policy "zmiany terminów: trenerka" on public.reschedule_offers for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- Oferta pod linkiem: imię, obecny termin stały, proponowane terminy, stan.
create or replace function public.reschedule_offer(link_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'first_name', split_part(c.full_name, ' ', 1),
    'current', (select jsonb_build_object('weekday', sr.weekday, 'start_time', to_char(sr.start_time, 'HH24:MI'), 'duration_minutes', sr.duration_minutes)
                from public.session_series sr where sr.id = o.series_id),
    'slots', o.slots,
    'note', o.note,
    'status', o.status,
    'chosen', o.chosen,
    'gyms', (select coalesce(jsonb_object_agg(g.id, g.name), '{}'::jsonb) from public.gyms g)
  )
  from public.reschedule_offers o join public.clients c on c.id = o.client_id
  where o.token = link_token and o.status <> 'cancelled' and o.created_at > now() - interval '30 days';
$$;

-- Wybór klienta: tylko termin z oferty, tylko póki trenerka go nie zatwierdziła (można zmienić zdanie).
create or replace function public.choose_reschedule(link_token text, slot_index int, p_note text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare o public.reschedule_offers;
begin
  select * into o from public.reschedule_offers
  where token = link_token and status in ('open', 'chosen') and created_at > now() - interval '30 days';
  if o.id is null or slot_index < 0 or slot_index >= jsonb_array_length(o.slots) then return false; end if;
  update public.reschedule_offers
  set chosen = o.slots -> slot_index, chosen_note = nullif(left(trim(coalesce(p_note, '')), 500), ''), chosen_at = now(), status = 'chosen'
  where id = o.id;
  return true;
end;
$$;

revoke execute on function public.reschedule_offer(text), public.choose_reschedule(text, int, text) from public;
grant execute on function public.reschedule_offer(text), public.choose_reschedule(text, int, text) to anon, authenticated;
