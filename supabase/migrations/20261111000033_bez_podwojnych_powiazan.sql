-- Para ćwiczeń połączona jako regresja/progresja nie musi być dodatkowo alternatywą (dublowało się na karcie ćwiczenia).
delete from public.exercise_relations a
where a.kind = 'alternative'
  and exists (
    select 1 from public.exercise_relations p
    where p.kind = 'progression'
      and ((p.from_exercise = a.from_exercise and p.to_exercise = a.to_exercise) or (p.from_exercise = a.to_exercise and p.to_exercise = a.from_exercise))
  );
