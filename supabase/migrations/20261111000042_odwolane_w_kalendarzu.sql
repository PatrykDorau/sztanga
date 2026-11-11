-- Odwołania z aplikacji nie usuwają wydarzeń z Google Calendar od razu: wydarzenie dostaje tytuł „ODWOŁANE · …”,
-- kolor grafitowy i „pokaż jako: dostępny”. Lista takich wydarzeń czeka w panelu – trenerka decyduje o usunięciu.

create table public.gcal_cancelled (
  gcal_event_id text primary key,
  title text, -- tytuł sprzed odwołania
  starts_at timestamptz,
  ends_at timestamptz,
  session_id uuid references public.sessions (id) on delete set null,
  restore_free boolean not null default false, -- termin był „Free” przed rezerwacją – przy usuwaniu wraca jako Free
  reason text, -- 'cancelled' (sesja odwołana) / 'deleted' (sesja usunięta)
  action text check (action in ('delete', 'keep')), -- decyzja trenerki, wykonywana przy synchronizacji
  created_at timestamptz not null default now()
);
create index gcal_cancelled_starts on public.gcal_cancelled (starts_at);
alter table public.gcal_cancelled enable row level security;
revoke all on public.gcal_cancelled from anon;
create policy gcal_cancelled_trainer on public.gcal_cancelled for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
grant select, update, delete on public.gcal_cancelled to authenticated;
