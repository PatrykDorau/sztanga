-- Faza 1: role, profile, baza ćwiczeń, powiązania regresja/progresja, ulubione, wideo.

-- ===== Role i profile =====
create type public.app_role as enum ('trainer', 'client', 'parent');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'client',
  full_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Pomocnicza funkcja: czy zalogowany użytkownik to trenerka.
create or replace function public.is_trainer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'trainer'
  );
$$;
revoke execute on function public.is_trainer() from public, anon;
grant execute on function public.is_trainer() to authenticated;

-- Nowy użytkownik dostaje profil klienta. Rolę trenerki nadaje się ręcznie (SQL).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "profil: własny lub trenerka" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_trainer()));

-- Z API można zmienić tylko imię; rola zmienia się wyłącznie przez SQL.
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy "profil: edycja własnego" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ===== Ćwiczenia =====
create type public.exercise_level as enum ('beginner', 'intermediate', 'advanced');

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name_pl text not null,
  name_en text,
  muscle_groups text[] not null default '{}',
  equipment text[] not null default '{}',
  movement_pattern text,
  level public.exercise_level not null default 'beginner',
  contraindications text[] not null default '{}',
  cues text,
  video_path text,
  source text not null default 'own',           -- 'own' | 'free-exercise-db'
  external_id text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index exercises_name_idx on public.exercises using gin (to_tsvector('simple', coalesce(name_pl, '') || ' ' || coalesce(name_en, '')));
create index exercises_muscles_idx on public.exercises using gin (muscle_groups);
create index exercises_equipment_idx on public.exercises using gin (equipment);
create index exercises_created_by_idx on public.exercises (created_by);
alter table public.exercises enable row level security;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create trigger exercises_touch before update on public.exercises
  for each row execute function public.touch_updated_at();

-- Klienci czytają bazę ćwiczeń (do widoku planu); edytuje tylko trenerka.
create policy "ćwiczenia: odczyt zalogowani" on public.exercises
  for select to authenticated using (true);
create policy "ćwiczenia: trenerka dodaje" on public.exercises
  for insert to authenticated with check ((select public.is_trainer()));
create policy "ćwiczenia: trenerka edytuje" on public.exercises
  for update to authenticated using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "ćwiczenia: trenerka usuwa" on public.exercises
  for delete to authenticated using ((select public.is_trainer()));

-- ===== Graf powiązań =====
-- 'progression': to_exercise jest trudniejszą wersją from_exercise.
-- Regresja to ten sam wiersz czytany w drugą stronę.
-- 'alternative': zamiennik o podobnym poziomie.
create type public.exercise_relation_kind as enum ('progression', 'alternative');

create table public.exercise_relations (
  from_exercise uuid not null references public.exercises (id) on delete cascade,
  to_exercise uuid not null references public.exercises (id) on delete cascade,
  kind public.exercise_relation_kind not null,
  created_at timestamptz not null default now(),
  primary key (from_exercise, to_exercise, kind),
  check (from_exercise <> to_exercise)
);
create index exercise_relations_to_idx on public.exercise_relations (to_exercise);
alter table public.exercise_relations enable row level security;

create policy "powiązania: odczyt zalogowani" on public.exercise_relations
  for select to authenticated using (true);
create policy "powiązania: trenerka dodaje" on public.exercise_relations
  for insert to authenticated with check ((select public.is_trainer()));
create policy "powiązania: trenerka usuwa" on public.exercise_relations
  for delete to authenticated using ((select public.is_trainer()));

-- ===== Ulubione =====
create table public.exercise_favorites (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
create index exercise_favorites_exercise_idx on public.exercise_favorites (exercise_id);
alter table public.exercise_favorites enable row level security;

create policy "ulubione: własne" on public.exercise_favorites
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ===== Storage: wideo ćwiczeń =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-media', 'exercise-media', false, 52428800,
        array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "media ćwiczeń: odczyt zalogowani" on storage.objects
  for select to authenticated using (bucket_id = 'exercise-media');
create policy "media ćwiczeń: trenerka wgrywa" on storage.objects
  for insert to authenticated with check (bucket_id = 'exercise-media' and (select public.is_trainer()));
create policy "media ćwiczeń: trenerka nadpisuje" on storage.objects
  for update to authenticated using (bucket_id = 'exercise-media' and (select public.is_trainer()));
create policy "media ćwiczeń: trenerka usuwa" on storage.objects
  for delete to authenticated using (bucket_id = 'exercise-media' and (select public.is_trainer()));
