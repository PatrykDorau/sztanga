-- Admin: konto, które może nadawać i odbierać rolę trenera (ekran „Konta” w profilu).
-- Trenerzy pracują na wspólnych danych (ci sami klienci, grafik, kalendarz). Flagę admina nadaje się tylko przez SQL.
alter table public.profiles add column if not exists is_admin boolean not null default false;
-- Z API nadal można zmienić tylko imię (grant update (full_name) z fazy 1) – is_admin i role nie.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin);
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Lista kont z dostępem trenera/admina (tylko dla admina).
create or replace function public.admin_accounts()
returns table (id uuid, email text, full_name text, role public.app_role, is_admin boolean, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Tylko admin.'; end if;
  return query
    select u.id, u.email::text, p.full_name, p.role, p.is_admin, u.last_sign_in_at
    from public.profiles p join auth.users u on u.id = p.id
    where p.role = 'trainer' or p.is_admin
    order by p.is_admin desc, u.email;
end;
$$;
revoke execute on function public.admin_accounts() from public, anon;
grant execute on function public.admin_accounts() to authenticated;

-- Nadanie / odebranie roli trenera po e-mailu. Konto musi już istnieć (osoba loguje się raz – link z e-maila).
-- Admin nie może odebrać roli sobie (żeby nie zablokować się z ekranu).
create or replace function public.admin_set_trainer(p_email text, p_trainer boolean)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not public.is_admin() then raise exception 'Tylko admin.'; end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(trim(p_email));
  if uid is null then return 'missing'; end if;
  if uid = (select auth.uid()) and not p_trainer then return 'self'; end if;
  if p_trainer and exists (select 1 from public.clients c where c.user_id = uid) then return 'client'; end if;
  update public.profiles set role = case when p_trainer then 'trainer'::public.app_role else 'client'::public.app_role end where id = uid;
  return 'ok';
end;
$$;
revoke execute on function public.admin_set_trainer(text, boolean) from public, anon;
grant execute on function public.admin_set_trainer(text, boolean) to authenticated;
