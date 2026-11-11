-- Pojedyncze treningi (jedna jednostka, nie cały plan): program z jednym tygodniem i jednym treningiem, kind = 'single'.
alter table public.programs add column if not exists kind text not null default 'plan';
alter table public.programs drop constraint if exists programs_kind_check;
alter table public.programs add constraint programs_kind_check check (kind in ('plan', 'single'));
