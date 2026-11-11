-- Klienci utworzeni automatycznie z Google Calendar: siłownia klienta = siłownia większości jego treningów
-- (ostatnie 60 dni i przyszłe), a nie pierwszego zaimportowanego wydarzenia. Ręcznie dodanych klientów nie ruszamy.
create or replace function public.clients_gym_from_sessions()
returns void language sql security definer set search_path = '' as $$
  with counts as (
    select s.client_id, s.gym_id, count(*) n,
           row_number() over (partition by s.client_id order by count(*) desc, max(s.starts_at) desc) rn
    from public.sessions s
    where s.gym_id is not null and s.status in ('pending', 'confirmed', 'completed')
      and s.starts_at > now() - interval '60 days'
    group by s.client_id, s.gym_id
  )
  update public.clients c set gym_id = x.gym_id
  from counts x
  where x.client_id = c.id and x.rn = 1 and c.gym_id is distinct from x.gym_id
    and c.notes like 'Dodany automatycznie z Google Calendar%';
$$;
revoke execute on function public.clients_gym_from_sessions() from public, anon, authenticated;

-- Główny (niebieski) kalendarz to Forto – wydarzenia bez dopisku i koloru dostaną Forto. Import od nowa, żeby przeliczyć.
update public.google_calendars c set gym_id = g.id, sync_token = null, import_page_token = null
from public.gyms g, public.google_connection gc
where gc.id = 1 and c.calendar_id = gc.calendar_id and c.calendar_id = 'primary' and c.gym_id is null and g.code = 'FO';

select public.clients_gym_from_sessions();
