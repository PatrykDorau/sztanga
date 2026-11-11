-- Nowy wzorzec ruchu: wyciskanie landmine (z półklęku do wstania).
alter table public.exercises drop constraint if exists exercises_movement_family_check;
alter table public.exercises add constraint exercises_movement_family_check check (
  movement_family is null or movement_family in (
    'none', 'squat', 'lunge', 'hinge', 'hip_thrust', 'bench', 'ohp', 'landmine_press', 'pushup', 'pullup', 'pulldown', 'row',
    'curl', 'triceps', 'lateral_raise', 'front_raise', 'fly', 'calf', 'crunch', 'leg_raise', 'knee_ext', 'knee_flex'
  )
);
