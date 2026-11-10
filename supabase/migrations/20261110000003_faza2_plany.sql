-- Faza 2: klienci, programy (szablony i plany klientów), tygodnie z periodyzacją, treningi, ćwiczenia w treningu.

-- ===== Klienci =====
-- Klient nie musi mieć konta (user_id null): większość dostaje plan przez link (faza 4).
create type public.client_group as enum ('amateur', 'athlete', 'child');

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  client_group public.client_group not null default 'amateur',
  birth_date date,
  goals text,
  limitations text[] not null default '{}',   -- klucze jak exercises.contraindications
  equipment text[] not null default '{}',     -- dostępny sprzęt
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients enable row level security;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- Identyfikatory klientów powiązanych z zalogowanym kontem.
create or replace function public.my_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.clients c where c.user_id = (select auth.uid());
$$;
revoke execute on function public.my_client_ids() from public, anon;
grant execute on function public.my_client_ids() to authenticated;

create policy "klienci: trenerka" on public.clients
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "klienci: własny rekord" on public.clients
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ===== Programy =====
create type public.program_status as enum ('draft', 'active', 'archived');

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_template boolean not null default false,
  client_id uuid references public.clients (id) on delete cascade,
  template_id uuid references public.programs (id) on delete set null,
  start_date date,
  status public.program_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (is_template and client_id is not null))
);
create index programs_client_idx on public.programs (client_id);
create index programs_template_idx on public.programs (template_id);
alter table public.programs enable row level security;
create trigger programs_touch before update on public.programs
  for each row execute function public.touch_updated_at();

create table public.program_weeks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  position int not null default 0,
  phase text,            -- adaptation | hypertrophy | strength | power | deload | peaking | własna etykieta
  notes text
);
create index program_weeks_program_idx on public.program_weeks (program_id, position);
alter table public.program_weeks enable row level security;

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.program_weeks (id) on delete cascade,
  position int not null default 0,
  name text not null default 'Trening',
  notes text
);
create index workouts_week_idx on public.workouts (week_id, position);
alter table public.workouts enable row level security;

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  position int not null default 0,
  group_label text,      -- ta sama litera w sąsiednich wierszach = superseria / obwód
  sets int,
  reps text,             -- "8", "8-10", "30 s", "max"
  load text,             -- "20 kg", "70%", "RPE 8", "masa ciała"
  tempo text,            -- "3-1-1-0"
  rest_sec int,
  rpe numeric(3, 1),
  notes text,
  progression jsonb      -- {"kind":"load","step":2.5} | {"kind":"reps","step":1}
);
create index workout_exercises_workout_idx on public.workout_exercises (workout_id, position);
create index workout_exercises_exercise_idx on public.workout_exercises (exercise_id);
alter table public.workout_exercises enable row level security;

-- Program widoczny dla klienta: jego własny i nie-szkic.
create or replace function public.can_read_program(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.programs p
    where p.id = pid
      and p.status <> 'draft'
      and p.client_id in (select public.my_client_ids())
  );
$$;
revoke execute on function public.can_read_program(uuid) from public, anon;
grant execute on function public.can_read_program(uuid) to authenticated;

create policy "programy: trenerka" on public.programs
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "programy: klient czyta swoje" on public.programs
  for select to authenticated
  using (status <> 'draft' and client_id in (select public.my_client_ids()));

create policy "tygodnie: trenerka" on public.program_weeks
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "tygodnie: klient" on public.program_weeks
  for select to authenticated
  using (public.can_read_program(program_id));

create policy "treningi: trenerka" on public.workouts
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "treningi: klient" on public.workouts
  for select to authenticated
  using (public.can_read_program((select w.program_id from public.program_weeks w where w.id = week_id)));

create policy "ćwiczenia treningu: trenerka" on public.workout_exercises
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "ćwiczenia treningu: klient" on public.workout_exercises
  for select to authenticated
  using (public.can_read_program((
    select w.program_id from public.workouts wo join public.program_weeks w on w.id = wo.week_id where wo.id = workout_id
  )));

-- ===== Kopiowanie programu =====
-- Szablon → plan klienta, plan → nowy szablon, albo duplikat. Kopia jest niezależna,
-- więc zmiany u klienta nie psują szablonu. Działa z uprawnieniami wywołującego (RLS: tylko trenerka).
create or replace function public.copy_program(
  src uuid,
  target_client uuid default null,
  as_template boolean default false,
  start date default null,
  new_name text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_program uuid;
  wk record;
  new_week uuid;
  wo record;
  new_workout uuid;
begin
  if not public.is_trainer() then
    raise exception 'Tylko trenerka może kopiować programy' using errcode = '42501';
  end if;

  insert into public.programs (name, description, is_template, client_id, template_id, start_date, status)
  select coalesce(new_name, p.name), p.description, as_template,
         case when as_template then null else target_client end,
         case when p.is_template then p.id else p.template_id end,
         start, 'draft'
  from public.programs p where p.id = src
  returning id into new_program;

  if new_program is null then
    raise exception 'Nie znaleziono programu %', src;
  end if;

  for wk in select * from public.program_weeks where program_id = src order by position loop
    insert into public.program_weeks (program_id, position, phase, notes)
    values (new_program, wk.position, wk.phase, wk.notes)
    returning id into new_week;

    for wo in select * from public.workouts where week_id = wk.id order by position loop
      insert into public.workouts (week_id, position, name, notes)
      values (new_week, wo.position, wo.name, wo.notes)
      returning id into new_workout;

      insert into public.workout_exercises
        (workout_id, exercise_id, position, group_label, sets, reps, load, tempo, rest_sec, rpe, notes, progression)
      select new_workout, exercise_id, position, group_label, sets, reps, load, tempo, rest_sec, rpe, notes, progression
      from public.workout_exercises where workout_id = wo.id;
    end loop;
  end loop;

  return new_program;
end;
$$;
revoke execute on function public.copy_program(uuid, uuid, boolean, date, text) from public, anon;
grant execute on function public.copy_program(uuid, uuid, boolean, date, text) to authenticated;
