-- Ustawienia aplikacji (jeden wiersz). parent_consent: czy wymagać zgód rodzica (formularz w raporcie i na karcie dziecka).
-- Domyślnie wyłączone – raport dla rodzica pokazuje wyniki od razu, bez formularza zgody.
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  parent_consent boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict do nothing;
alter table public.app_settings enable row level security;
create policy "ustawienia: odczyt" on public.app_settings for select to authenticated using (true);
create policy "ustawienia: trenerka" on public.app_settings for update to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- Raport dla rodzica: wyniki widać, gdy zgody są wyłączone albo rodzic zgodził się na udostępnianie.
create or replace function public.parent_report(link_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with l as (
    select cl.client_id from public.client_links cl
    where cl.token = link_token and cl.purpose = 'parent' and cl.revoked_at is null
  ), c as (select cc.* from public.clients cc join l on l.client_id = cc.id),
  req as (select coalesce((select s.parent_consent from public.app_settings s where s.id = 1), false) as on_),
  ok as (
    select (not (select on_ from req))
      or exists (select 1 from public.consents k join c on c.id = k.client_id where k.kind = 'results_sharing' and k.revoked_at is null) as v
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'first_name', (select split_part(full_name, ' ', 1) from c),
    'consent_required', (select on_ from req),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'by', k.granted_by, 'at', k.granted_at)), '[]'::jsonb)
                 from public.consents k join c on c.id = k.client_id where k.revoked_at is null),
    'shared', (select v from ok),
    'tests', case when (select v from ok) then
      (select coalesce(jsonb_agg(jsonb_build_object('kind', m.kind, 'value', m.value, 'unit', m.unit, 'on', m.measured_on) order by m.measured_on), '[]'::jsonb)
       from public.measurements m join c on c.id = m.client_id) else '[]'::jsonb end,
    'attendance', case when (select v from ok) then
      (select jsonb_build_object(
        'completed', count(*) filter (where s.status = 'completed'),
        'missed', count(*) filter (where s.status = 'no_show'),
        'first', min(s.starts_at), 'last', max(s.starts_at))
       from public.sessions s join c on c.id = s.client_id
       where s.starts_at > now() - interval '120 days' and s.starts_at < now()) else null end,
    'sessions_total', (select count(*) from public.session_logs sl join c on c.id = sl.client_id),
    'challenges', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'title', ch.title, 'description', ch.description, 'unit', ch.unit, 'target', ch.team_target,
        'starts_on', ch.starts_on, 'ends_on', ch.ends_on,
        'team', (select coalesce(sum(e.value), 0) from public.challenge_entries e where e.challenge_id = ch.id),
        'mine', (select e.value from public.challenge_entries e join c on c.id = e.client_id where e.challenge_id = ch.id)
      ) order by ch.starts_on desc), '[]'::jsonb)
      from public.challenges ch where ch.ends_on > current_date - 60
    ),
    'summaries', case when (select v from ok) then
      (select coalesce(jsonb_agg(jsonb_build_object('date', sl.started_at, 'summary', sl.summary) order by sl.started_at desc), '[]'::jsonb)
       from (select x.started_at, x.summary from public.session_logs x join c on c.id = x.client_id
             where x.summary_status = 'approved' order by x.started_at desc limit 5) sl) else '[]'::jsonb end
  ) end;
$$;
