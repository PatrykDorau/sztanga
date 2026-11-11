-- Łączenie zdublowanych klientów (np. literówka w kalendarzu: „Aleksnadra” / „Aleksandra”): wszystko z karty `drop`
-- przechodzi na `keep` – sesje, serie, plany, historia, pomiary, analizy, linki, zgody – a tytuły z kalendarza
-- (aliasy) wskazują odtąd na `keep`. Wydarzenia w Google nie są zmieniane. Na końcu karta `drop` znika.
create or replace function public.merge_clients(keep uuid, drop_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if (select auth.uid()) is not null and not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  if keep = drop_id then raise exception 'To ten sam klient.'; end if;
  if not exists (select 1 from public.clients where id = keep) or not exists (select 1 from public.clients where id = drop_id) then
    raise exception 'Nie ma takiego klienta.';
  end if;

  -- Sesje: bez odsyłania do Google (gcal_synced_at zmienia się razem z klientem, więc wydarzenie zostaje, jak było).
  update public.sessions set client_id = keep, gcal_synced_at = coalesce(gcal_synced_at, now()) where client_id = drop_id;
  update public.session_series set client_id = keep where client_id = drop_id;
  update public.session_logs set client_id = keep where client_id = drop_id;
  update public.programs set client_id = keep where client_id = drop_id;
  update public.measurements set client_id = keep where client_id = drop_id;
  update public.movement_analyses set client_id = keep where client_id = drop_id;
  update public.client_links set client_id = keep where client_id = drop_id;
  update public.consents set client_id = keep where client_id = drop_id;
  update public.reschedule_offers set client_id = keep where client_id = drop_id;
  update public.study_athletes set client_id = keep where client_id = drop_id;
  update public.client_aliases set client_id = keep where client_id = drop_id;
  -- Tabele z jednym wpisem na dzień / wyzwanie: zostaje wpis karty `keep`.
  delete from public.waitlist w where w.client_id = drop_id and exists (select 1 from public.waitlist k where k.client_id = keep and k.day = w.day);
  update public.waitlist set client_id = keep where client_id = drop_id;
  delete from public.readiness r where r.client_id = drop_id and exists (select 1 from public.readiness k where k.client_id = keep and k.day = r.day);
  update public.readiness set client_id = keep where client_id = drop_id;
  delete from public.challenge_entries e where e.client_id = drop_id and exists (select 1 from public.challenge_entries k where k.client_id = keep and k.challenge_id = e.challenge_id);
  update public.challenge_entries set client_id = keep where client_id = drop_id;

  -- Konto logowania łączonej karty przechodzi na zachowaną (jeśli ta go nie ma).
  select user_id into uid from public.clients where id = drop_id;
  update public.clients set user_id = null where id = drop_id;

  -- Dane karty: uzupełnij puste pola z łączonej (telefon, e-mail, konto, notatki).
  update public.clients k set
    phone = coalesce(k.phone, d.phone),
    email = coalesce(k.email, d.email),
    user_id = coalesce(k.user_id, uid),
    birth_date = coalesce(k.birth_date, d.birth_date),
    goals = coalesce(k.goals, d.goals),
    limitations = coalesce(k.limitations, d.limitations),
    notes = nullif(concat_ws(E'\n', k.notes, case when d.notes is distinct from k.notes then d.notes end), '')
  from public.clients d where k.id = keep and d.id = drop_id;
  delete from public.clients where id = drop_id;
end;
$$;
revoke execute on function public.merge_clients(uuid, uuid) from public, anon;
grant execute on function public.merge_clients(uuid, uuid) to authenticated;
