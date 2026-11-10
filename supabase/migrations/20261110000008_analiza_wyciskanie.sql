-- Analiza ruchu: nowe ćwiczenie – wyciskanie nad głowę (asymetria pracy ramion).
alter table public.movement_analyses drop constraint if exists movement_analyses_exercise_key_check;
alter table public.movement_analyses
  add constraint movement_analyses_exercise_key_check check (exercise_key in ('squat', 'deadlift', 'pushup', 'press'));
