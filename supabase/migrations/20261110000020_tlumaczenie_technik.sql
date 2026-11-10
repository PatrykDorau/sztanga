-- Język wskazówek technicznych: 'en' dla zaimportowanych instrukcji (do przetłumaczenia), 'pl' po tłumaczeniu / dla własnych.
alter table public.exercises add column if not exists cues_lang text check (cues_lang in ('pl', 'en'));
update public.exercises set cues_lang = case when source = 'free-exercise-db' and cues is not null then 'en' else 'pl' end where cues_lang is null;
