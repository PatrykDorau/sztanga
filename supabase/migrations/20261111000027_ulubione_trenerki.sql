-- Ulubione ćwiczenia trenerki (z jej planów): etykiety jej nazwami („OHP”, „SL RDL”, „sanki pchanie”) i rolą w treningu
-- („przygotowanie ruchowe”, „aktywacja”, „mobilność”, „stabilizacja”, „relaks”), gwiazdka dla kont trenerskich,
-- brakujące ćwiczenia jako własne, sprzęt siłowni BW na podstawie tego, czego używa w planach.

-- ===== 1. Istniejące ćwiczenia z bazy: etykiety =====
with m(name_en, tags) as (values
  ('Barbell Deadlift', array['martwy ciąg klasyczny']),
  ('Romanian Deadlift', array['rumun', 'RDL']),
  ('Kettlebell One-Legged Deadlift', array['martwy ciąg jednonóż', 'SL RDL']),
  ('Barbell Squat', array['przysiad ze sztangą na plecach']),
  ('Front Barbell Squat', array['przysiad ze sztangą z przodu']),
  ('Barbell Full Squat', array['przysiad ATG']),
  ('Goblet Squat', array['goblet squat']),
  ('Bent Over Barbell Row', array['wiosłowanie w opadzie tułowia']),
  ('One-Arm Dumbbell Row', array['SA row']),
  ('Standing Military Press', array['OHP']),
  ('Barbell Bench Press - Medium Grip', array['wyciskanie na klatę']),
  ('Pushups', array['pompka']),
  ('Dumbbell Step Ups', array['step upy', 'wejścia na step', 'step upy na boxa']),
  ('Suspended Row', array['podciąganie na TRX']),
  ('Inverted Row with Straps', array['podciąganie na TRX leżąc']),
  ('Dips - Chest Version', array['pompka na poręczach']),
  ('Copenhagen Adduction', array['przywodzenie kopenhaskie']),
  ('Sled Push', array['sanki pchanie', 'finisher']),
  ('Dumbbell Bicep Curl', array['bicek']),
  ('Triceps Pushdown', array['tricek']),
  ('Rowing, Stationary', array['ergometr wioślarski', 'przygotowanie ruchowe']),
  ('Standing Calf Raises', array['wspięcia na palce', 'przygotowanie ruchowe']),
  ('Cat Stretch', array['koci grzbiet krowi', 'mobilność']),
  ('Child''s Pose', array['siad japoński', 'relaks']),
  ('Side Bridge', array['deska bokiem', 'stabilizacja']),
  ('Butt Lift (Bridge)', array['most', 'most tyłem', 'stabilizacja']),
  ('Scapular Push-Up', array['pompki z łopatek', 'aktywacja']),
  ('Pallof Press', array['pallof press z gumą', 'aktywacja']),
  ('Single-Leg Lateral Hop', array['przeskoki do boku', 'przygotowanie ruchowe'])
)
update public.exercises e
set tags = (select array_agg(distinct t) from unnest(e.tags || m.tags) t)
from m where e.name_en = m.name_en;

-- ===== 2. Ćwiczenia z planów trenerki, których nie ma w bazie – jako własne =====
insert into public.exercises (name_pl, muscle_groups, primary_muscles, secondary_muscles, equipment, movement_pattern, level, description, cues, tags, source)
select v.name_pl, v.muscles, v.muscles[1:1], v.muscles[2:], v.equipment, v.pattern, 'beginner', v.descr, null, v.tags, 'own'
from (values
  ('Lądowania na Verti', array['quadriceps', 'glutes', 'calves'], array['box'], 'plyo', 'Zeskok z niskiej platformy i miękkie lądowanie: kolana nad stopami, biodra w tył, stabilna pozycja przez 2 s.', array['przygotowanie ruchowe', 'lądowania']),
  ('Hip hinge przy ścianie z przeskokiem', array['hamstrings', 'glutes'], array['body only'], 'hinge', 'Nauka zawiasu biodrowego: pośladki dotykają ściany za plecami, potem dynamiczny przeskok i powrót do pozycji zawiasu.', array['przygotowanie ruchowe', 'hiphinge']),
  ('Siłowe 90/90', array['glutes', 'abductors', 'adductors'], array['body only'], 'mobility', 'Siad 90/90, przejścia nogami na boki z aktywnym unoszeniem kolan – mobilność i siła rotacji bioder.', array['przygotowanie ruchowe', 'mobilność', '90/90']),
  ('Skoki przez linię do stabilizacji', array['quadriceps', 'calves', 'glutes'], array['body only'], 'plyo', 'Przeskok przez linię (przód–tył lub bok) i zatrzymanie lądowania na 2 s bez poprawiania stopy.', array['aktywacja', 'skoki przez linię']),
  ('Wejścia na ścianę z waterbagiem', array['abdominals', 'shoulders'], array['other'], 'core', 'Stabilizacja tułowia z waterbagiem – wolne, kontrolowane przejścia, bez rozlewania wody.', array['aktywacja', 'waterbag']),
  ('Rozciąganie grzbietu z kijem przy boxie', array['lats', 'middle back'], array['box', 'other'], 'mobility', 'Klęk przed boxem, łokcie na boxie z kijem w dłoniach, biodra w tył – rozciąganie najszerszych i odcinka piersiowego.', array['przygotowanie ruchowe', 'mobilność']),
  ('Open book', array['middle back', 'chest'], array['body only'], 'mobility', 'Leżenie bokiem, kolana zgięte; górna ręka otwiera się jak książka, wzrok za dłonią – rotacja odcinka piersiowego.', array['mobilność', 'open book']),
  ('Step open book', array['middle back', 'glutes'], array['box'], 'mobility', 'Wykrok z nogą na stepie i rotacja tułowia z otwarciem klatki w stronę przedniej nogi.', array['przygotowanie ruchowe', 'mobilność']),
  ('Bocian z przeskokiem', array['glutes', 'calves', 'quadriceps'], array['body only'], 'plyo', 'Stanie na jednej nodze (kolano drugiej w górze), przeskok na drugą nogę i zatrzymanie w pozycji bociana.', array['przygotowanie ruchowe', 'bocian', 'stabilizacja']),
  ('Odjeżdżanie na slajderze', array['adductors', 'glutes', 'quadriceps'], array['other'], 'lunge', 'Jedna stopa na slajderze odjeżdża w bok lub w tył, druga noga pracuje w przysiadzie – kontrola miednicy i kolana.', array['aktywacja', 'slajder']),
  ('Niedźwiadek z piłką', array['abdominals', 'shoulders'], array['exercise ball'], 'core', 'Chód w pozycji niedźwiadka (kolana tuż nad ziemią) z piłką na plecach – plecy nieruchome, piłka nie spada.', array['aktywacja', 'niedźwiadek']),
  ('Brzuch na piłce', array['abdominals'], array['exercise ball'], 'core', 'Spięcia brzucha leżąc lędźwiami na piłce gimnastycznej, w kontrolowanym zakresie.', array['aktywacja', 'brzuch']),
  ('Wykrok do boku z przejściem do wykroku w przód z rotacją', array['quadriceps', 'glutes', 'adductors'], array['body only'], 'lunge', 'Wykrok w bok, przejście do wykroku w przód i rotacja tułowia nad przednią nogą.', array['rozgrzewka']),
  ('Pies z głową w dół do deski z unoszeniem nogi', array['shoulders', 'hamstrings', 'abdominals'], array['body only'], 'mobility', 'Z pozycji psa z głową w dół przejście do deski i uniesienie nogi, powrót.', array['rozgrzewka', 'mobilność']),
  ('Jaskółka', array['hamstrings', 'glutes'], array['body only'], 'hinge', 'Równowaga na jednej nodze: tułów w przód, druga noga w tył w jednej linii z tułowiem, biodra równo.', array['stabilizacja', 'jaskółka']),
  ('Jaskółka z fit ballem', array['hamstrings', 'glutes', 'abdominals'], array['exercise ball'], 'hinge', 'Jaskółka z piłką gimnastyczną w dłoniach albo pod stopą tylnej nogi – kontrola równowagi i miednicy.', array['stabilizacja', 'jaskółka']),
  ('Roll up', array['abdominals'], array['body only'], 'core', 'Z leżenia na plecach powolne zwijanie kręgosłupa kręg po kręgu do siadu i powrót (pilates).', array['core', 'roll up']),
  ('Plecki z kijkiem na brzuchu', array['lower back', 'middle back'], array['other'], 'core', 'Leżenie przodem, kijek trzymany za głową lub na łopatkach; unoszenie klatki z ściągniętymi łopatkami.', array['stabilizacja', 'plecki']),
  ('Mobilizacja kręgosłupa na wałku', array['middle back'], array['foam roll'], 'mobility', 'Leżenie na wałku w poprzek odcinka piersiowego, ręce za głową – wyprosty nad wałkiem w kilku miejscach.', array['mobilność', 'wałek']),
  ('Prostowanie nogi w leżeniu na plecach', array['hamstrings'], array['body only'], 'mobility', 'Leżenie na plecach, kolano przy klatce, prostowanie nogi do góry – rozciąganie tylnej taśmy.', array['mobilność']),
  ('Otwieranie biodra w klęku jednonóż', array['glutes', 'adductors'], array['body only'], 'mobility', 'Klęk jednonóż, przenoszenie ciężaru w przód i na bok z otwieraniem kolana przedniej nogi.', array['mobilność']),
  ('Sprinter stretch', array['hamstrings', 'quadriceps'], array['body only'], 'mobility', 'Z wykroku z dłońmi na ziemi: na zmianę prostowanie przedniej nogi i powrót do wykroku.', array['mobilność', 'sprinter']),
  ('Ćwierć przysiadu z rękami nad głową', array['quadriceps', 'shoulders', 'middle back'], array['body only'], 'squat', 'Ręce wyprostowane nad głową (z kijem lub bez), ćwierć przysiadu z utrzymaniem rąk i neutralnych pleców.', array['stabilizacja', 'overhead']),
  ('Skłon japoński do boku', array['lats', 'lower back'], array['body only'], 'mobility', 'Siad japoński, dłonie daleko w przód i przesunięcie na bok – rozciąganie boku tułowia.', array['mobilność', 'relaks']),
  ('Podskoczki na piłce', array['quadriceps', 'calves'], array['exercise ball'], 'cardio', 'Siad na piłce gimnastycznej i rytmiczne podskoki z pracą rąk (z dołu do góry, na boki).', array['rozgrzewka', 'piłka']),
  ('Wyciskanie landmine z klęku do wstawania', array['shoulders', 'triceps', 'glutes'], array['barbell'], 'push_v', 'Z półklęku wyciśnięcie sztangi w uchwycie landmine jednorącz i wstanie do pozycji stojącej, powrót.', array['landmine', 'wyciskanie nad głowę landmina z wstawaniem'])
) v(name_pl, muscles, equipment, pattern, descr, tags)
where not exists (select 1 from public.exercises x where lower(x.name_pl) = lower(v.name_pl));

-- ===== 3. Gwiazdka (ulubione) dla kont trenerskich =====
insert into public.exercise_favorites (user_id, exercise_id)
select p.id, e.id
from public.profiles p
cross join public.exercises e
where p.role = 'trainer'
  and (e.name_en in ('Barbell Deadlift', 'Romanian Deadlift', 'Kettlebell One-Legged Deadlift', 'Barbell Squat', 'Front Barbell Squat',
        'Barbell Full Squat', 'Goblet Squat', 'Bent Over Barbell Row', 'One-Arm Dumbbell Row', 'Standing Military Press',
        'Barbell Bench Press - Medium Grip', 'Pushups', 'Dumbbell Step Ups', 'Suspended Row', 'Inverted Row with Straps',
        'Dips - Chest Version', 'Copenhagen Adduction', 'Sled Push', 'Rowing, Stationary', 'Standing Calf Raises', 'Cat Stretch',
        'Side Bridge', 'Butt Lift (Bridge)', 'Scapular Push-Up', 'Pallof Press', 'Single-Leg Lateral Hop')
       or (e.source = 'own' and e.name_pl not like 'TEST %' and e.created_at > now() - interval '1 hour'))
on conflict do nothing;

-- ===== 4. Sprzęt BW (z planów: sztanga, landmine, hantle, kettle, TRX, box/step, gumy, piłki, wałek, sanki, slajdery,
--          waterbag, poręcze, ergometry). Maszyny: tylko ergometry – inne trenerka dopisze na stronie „Sprzęt”. =====
update public.gyms set
  equipment = array['barbell', 'dumbbell', 'kettlebells', 'bands', 'medicine ball', 'exercise ball', 'foam roll', 'trx', 'box', 'machine', 'other'],
  machines = (select coalesce(array_agg(id), '{}') from public.exercises
              where name_en in ('Rowing, Stationary', 'Running, Treadmill', 'Walking, Treadmill', 'Jogging, Treadmill', 'Bicycling, Stationary'))
where code = 'BW' and equipment is null;
