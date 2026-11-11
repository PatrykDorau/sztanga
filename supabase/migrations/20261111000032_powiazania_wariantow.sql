-- Druga runda powiązań: warianty tych samych ćwiczeń (alternatywy) i drille z rozgrzewki trenerki.
create temporary table chains (steps text[]) on commit drop;
insert into chains values
  (array['Seated Good Mornings', 'Good Morning']),
  (array['Bodyweight Step-Up', 'Step-up with Knee Raise']),
  (array['«Wykrok do boku z przejściem do wykroku w przód z rotacją»', 'Cossack Squat', 'Barbell Side Split Squat']),
  (array['«Lądowania na Verti»', '«Skoki przez linię do stabilizacji»', 'Single-Leg Lateral Hop']),
  (array['«Open book»', '«Step open book»']),
  (array['Crunches', '«Brzuch na piłce»']),
  (array['Incline Push-Up Medium', 'Pushups']),
  (array['Dumbbell Bench Press', 'One Arm Dumbbell Bench Press']);

create temporary table alts (items text[]) on commit drop;
insert into alts values
  (array['Dumbbell Floor Press', 'Alternating Floor Press', 'One Arm Floor Press', 'One-Arm Kettlebell Floor Press', 'Extended Range One-Arm Kettlebell Floor Press']),
  (array['Arnold Dumbbell Press', 'Kettlebell Arnold Press']),
  (array['Standing Dumbbell Press', 'Standing Alternating Dumbbell Press', 'Standing Palm-In One-Arm Dumbbell Press', 'Standing Palms-In Dumbbell Press']),
  (array['Dumbbell Shoulder Press', 'Cable Shoulder Press', 'Alternating Cable Shoulder Press', 'Seated Cable Shoulder Press']),
  (array['Push Press', 'Double Kettlebell Push Press', 'One-Arm Kettlebell Push Press']),
  (array['Rowing, Stationary', 'Bicycling, Stationary', 'Running, Treadmill']),
  (array['Good Morning', 'Stiff Leg Barbell Good Morning']),
  (array['Kettlebell Deadlift', 'One-Arm Side Deadlift']),
  (array['Dumbbell Step Ups', 'Step-up with Knee Raise']),
  (array['Dumbbell Lunges', 'Lunge Pass Through']),
  (array['Dumbbell Bulgarian Split Squat', 'Smith Single-Leg Split Squat']),
  (array['Bent Over Two-Dumbbell Row', 'Bent Over Two-Dumbbell Row With Palms In', 'Two-Arm Kettlebell Row']),
  (array['One-Arm Long Bar Row', 'Bent Over One-Arm Long Bar Row']),
  (array['Seated One-arm Cable Pulley Rows', 'Shotgun Row', 'Kneeling Single-Arm High Pulley Row']),
  (array['Seated Cable Rows', 'Kneeling High Pulley Row', 'Low Pulley Row To Neck']),
  (array['Leverage Iso Row', 'Leverage High Row']),
  (array['Inverted Row', 'Bodyweight Mid Row']),
  (array['Lying T-Bar Row', 'Straight Bar Bench Mid Rows']),
  (array['Push-Ups With Feet Elevated', 'Decline Push-Up']),
  (array['Incline Push-Up Close-Grip', 'Incline Push-Up Reverse Grip']),
  (array['Pushups', 'Pushups (Close and Wide Hand Positions)']),
  (array['Dumbbell Bench Press', 'Dumbbell Bench Press with Neutral Grip']),
  (array['Incline Dumbbell Press', 'Hammer Grip Incline DB Bench Press']),
  (array['Machine Bench Press', 'Leverage Chest Press']),
  (array['Decline Dumbbell Bench Press', 'Leverage Decline Chest Press']),
  (array['Dips - Chest Version', 'Parallel Bar Dip']),
  (array['Close-Grip Barbell Bench Press', 'Reverse Triceps Bench Press', 'Smith Machine Close-Grip Bench Press']),
  (array['Barbell Bench Press - Medium Grip', 'Wide-Grip Barbell Bench Press']),
  (array['Decline Barbell Bench Press', 'Wide-Grip Decline Barbell Bench Press']),
  (array['Hack Squat', 'Barbell Hack Squat', 'Narrow Stance Hack Squats']),
  (array['Leg Press', 'Lying Machine Squat', 'Smith Machine Leg Press', 'Narrow Stance Leg Press']),
  (array['Barbell Squat', 'Narrow Stance Squats', 'Wide Stance Barbell Squat']),
  (array['Goblet Squat', 'Plie Dumbbell Squat']),
  (array['Overhead Squat', 'One-Arm Overhead Kettlebell Squats']),
  (array['Crunches', '«Roll up»']),
  (array['Superman', '«Plecki z kijkiem na brzuchu»']),
  (array['«Niedźwiadek z piłką»', '«Wejścia na ścianę z waterbagiem»']),
  (array['Single-Leg Lateral Hop', '«Bocian z przeskokiem»']),
  (array['Cat Stretch', '«Mobilizacja kręgosłupa na wałku»', '«Rozciąganie grzbietu z kijem przy boxie»', '«Pies z głową w dół do deski z unoszeniem nogi»']),
  (array['«Sprinter stretch»', '«Otwieranie biodra w klęku jednonóż»', '«Siłowe 90/90»', '«Prostowanie nogi w leżeniu na plecach»']),
  (array['Child''s Pose', '«Skłon japoński do boku»']);

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
