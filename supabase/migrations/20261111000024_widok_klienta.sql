-- Co klient widzi w swojej aplikacji (ustawia trenerka na karcie klienta). Puste = ustawienia domyślne.
alter table public.clients
  add column if not exists client_view jsonb not null default '{}'::jsonb;
