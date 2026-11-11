-- Regresje / progresje (łańcuchy od najłatwiejszego) i alternatywy (zamienniki) dla podstawowych i ulubionych ćwiczeń.
-- Nazwy: angielska z bazy albo «polska» dla własnych ćwiczeń trenerki. Brakujące nazwy są pomijane.

-- Podciąganie wzdłuż tułowia i wiosłowanie na tylne aktony to nie „podstawowe wielostawowe” – bez gwiazdki z automatu.
delete from public.exercise_favorites f using public.exercises e
where e.id = f.exercise_id and e.name_en ~* '(upright|rear-delt|rear delt)';

create temporary table chains (n int generated always as identity, steps text[]) on commit drop;
insert into chains (steps) values
  -- przysiad
  (array['Chair Squat', 'Bodyweight Squat', 'Goblet Squat', 'Barbell Squat', 'Barbell Full Squat']),
  (array['Barbell Squat To A Bench', 'Barbell Squat']),
  (array['Dumbbell Squat To A Bench', 'Dumbbell Squat']),
  (array['Goblet Squat', 'Front Barbell Squat']),
  (array['Dumbbell Front Squat', 'Front Barbell Squat']),
  (array['Front Barbell Squat To A Bench', 'Front Barbell Squat']),
  (array['Leg Press', 'Barbell Squat']),
  (array['Bodyweight Squat', '«Ćwierć przysiadu z rękami nad głową»', 'Overhead Squat']),
  (array['Single-Leg High Box Squat', 'One Leg Barbell Squat']),
  -- zawias biodrowy
  (array['«Hip hinge przy ścianie z przeskokiem»', 'Kettlebell Deadlift', 'Trap Bar Deadlift', 'Barbell Deadlift']),
  (array['«Hip hinge przy ścianie z przeskokiem»', 'Dumbbell Romanian Deadlift', 'Romanian Deadlift']),
  (array['Stiff-Legged Dumbbell Deadlift', 'Stiff-Legged Barbell Deadlift']),
  (array['«Jaskółka z fit ballem»', '«Jaskółka»', 'Single-Leg Romanian Deadlift', 'Single-Leg Dumbbell Romanian Deadlift', 'Kettlebell One-Legged Deadlift']),
  (array['Kettlebell Sumo Deadlift', 'Sumo Deadlift']),
  (array['Butt Lift (Bridge)', 'Single Leg Glute Bridge', 'Barbell Glute Bridge', 'Barbell Hip Thrust']),
  -- wykrok
  (array['Supported Split Squat', 'Split Squat with Dumbbells', 'Dumbbell Bulgarian Split Squat']),
  (array['Bodyweight Bulgarian Split Squat', 'Dumbbell Bulgarian Split Squat']),
  (array['Bodyweight Reverse Lunge', 'Dumbbell Rear Lunge', 'Barbell Reverse Lunge']),
  (array['Bodyweight Reverse Lunge', 'Elevated Back Lunge']),
  (array['Bodyweight Lunge', 'Dumbbell Lunges', 'Barbell Lunge']),
  (array['Bodyweight Walking Lunge', 'Dumbbell Walking Lunge', 'Barbell Walking Lunge']),
  (array['Bodyweight Step-Up', 'Dumbbell Step Ups']),
  -- pchanie poziome
  (array['Scapular Push-Up', 'Incline Push-Up', 'Pushups', 'Push-Ups With Feet Elevated', 'Push-Ups With Feet On An Exercise Ball']),
  (array['Knee Push-Up', 'Pushups']),
  (array['Incline Push-Up Close-Grip', 'Push-Ups - Close Triceps Position', 'Close-Grip Push-Up off of a Dumbbell']),
  (array['Incline Push-Up Wide', 'Push-Up Wide']),
  (array['Machine Bench Press', 'Dumbbell Bench Press', 'Barbell Bench Press - Medium Grip']),
  (array['Dumbbell Floor Press', 'Dumbbell Bench Press']),
  (array['Floor Press', 'Barbell Bench Press - Medium Grip']),
  (array['Leverage Incline Chest Press', 'Incline Dumbbell Press', 'Barbell Incline Bench Press - Medium Grip']),
  (array['Close-Grip Dumbbell Press', 'Close-Grip Barbell Bench Press']),
  (array['Bench Dips', 'Dips - Triceps Version']),
  (array['Dip Machine', 'Dips - Chest Version']),
  -- pchanie pionowe
  (array['«Wyciskanie landmine z klęku do wstawania»', 'Dumbbell One-Arm Shoulder Press']),
  (array['«Wyciskanie landmine z klęku do wstawania»', 'Seated Dumbbell Press', 'Standing Dumbbell Press', 'Standing Military Press', 'Push Press']),
  (array['Leverage Shoulder Press', 'Seated Barbell Military Press', 'Standing Military Press']),
  (array['Pike Push-Up', 'Dumbbell Shoulder Press']),
  (array['Two-Arm Kettlebell Military Press', 'Double Kettlebell Push Press']),
  -- przyciąganie poziome
  (array['Suspended Row', 'Inverted Row']),
  (array['Seated Cable Rows', 'One-Arm Dumbbell Row', 'Bent Over Two-Dumbbell Row', 'Bent Over Barbell Row']),
  (array['Dumbbell Incline Row', 'Bent Over Two-Dumbbell Row']),
  (array['Lying T-Bar Row', 'T-Bar Row with Handle']),
  (array['One-Arm Dumbbell Row', 'Alternating Renegade Row']),
  -- przyciąganie pionowe
  (array['Wide-Grip Lat Pulldown', 'Machine Assisted Pull-Up', 'Pullups']),
  (array['Close-Grip Front Lat Pulldown', 'Chin-Up']),
  (array['Underhand Cable Pulldowns', 'Chin-Up']),
  (array['V-Bar Pulldown', 'V-Bar Pullup']),
  (array['Inverted Row', 'Pullups']),
  -- core
  (array['Plank', 'Side Bridge', 'Copenhagen Adduction']),
  (array['Dead Bug', '«Niedźwiadek z piłką»']);

create temporary table alts (n int generated always as identity, items text[]) on commit drop;
insert into alts (items) values
  (array['Barbell Squat', 'Front Barbell Squat', 'Smith Machine Squat', 'Hack Squat', 'Leg Press']),
  (array['Goblet Squat', 'Dumbbell Squat', 'Front Squats With Two Kettlebells', 'Dumbbell Front Squat']),
  (array['Barbell Thruster', 'Dumbbell Thruster', 'Kettlebell Thruster', 'Landmine Squat to Press']),
  (array['Barbell Deadlift', 'Trap Bar Deadlift', 'Sumo Deadlift', 'Leverage Deadlift', 'Cable Deadlifts']),
  (array['Romanian Deadlift', 'Dumbbell Romanian Deadlift', 'Stiff-Legged Barbell Deadlift', 'Good Morning', 'Smith Machine Stiff-Legged Deadlift']),
  (array['Barbell Hip Thrust', 'Barbell Glute Bridge']),
  (array['Kettlebell One-Legged Deadlift', 'Single-Leg Dumbbell Romanian Deadlift']),
  (array['Dumbbell Lunges', 'Dumbbell Rear Lunge', 'Split Squat with Dumbbells', 'Dumbbell Step Ups', '«Odjeżdżanie na slajderze»']),
  (array['Barbell Lunge', 'Barbell Reverse Lunge', 'Barbell Walking Lunge']),
  (array['Barbell Bench Press - Medium Grip', 'Dumbbell Bench Press', 'Machine Bench Press', 'Smith Machine Bench Press', 'Cable Chest Press']),
  (array['Barbell Incline Bench Press - Medium Grip', 'Incline Dumbbell Press', 'Leverage Incline Chest Press', 'Smith Machine Incline Bench Press', 'Incline Cable Chest Press']),
  (array['Pushups', 'Standing Cable Chest Press', 'Dumbbell Floor Press']),
  (array['Dips - Chest Version', 'Decline Dumbbell Bench Press', 'Decline Barbell Bench Press']),
  (array['Standing Military Press', 'Barbell Shoulder Press', 'Dumbbell Shoulder Press', 'Arnold Dumbbell Press', 'Leverage Shoulder Press', 'Smith Machine Overhead Shoulder Press']),
  (array['«Wyciskanie landmine z klęku do wstawania»', 'Dumbbell One-Arm Shoulder Press', 'One-Arm Kettlebell Military Press To The Side']),
  (array['Bent Over Barbell Row', 'T-Bar Row with Handle', 'Bent Over Two-Arm Long Bar Row', 'Smith Machine Bent Over Row', 'Reverse Grip Bent-Over Rows']),
  (array['One-Arm Dumbbell Row', 'One-Arm Kettlebell Row', 'Seated One-arm Cable Pulley Rows', 'One-Arm Long Bar Row']),
  (array['Seated Cable Rows', 'Leverage Iso Row', 'Elevated Cable Rows', 'Dumbbell Incline Row']),
  (array['Suspended Row', 'Inverted Row with Straps', 'Inverted Row']),
  (array['Wide-Grip Lat Pulldown', 'Full Range-Of-Motion Lat Pulldown', 'Close-Grip Front Lat Pulldown', 'V-Bar Pulldown', 'One Arm Lat Pulldown']),
  (array['Pullups', 'Chin-Up', 'V-Bar Pullup']),
  (array['Pallof Press', 'Side Bridge']),
  (array['Standing Calf Raises', 'Seated Calf Raise']);

-- Nazwa → id (angielska z bazy albo «polska» własnego ćwiczenia).
create temporary view resolved as
select x.name, e.id
from (select distinct unnest(steps) as name from chains union select distinct unnest(items) from alts) x
join lateral (
  select id from public.exercises e
  where (x.name like '«%' and e.name_pl = trim(both '«»' from x.name)) or e.name_en = x.name
  order by (e.source = 'own') desc limit 1
) e on true;

insert into public.exercise_relations (from_exercise, to_exercise, kind)
select a.id, b.id, 'progression'
from chains c
cross join lateral generate_subscripts(c.steps, 1) i
join resolved a on a.name = c.steps[i]
join resolved b on b.name = c.steps[i + 1]
where i < array_length(c.steps, 1) and a.id <> b.id
on conflict do nothing;

insert into public.exercise_relations (from_exercise, to_exercise, kind)
select a.id, b.id, 'alternative'
from alts g
cross join lateral generate_subscripts(g.items, 1) i
cross join lateral generate_subscripts(g.items, 1) j
join resolved a on a.name = g.items[i]
join resolved b on b.name = g.items[j]
where i < j and a.id <> b.id
  and not exists (select 1 from public.exercise_relations r where r.kind = 'alternative' and r.from_exercise = b.id and r.to_exercise = a.id)
on conflict do nothing;
