-- Wybór modelu Claude (koszt z klucza trenerki): osobno dla asystenta (czat) i generatora planu.
alter table public.app_settings
  add column if not exists model_assistant text not null default 'claude-haiku-5-5',
  add column if not exists model_plan text not null default 'claude-sonnet-5-5';
alter table public.app_settings drop constraint if exists app_settings_models_check;
alter table public.app_settings add constraint app_settings_models_check check (
  model_assistant in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')
  and model_plan in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')
);
