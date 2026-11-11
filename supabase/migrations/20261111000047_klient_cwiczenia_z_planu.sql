-- Baza ćwiczeń: klient (i rodzic) widzi tylko ćwiczenia ze swoich planów i swoich zapisanych treningów, nie całą bazę.
-- Trener widzi wszystko jak dotąd.

-- Ćwiczenia „moje”: z planów i historii, które RLS i tak pokazuje zalogowanemu (security invoker – działa RLS tych tabel).
create or replace function public.my_exercise_ids()
returns setof uuid language sql stable security invoker set search_path = '' as $$
  select we.exercise_id from public.workout_exercises we
  union
  select sl.exercise_id from public.set_logs sl;
$$;
revoke execute on function public.my_exercise_ids() from public, anon;
grant execute on function public.my_exercise_ids() to authenticated;

drop policy if exists "ćwiczenia: odczyt zalogowani" on public.exercises;
create policy "ćwiczenia: trener wszystkie, klient z planu" on public.exercises
  for select to authenticated
  using ((select public.is_trainer()) or id in (select public.my_exercise_ids()));

-- Powiązania (regresja / progresja / zamiennik) – klient tylko między ćwiczeniami, które widzi.
drop policy if exists "powiązania: odczyt zalogowani" on public.exercise_relations;
create policy "powiązania: trener wszystkie, klient z planu" on public.exercise_relations
  for select to authenticated
  using ((select public.is_trainer()) or (from_exercise in (select public.my_exercise_ids()) and to_exercise in (select public.my_exercise_ids())));
