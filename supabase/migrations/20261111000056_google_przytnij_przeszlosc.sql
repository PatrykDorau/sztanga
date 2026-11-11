-- Google Calendar: z aplikacji znikają też wydarzenia i sesje z Google starsze niż 60 dni (zmiana cyklicznej serii
-- odsyłała wystąpienia sprzed lat). Tylko sesje z kalendarza bez zapisanego treningu; w Google nic się nie zmienia.
create or replace function public.google_trim_before(since timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.calendar_events where ends_at < since;
  create temp table if not exists _trim_old (id uuid) on commit drop;
  delete from _trim_old where true;
  insert into _trim_old
  select s.id from public.sessions s
  where s.gcal_event_id is not null and s.ends_at < since and not s.gcal_dirty
    and not exists (select 1 from public.session_logs l where l.session_id = s.id);
  update public.sessions set gcal_event_id = null where id in (select id from _trim_old);
  delete from public.sessions where id in (select id from _trim_old);
end;
$$;
revoke execute on function public.google_trim_before(timestamptz) from public, anon, authenticated;

select public.google_trim_before(now() - interval '60 days');
