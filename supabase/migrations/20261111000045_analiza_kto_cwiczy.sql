-- Analiza ruchu: „Kto ćwiczy” można wpisać ręcznie (osoba spoza listy klientów, np. znajomy, osoba na próbnym treningu).
alter table public.movement_analyses add column if not exists subject_name text check (char_length(subject_name) between 1 and 120);
