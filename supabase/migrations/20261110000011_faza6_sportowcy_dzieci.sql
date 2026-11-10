-- Faza 6: sportowcy (ankieta gotowości, obciążenie sesji sRPE, ACWR) i dzieci (zgody rodzica, testy sprawności,
-- wyzwania drużynowe, raport dla rodzica przez link bez konta).

-- ===== Obciążenie sesji (sRPE × czas) =====
-- RPE całej sesji w skali CR-10 (0–10), zbierane po treningu; czas w minutach (domyślnie z początku i końca sesji).
alter table public.session_logs
  add column if not exists srpe numeric(3, 1) check (srpe between 0 and 10),
  add column if not exists duration_min int check (duration_min between 1 and 600);

-- ===== Linki bez konta (ankieta gotowości, raport dla rodzica) =====
create table public.client_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  purpose text not null check (purpose in ('readiness', 'parent')),
  token text not null unique default replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index client_links_client_idx on public.client_links (client_id, purpose);
alter table public.client_links enable row level security;
create policy "linki: trenerka" on public.client_links for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- ===== Ankieta gotowości (sportowcy) =====
-- Każda pozycja 1–5, gdzie 5 = najlepiej (dobry sen, brak zmęczenia, brak bólu, brak stresu, dobry nastrój).
create table public.readiness (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  day date not null,
  sleep smallint not null check (sleep between 1 and 5),
  fatigue smallint not null check (fatigue between 1 and 5),
  soreness smallint not null check (soreness between 1 and 5),
  stress smallint not null check (stress between 1 and 5),
  mood smallint not null check (mood between 1 and 5),
  notes text check (char_length(notes) <= 500),
  source text not null default 'trainer' check (source in ('trainer', 'link', 'client')),
  created_at timestamptz not null default now(),
  unique (client_id, day)
);
create index readiness_day_idx on public.readiness (day);
alter table public.readiness enable row level security;
create policy "gotowość: trenerka" on public.readiness for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "gotowość: klient czyta swoje" on public.readiness for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- Dzień w Polsce (sportowiec wypełnia o 23:30 – to wciąż "dziś").
create or replace function public.pl_today() returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Warsaw')::date;
$$;

-- Ankieta pod linkiem: imię i dzisiejszy wpis (jeśli już był).
create or replace function public.readiness_link(link_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'first_name', split_part(c.full_name, ' ', 1),
    'today', public.pl_today(),
    'entry', (select to_jsonb(r) - 'client_id' - 'id' from public.readiness r where r.client_id = c.id and r.day = public.pl_today())
  )
  from public.client_links l join public.clients c on c.id = l.client_id
  where l.token = link_token and l.purpose = 'readiness' and l.revoked_at is null and not c.archived;
$$;

create or replace function public.submit_readiness(link_token text, p_sleep int, p_fatigue int, p_soreness int, p_stress int, p_mood int, p_notes text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare cid uuid;
begin
  select l.client_id into cid from public.client_links l join public.clients c on c.id = l.client_id
  where l.token = link_token and l.purpose = 'readiness' and l.revoked_at is null and not c.archived;
  if cid is null then return false; end if;
  insert into public.readiness (client_id, day, sleep, fatigue, soreness, stress, mood, notes, source)
  values (cid, public.pl_today(), p_sleep, p_fatigue, p_soreness, p_stress, p_mood, nullif(left(trim(coalesce(p_notes, '')), 500), ''), 'link')
  on conflict (client_id, day) do update set sleep = excluded.sleep, fatigue = excluded.fatigue, soreness = excluded.soreness,
    stress = excluded.stress, mood = excluded.mood, notes = excluded.notes, source = 'link', created_at = now();
  return true;
end;
$$;

-- ===== Zgody (RODO): rodzic dziecka, dane o zdrowiu, nagrania =====
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null check (kind in ('parent_data', 'health', 'video', 'results_sharing')),
  granted_by text not null check (char_length(granted_by) between 2 and 120), -- imię i nazwisko osoby wyrażającej zgodę
  source text not null default 'trainer' check (source in ('trainer', 'link')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index consents_client_idx on public.consents (client_id, kind);
alter table public.consents enable row level security;
create policy "zgody: trenerka" on public.consents for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "zgody: klient czyta swoje" on public.consents for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- ===== Wyzwania drużynowe (dzieci): wspólny cel, bez rankingów indywidualnych =====
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 80),
  description text,
  unit text not null default 'powt.',
  team_target numeric(10, 1) not null check (team_target > 0),
  starts_on date not null default current_date,
  ends_on date not null default current_date + 6,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create table public.challenge_entries (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  value numeric(10, 1) not null check (value >= 0),
  created_at timestamptz not null default now(),
  unique (challenge_id, client_id)
);
alter table public.challenges enable row level security;
alter table public.challenge_entries enable row level security;
create policy "wyzwania: trenerka" on public.challenges for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "wyzwania: wpisy trenerka" on public.challenge_entries for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- ===== Rodzic: zgoda przez link i raport rozwoju =====
-- Zgoda składana przez rodzica (imię i nazwisko + zakres). Wyniki dziecka pokazujemy dopiero po zgodzie na udostępnianie wyników.
create or replace function public.parent_consent(link_token text, parent_name text, kinds text[])
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare cid uuid; k text;
begin
  select l.client_id into cid from public.client_links l
  where l.token = link_token and l.purpose = 'parent' and l.revoked_at is null;
  if cid is null or char_length(trim(coalesce(parent_name, ''))) < 2 then return false; end if;
  foreach k in array kinds loop
    if k in ('parent_data', 'health', 'video', 'results_sharing') and not exists (
      select 1 from public.consents c where c.client_id = cid and c.kind = k and c.revoked_at is null
    ) then
      insert into public.consents (client_id, kind, granted_by, source) values (cid, k, left(trim(parent_name), 120), 'link');
    end if;
  end loop;
  return true;
end;
$$;

-- Raport dla rodzica: tylko imię dziecka, testy sprawności, frekwencja, wyzwania drużyny, zatwierdzone podsumowania.
-- Bez danych zdrowotnych, kontaktowych i notatek trenerki.
create or replace function public.parent_report(link_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with l as (
    select cl.client_id from public.client_links cl
    where cl.token = link_token and cl.purpose = 'parent' and cl.revoked_at is null
  ), c as (select cc.* from public.clients cc join l on l.client_id = cc.id)
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'first_name', (select split_part(full_name, ' ', 1) from c),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'by', k.granted_by, 'at', k.granted_at)), '[]'::jsonb)
                 from public.consents k join c on c.id = k.client_id where k.revoked_at is null),
    'shared', exists (select 1 from public.consents k join c on c.id = k.client_id where k.kind = 'results_sharing' and k.revoked_at is null),
    'tests', case when exists (select 1 from public.consents k join c on c.id = k.client_id where k.kind = 'results_sharing' and k.revoked_at is null) then
      (select coalesce(jsonb_agg(jsonb_build_object('kind', m.kind, 'value', m.value, 'unit', m.unit, 'on', m.measured_on) order by m.measured_on), '[]'::jsonb)
       from public.measurements m join c on c.id = m.client_id) else '[]'::jsonb end,
    'attendance', case when exists (select 1 from public.consents k join c on c.id = k.client_id where k.kind = 'results_sharing' and k.revoked_at is null) then
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
    'summaries', case when exists (select 1 from public.consents k join c on c.id = k.client_id where k.kind = 'results_sharing' and k.revoked_at is null) then
      (select coalesce(jsonb_agg(jsonb_build_object('date', sl.started_at, 'summary', sl.summary) order by sl.started_at desc), '[]'::jsonb)
       from (select * from public.session_logs x join c on c.id = x.client_id where x.summary_status = 'approved' order by x.started_at desc limit 5) sl) else '[]'::jsonb end
  ) end;
$$;

revoke execute on function public.readiness_link(text), public.submit_readiness(text, int, int, int, int, int, text),
  public.parent_consent(text, text, text[]), public.parent_report(text) from public;
grant execute on function public.readiness_link(text), public.submit_readiness(text, int, int, int, int, int, text),
  public.parent_consent(text, text, text[]), public.parent_report(text) to anon, authenticated;
