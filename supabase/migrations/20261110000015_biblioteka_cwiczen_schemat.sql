-- Biblioteka ćwiczeń: mięsień główny i pomocnicze osobno, krótki opis, mechanika (wielostawowe/izolowane), kierunek siły,
-- klatki ruchu (start/koniec – animacja w aplikacji) i atrybucja licencji dla ćwiczeń z zewnętrznych baz.
alter table public.exercises
  add column if not exists primary_muscles text[] not null default '{}',
  add column if not exists secondary_muscles text[] not null default '{}',
  add column if not exists description text,
  add column if not exists mechanic text check (mechanic in ('compound', 'isolation')),
  add column if not exists force text check (force in ('push', 'pull', 'static')),
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists attribution text;
create index if not exists exercises_primary_idx on public.exercises using gin (primary_muscles);
