-- Wzorce ruchu: rodzina ruchu ćwiczenia (ręczna poprawka trenerki; null = przypisanie automatyczne w aplikacji),
-- analiza ruchu dla wszystkich rodzin i ujęcie „z tyłu”.
alter table public.exercises
  add column if not exists movement_family text;

alter table public.exercises drop constraint if exists exercises_movement_family_check;
alter table public.exercises add constraint exercises_movement_family_check check (
  movement_family is null or movement_family in (
    'none', 'squat', 'lunge', 'hinge', 'hip_thrust', 'bench', 'ohp', 'pushup', 'pullup', 'pulldown', 'row',
    'curl', 'triceps', 'lateral_raise', 'front_raise', 'fly', 'calf', 'crunch', 'leg_raise', 'knee_ext', 'knee_flex'
  )
);

alter table public.movement_analyses drop constraint if exists movement_analyses_exercise_key_check;
alter table public.movement_analyses add constraint movement_analyses_exercise_key_check check (
  exercise_key in (
    'squat', 'deadlift', 'pushup', 'press', 'lunge', 'hip_thrust', 'bench', 'pullup', 'pulldown', 'row', 'curl',
    'triceps', 'lateral_raise', 'front_raise', 'fly', 'calf', 'crunch', 'leg_raise', 'knee_ext', 'knee_flex'
  )
);

alter table public.movement_analyses drop constraint if exists movement_analyses_view_check;
alter table public.movement_analyses add constraint movement_analyses_view_check check (
  view in ('front', 'back', 'side', 'oblique', 'unknown')
);
