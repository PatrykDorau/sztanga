-- Gwiazdka dla podstawowych ćwiczeń wielostawowych i ich wariantów (przysiady, martwe ciągi, wyciskania, wiosłowania,
-- podciągania, ściągania, wykroki, wejścia, hip thrust, pompki, dipy, suwnica) – dla kont trenerskich.
-- Bez wariantów specjalistycznych (łańcuchy, gumy, strongman, akrobatyka, ruchy za kark, ruchy olimpijskie).
insert into public.exercise_favorites (user_id, exercise_id)
select p.id, e.id
from public.profiles p
cross join public.exercises e
where p.role = 'trainer'
  and e.mechanic = 'compound'
  and e.movement_pattern is distinct from 'mobility'
  and e.name_en ~* '(squat|deadlift|bench press|chest press|floor press|dumbbell press|shoulder press|military press|overhead press|push press|arnold|landmine press|\mrows?\M|rowing|pull-?ups?|chin-?ups?|pulldown|pull down|lunge|split squat|step-?ups?|hip thrust|glute bridge|dips?\M|push-?ups?|thruster|good morning|leg press)'
  and e.name_en !~* '(car |jerk|snatch|clean|planche|handstand|archer|typewriter|rocky|clock|hindu|guillotine|powerlifting|chain|band|board|pin press|partial|anderson|zercher|jefferson|sissy|jump|plyo|explosive|clap|speed|sled|tire|log|keg|atlas|yoke|axle|rickshaw|bosu|frankenstein|plate|cross|bird dog|stretch|stationary|hold|negative|kipping|muscle|rear delt|kneeling squat|pistol|olympic|snatch-grip|deficit|suspended|ring|stability ball|on ball|weighted|one arm chin|one arm pull|one-arm push|behind|turkish|pins|hanging bar)'
  and e.name_pl !~* '(podpór|zawieszon|sprint|jednej ręce|założoną|tureckie|za kark|zza karku)'
on conflict do nothing;
