-- Faza 4: logi sesji (seria po serii), pomiary i testy, podsumowania po sesji, udostępnianie planu linkiem bez konta.

-- ===== Log sesji =====
create type public.summary_status as enum ('none', 'draft', 'approved');

create table public.session_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  session_id uuid unique references public.sessions (id) on delete set null,
  workout_id uuid references public.workouts (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  notes text,                 -- notatki trenerki z sesji (wewnętrzne)
  summary text,               -- podsumowanie dla klienta
  summary_status public.summary_status not null default 'none',
  -- id lokalne z telefonu: ponowna synchronizacja po utracie zasięgu nie tworzy duplikatu
  client_uuid uuid unique,
  created_at timestamptz not null default now()
);
create index session_logs_client_idx on public.session_logs (client_id, started_at desc);
create index session_logs_workout_idx on public.session_logs (workout_id);
alter table public.session_logs enable row level security;
create policy "logi: trenerka" on public.session_logs for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "logi: klient czyta swoje" on public.session_logs for select to authenticated
  using (client_id in (select public.my_client_ids()));

create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.session_logs (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  workout_exercise_id uuid references public.workout_exercises (id) on delete set null,
  position int not null default 0,       -- kolejność ćwiczenia w sesji
  set_index int not null default 1,
  reps numeric(6, 1),
  load_kg numeric(6, 2),
  rpe numeric(3, 1),
  done boolean not null default true,
  notes text
);
create index set_logs_log_idx on public.set_logs (log_id);
create index set_logs_exercise_idx on public.set_logs (exercise_id);
create index set_logs_we_idx on public.set_logs (workout_exercise_id);
alter table public.set_logs enable row level security;
create policy "serie: trenerka" on public.set_logs for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "serie: klient czyta swoje" on public.set_logs for select to authenticated
  using (log_id in (select l.id from public.session_logs l where l.client_id in (select public.my_client_ids())));

-- ===== Pomiary i testy =====
create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  measured_on date not null default current_date,
  kind text not null,          -- np. weight, waist, hips, thigh, sit_and_reach, plank_s, squat_1rm…
  value numeric(8, 2) not null,
  unit text not null,
  notes text,
  created_at timestamptz not null default now()
);
create index measurements_client_idx on public.measurements (client_id, kind, measured_on);
alter table public.measurements enable row level security;
create policy "pomiary: trenerka" on public.measurements for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "pomiary: klient czyta swoje" on public.measurements for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- ===== Udostępnianie planu linkiem =====
create table public.plan_shares (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  token text not null unique default replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index plan_shares_program_idx on public.plan_shares (program_id);
alter table public.plan_shares enable row level security;
create policy "udostępnienia: trenerka" on public.plan_shares for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- Plan pod linkiem: jeden JSON z programem, ćwiczeniami (bez danych trenerki) i zatwierdzonymi podsumowaniami.
-- security definer + token: anon nie ma dostępu do tabel, tylko do tego, co zwraca funkcja.
create or replace function public.get_shared_plan(share_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with sh as (
    select ps.program_id from public.plan_shares ps
    where ps.token = share_token and ps.revoked_at is null
  ),
  p as (
    select pr.* from public.programs pr join sh on sh.program_id = pr.id
    where pr.status <> 'draft'
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'program', (select jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'start_date', p.start_date) from p),
    'client_first_name', (select split_part(c.full_name, ' ', 1) from public.clients c join p on p.client_id = c.id),
    'weeks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'position', w.position, 'phase', w.phase,
        'workouts', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'name', wo.name, 'notes', wo.notes,
            'exercises', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'exercise_id', we.exercise_id, 'group_label', we.group_label, 'sets', we.sets, 'reps', we.reps,
                'load', we.load, 'tempo', we.tempo, 'rest_sec', we.rest_sec, 'rpe', we.rpe, 'notes', we.notes
              ) order by we.position), '[]'::jsonb)
              from public.workout_exercises we where we.workout_id = wo.id
            )
          ) order by wo.position), '[]'::jsonb)
          from public.workouts wo where wo.week_id = w.id
        )
      ) order by w.position), '[]'::jsonb)
      from public.program_weeks w join p on w.program_id = p.id
    ),
    'exercises', (
      select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
        'name', e.name_pl, 'cues', e.cues, 'image_url', e.image_url, 'video_path', e.video_path
      )), '{}'::jsonb)
      from public.exercises e
      where e.id in (
        select we.exercise_id from public.workout_exercises we
        join public.workouts wo on wo.id = we.workout_id
        join public.program_weeks w on w.id = wo.week_id
        join p on w.program_id = p.id
      )
    ),
    'summaries', (
      select coalesce(jsonb_agg(jsonb_build_object('date', l.started_at, 'summary', l.summary) order by l.started_at desc), '[]'::jsonb)
      from public.session_logs l join p on l.client_id = p.client_id
      where l.summary_status = 'approved'
    )
  ) end;
$$;
revoke execute on function public.get_shared_plan(text) from public;
grant execute on function public.get_shared_plan(text) to anon, authenticated;

-- Wideo ćwiczeń z udostępnionych planów: anon może pobrać podpisany link tylko do plików
-- użytych w aktywnym udostępnieniu (ścieżki to losowe UUID, nie da się ich zgadnąć).
-- security definer, bo anon nie widzi tabel public (RLS) – polityka sama by zawsze zwracała fałsz.
create or replace function public.is_shared_media(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.exercises e
    join public.workout_exercises we on we.exercise_id = e.id
    join public.workouts wo on wo.id = we.workout_id
    join public.program_weeks w on w.id = wo.week_id
    join public.plan_shares ps on ps.program_id = w.program_id and ps.revoked_at is null
    join public.programs p on p.id = w.program_id and p.status <> 'draft'
    where e.video_path = path
  );
$$;
revoke execute on function public.is_shared_media(text) from public;
grant execute on function public.is_shared_media(text) to anon, authenticated;

create policy "media ćwiczeń: udostępnione plany" on storage.objects
  for select to anon
  using (bucket_id = 'exercise-media' and public.is_shared_media(name));
