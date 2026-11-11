-- Naprawa: „Odłącz” i zmiana kalendarza kończyły się błędem „DELETE requires a WHERE clause” (Supabase blokuje DELETE
-- bez warunku). Kasujemy wydarzenia z kalendarza z jawnym warunkiem.
create or replace function public.google_set_calendar(cal text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  update public.google_connection
  set calendar_id = cal, sync_token = null, channel_id = null, channel_resource_id = null, channel_expires = null
  where id = 1;
  delete from public.calendar_events where true;
end;
$$;

create or replace function public.google_disconnect()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trainer() then raise exception 'Tylko trenerka' using errcode = '42501'; end if;
  update public.google_connection
  set refresh_token = null, access_token = null, access_token_expires = null, sync_token = null,
      channel_id = null, channel_resource_id = null, channel_token = null, channel_expires = null,
      email = null, connected_at = null, last_error = null
  where id = 1;
  delete from public.calendar_events where true;
end;
$$;
