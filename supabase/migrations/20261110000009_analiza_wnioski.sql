-- Analiza ruchu: zapisane wnioski (uwagi trenerskie) – żeby asystent AI i listy mogły z nich korzystać bez przeliczania szkieletu.
alter table public.movement_analyses add column if not exists findings jsonb;
