-- „Do przypisania”: tytuł z kalendarza można oznaczyć jako zajęcia grupowe – jego wystąpienia stają się zajęciami
-- grupowymi w grafiku (powiązanymi z wydarzeniem w Google, bez dublowania). Do tego ponowny import po przypisaniu.
alter table public.client_aliases add column if not exists group_kind text; -- nazwa zajęć, gdy tytuł = zajęcia grupowe
create unique index if not exists group_classes_gcal_event_uq on public.group_classes (gcal_event_id) where gcal_event_id is not null;

-- Przypisanie zmienia sposób odczytu wydarzeń, które się nie zmieniły – pełny import okna (miesiąc), żeby je przeliczyć.
create or replace function public.google_resync()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  update public.google_calendars set sync_token = null, import_page_token = null where true;
end;
$$;
revoke execute on function public.google_resync() from public, anon;
grant execute on function public.google_resync() to authenticated;
