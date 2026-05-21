-- StockSync - schema inicial para Supabase PostgreSQL
-- Execute este arquivo no SQL Editor do Supabase antes do deploy na Vercel.

create table if not exists public.app_storage (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_storage_updated_at on public.app_storage;

create trigger set_app_storage_updated_at
before update on public.app_storage
for each row
execute function public.set_updated_at();

alter table public.app_storage enable row level security;

-- O frontend nunca deve usar a service role key.
-- A service role fica somente nas variaveis de ambiente da Vercel.
-- Por isso, nenhuma policy publica e necessaria para anon/authenticated.

revoke all on table public.app_storage from anon;
revoke all on table public.app_storage from authenticated;
