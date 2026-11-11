-- Sonnet 5.5 dla asystenta i generatora; licznik kosztu wywołań Claude i saldo kredytów wpisane przez trenerkę.
-- (Anthropic nie udostępnia salda konta przez zwykły klucz API – saldo = wpisane saldo − koszt wywołań od tego momentu.)
update public.app_settings set model_assistant = 'claude-sonnet-5-5', model_plan = 'claude-sonnet-5-5' where id = 1;
alter table public.app_settings alter column model_assistant set default 'claude-sonnet-5-5';

alter table public.app_settings
  add column if not exists credit_balance_usd numeric(10, 2), -- saldo z konsoli Anthropic w chwili wpisania
  add column if not exists credit_balance_at timestamptz,
  add column if not exists credit_topup_usd numeric(10, 2) not null default 5; -- kwota doładowania – próg ostrzeżenia to 10%
update public.app_settings set credit_balance_usd = 3.73, credit_balance_at = now(), credit_topup_usd = 5 where id = 1 and credit_balance_usd is null;

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  action text not null, -- ask | plan | translate
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0
);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage: trenerka czyta" on public.ai_usage;
create policy "ai_usage: trenerka czyta" on public.ai_usage for select to authenticated using ((select public.is_trainer()));
-- Zapis tylko z funkcji (klucz serwisowy) – brak polityki insert dla aplikacji.
