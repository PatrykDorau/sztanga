-- Po 038: usunięcie dodanych ćwiczeń, które już były w bazie pod inną nazwą (zostaje starsze ćwiczenie),
-- i przypisanie tym starszym nowych kategorii sprzętu. Usuwamy tylko wtedy, gdy nikt jeszcze ich nie użył.
delete from public.exercises e
where e.external_id in ('bw-iso-dead-hang', 'bw-band-gm', 'bw-mbnd-monster', 'bw-mbnd-clamshell', 'bw-band-assisted-pullup', 'bw-band-pull-apart', 'bw-iso-superman')
  and e.source = 'library'
  and not exists (select 1 from public.workout_exercises w where w.exercise_id = e.id)
  and not exists (select 1 from public.set_logs s where s.exercise_id = e.id);

update public.exercises set equipment = array['pull-up bar'] where name_en in ('Dead Hang', 'One Handed Hang') and source <> 'own';
update public.exercises set equipment = array['bands', 'pull-up bar'] where name_en = 'Band Assisted Pull-Up' and source <> 'own';
