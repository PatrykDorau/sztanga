-- Google Calendar: po imporcie usuń z aplikacji to, co jest dalej niż okno synchronizacji (miesiąc do przodu) –
-- kopie wydarzeń i sesje zaimportowane z Google. Wydarzenia w Google zostają nietknięte (sesje najpierw tracą powiązanie,
-- więc nie trafiają do kolejki „ODWOŁANE”); wrócą same, gdy okno do nich dojdzie.
create or replace function public.google_trim_beyond(cal text, until timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare main text := (select calendar_id from public.google_connection where id = 1);
begin
  delete from public.calendar_events where coalesce(gcal_calendar_id, main) = cal and starts_at > until;
  create temp table if not exists _trim (id uuid) on commit drop;
  delete from _trim where true;
  insert into _trim
  select s.id from public.sessions s
  where coalesce(s.gcal_calendar_id, main) = cal and s.gcal_event_id is not null and s.starts_at > until
    and not s.gcal_dirty and not exists (select 1 from public.session_logs l where l.session_id = s.id);
  update public.sessions set gcal_event_id = null where id in (select id from _trim);
  delete from public.sessions where id in (select id from _trim);
end;
$$;
revoke execute on function public.google_trim_beyond(text, timestamptz) from public, anon, authenticated;

-- Teraz: pozostałości wcześniejszego importu (do pół roku naprzód) w każdym synchronizowanym kalendarzu.
select public.google_trim_beyond(c.calendar_id, coalesce(c.sync_window_end, now() + interval '31 days')) from public.google_calendars c;
