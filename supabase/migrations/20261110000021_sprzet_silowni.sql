-- Sprzęt siłowni: kategorie sprzętu (null = wszystko) i konkretne maszyny (null = wszystkie maszyny z bazy).
-- Plan tworzony dla siłowni używa tylko ćwiczeń możliwych do wykonania na miejscu.
alter table public.gyms
  add column if not exists equipment text[],
  add column if not exists machines uuid[];
