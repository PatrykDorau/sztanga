-- Badania drużynowe (np. „Badania mocy – seniorki”): zawodnicy z pozycjami, terminy pomiarów, wyniki kilku testów,
-- wyłączenie osoby ze średniej w danym terminie. Tylko trenerka.
create table if not exists public.studies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  team text, -- drużyna / grupa
  tests jsonb not null default '[]'::jsonb, -- [{key, label, unit, higher}] – higher=false: mniej znaczy lepiej (np. sprint)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_athletes (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  position text, -- pozycja na boisku
  client_id uuid references public.clients (id) on delete set null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists study_athletes_study_idx on public.study_athletes (study_id, sort);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  day date not null,
  label text,
  created_at timestamptz not null default now()
);
create index if not exists study_sessions_study_idx on public.study_sessions (study_id, day);

create table if not exists public.study_entries (
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  athlete_id uuid not null references public.study_athletes (id) on delete cascade,
  vals jsonb not null default '{}'::jsonb, -- {test_key: liczba}
  excluded boolean not null default false, -- nie wliczać do średniej (np. kontuzja, niepełny pomiar)
  note text,
  updated_at timestamptz not null default now(),
  primary key (session_id, athlete_id)
);

alter table public.studies enable row level security;
alter table public.study_athletes enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_entries enable row level security;
drop policy if exists "badania: trenerka" on public.studies;
create policy "badania: trenerka" on public.studies for all to authenticated using ((select public.is_trainer())) with check ((select public.is_trainer()));
drop policy if exists "badania zawodnicy: trenerka" on public.study_athletes;
create policy "badania zawodnicy: trenerka" on public.study_athletes for all to authenticated using ((select public.is_trainer())) with check ((select public.is_trainer()));
drop policy if exists "badania terminy: trenerka" on public.study_sessions;
create policy "badania terminy: trenerka" on public.study_sessions for all to authenticated using ((select public.is_trainer())) with check ((select public.is_trainer()));
drop policy if exists "badania wyniki: trenerka" on public.study_entries;
create policy "badania wyniki: trenerka" on public.study_entries for all to authenticated using ((select public.is_trainer())) with check ((select public.is_trainer()));
