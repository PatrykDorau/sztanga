-- Faza 5: analiza ruchu (MediaPipe Pose na urządzeniu).
-- Nagranie analizuje telefon; do bazy trafia tylko szkielet (17 punktów na klatkę) i wyniki powtórzeń.
-- Samo wideo zapisujemy wyłącznie na życzenie trenerki, w prywatnym buckecie, z datą usunięcia (90 dni).

create table public.movement_analyses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,       -- null = nagranie trenerki (np. wzorzec)
  exercise_key text not null check (exercise_key in ('squat', 'deadlift', 'pushup')),
  exercise_id uuid references public.exercises(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  label text,                                                           -- np. "Wiktoria – wzorzec"
  recorded_at timestamptz not null default now(),
  view text not null default 'unknown' check (view in ('front', 'side', 'oblique', 'unknown')),
  fps real not null,
  duration real not null,
  width int,
  height int,
  frames jsonb not null,                                                -- zakodowany szkielet klatka po klatce
  reps jsonb not null default '[]'::jsonb,                              -- granice i pomiary każdego powtórzenia
  is_reference boolean not null default false,                         -- wzorzec do porównań
  reps_actual int check (reps_actual >= 0),                            -- poprawka trenerki: faktyczna liczba powtórzeń
  notes text,
  video_path text,
  video_expires_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index movement_analyses_client_idx on public.movement_analyses (client_id, recorded_at desc);
create index movement_analyses_ref_idx on public.movement_analyses (exercise_key) where is_reference;

alter table public.movement_analyses enable row level security;
create policy "analizy: trenerka" on public.movement_analyses for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "analizy: klient czyta swoje" on public.movement_analyses for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- Progi flagowania – kalibrowane przez trenerkę (jeden wiersz).
create table public.analysis_settings (
  id int primary key default 1 check (id = 1),
  thresholds jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.analysis_settings (id) values (1) on conflict do nothing;
alter table public.analysis_settings enable row level security;
create policy "progi: trenerka" on public.analysis_settings for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

-- Nagrania analiz – tylko trenerka, prywatnie.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('analysis-videos', 'analysis-videos', false, 104857600, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;

create policy "nagrania analiz: trenerka czyta" on storage.objects
  for select to authenticated using (bucket_id = 'analysis-videos' and (select public.is_trainer()));
create policy "nagrania analiz: trenerka wgrywa" on storage.objects
  for insert to authenticated with check (bucket_id = 'analysis-videos' and (select public.is_trainer()));
create policy "nagrania analiz: trenerka usuwa" on storage.objects
  for delete to authenticated using (bucket_id = 'analysis-videos' and (select public.is_trainer()));
