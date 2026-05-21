-- StockSync - schema normalizado para Supabase PostgreSQL
-- Execute este arquivo no SQL Editor do Supabase antes do deploy na Vercel.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Storage legado mantido apenas para migração/compatibilidade.
create table if not exists public.app_storage (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_app_storage_updated_at on public.app_storage;
create trigger set_app_storage_updated_at
before update on public.app_storage
for each row execute function public.set_updated_at();

create table if not exists public.stocksync_empresas (
  id text primary key,
  codigo text not null unique,
  nome text not null,
  criada_em text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stocksync_funcionarios (
  empresa_id text not null references public.stocksync_empresas(id) on delete cascade,
  email text not null,
  nome text not null default '',
  cargo text not null default 'Freelancer',
  status text not null default 'Ativo',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, email)
);

create table if not exists public.stocksync_solicitacoes_funcionarios (
  id text primary key,
  empresa_id text not null references public.stocksync_empresas(id) on delete cascade,
  email text not null default '',
  status text not null default 'Pendente',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stocksync_equipamentos (
  empresa_id text not null references public.stocksync_empresas(id) on delete cascade,
  codigo text not null,
  nome text not null default '',
  categoria text not null default '',
  status text not null default 'disponivel',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, codigo)
);

create table if not exists public.stocksync_eventos (
  empresa_id text not null references public.stocksync_empresas(id) on delete cascade,
  id text not null,
  nome text not null default '',
  data_evento text,
  status text not null default 'Ativo',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, id)
);

create table if not exists public.stocksync_evento_equipamentos (
  empresa_id text not null,
  evento_id text not null,
  codigo text not null,
  tipo text not null default 'interno',
  quantidade integer not null default 1,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, evento_id, codigo, tipo),
  foreign key (empresa_id, evento_id) references public.stocksync_eventos(empresa_id, id) on delete cascade
);

create table if not exists public.stocksync_locacoes (
  empresa_id text not null references public.stocksync_empresas(id) on delete cascade,
  id text not null,
  cliente text not null default '',
  status text not null default 'Em Andamento',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, id)
);

create table if not exists public.stocksync_locacao_equipamentos (
  empresa_id text not null,
  locacao_id text not null,
  codigo text not null,
  quantidade integer not null default 1,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, locacao_id, codigo),
  foreign key (empresa_id, locacao_id) references public.stocksync_locacoes(empresa_id, id) on delete cascade
);

create table if not exists public.stocksync_manutencoes (
  empresa_id text not null references public.stocksync_empresas(id) on delete cascade,
  id text not null,
  codigo text not null default '',
  status text not null default 'Em Manutencao',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, id)
);

create table if not exists public.stocksync_logs (
  id text primary key,
  empresa_id text not null references public.stocksync_empresas(id) on delete cascade,
  data_log text not null default '',
  usuario text not null default '',
  acao text not null default '',
  tipo text not null default 'badge-purple',
  detalhes text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stocksync_funcionarios_empresa on public.stocksync_funcionarios(empresa_id);
create index if not exists idx_stocksync_equipamentos_empresa on public.stocksync_equipamentos(empresa_id);
create index if not exists idx_stocksync_eventos_empresa on public.stocksync_eventos(empresa_id);
create index if not exists idx_stocksync_locacoes_empresa on public.stocksync_locacoes(empresa_id);
create index if not exists idx_stocksync_manutencoes_empresa on public.stocksync_manutencoes(empresa_id);
create index if not exists idx_stocksync_logs_empresa on public.stocksync_logs(empresa_id);

-- Triggers de updated_at
drop trigger if exists set_stocksync_empresas_updated_at on public.stocksync_empresas;
create trigger set_stocksync_empresas_updated_at before update on public.stocksync_empresas for each row execute function public.set_updated_at();
drop trigger if exists set_stocksync_funcionarios_updated_at on public.stocksync_funcionarios;
create trigger set_stocksync_funcionarios_updated_at before update on public.stocksync_funcionarios for each row execute function public.set_updated_at();
drop trigger if exists set_stocksync_solicitacoes_updated_at on public.stocksync_solicitacoes_funcionarios;
create trigger set_stocksync_solicitacoes_updated_at before update on public.stocksync_solicitacoes_funcionarios for each row execute function public.set_updated_at();
drop trigger if exists set_stocksync_equipamentos_updated_at on public.stocksync_equipamentos;
create trigger set_stocksync_equipamentos_updated_at before update on public.stocksync_equipamentos for each row execute function public.set_updated_at();
drop trigger if exists set_stocksync_eventos_updated_at on public.stocksync_eventos;
create trigger set_stocksync_eventos_updated_at before update on public.stocksync_eventos for each row execute function public.set_updated_at();
drop trigger if exists set_stocksync_evento_equipamentos_updated_at on public.stocksync_evento_equipamentos;
create trigger set_stocksync_evento_equipamentos_updated_at before update on public.stocksync_evento_equipamentos for each row execute function public.set_updated_at();
drop trigger if exists set_stocksync_locacoes_updated_at on public.stocksync_locacoes;
create trigger set_stocksync_locacoes_updated_at before update on public.stocksync_locacoes for each row execute function public.set_updated_at();
drop trigger if exists set_stocksync_locacao_equipamentos_updated_at on public.stocksync_locacao_equipamentos;
create trigger set_stocksync_locacao_equipamentos_updated_at before update on public.stocksync_locacao_equipamentos for each row execute function public.set_updated_at();
drop trigger if exists set_stocksync_manutencoes_updated_at on public.stocksync_manutencoes;
create trigger set_stocksync_manutencoes_updated_at before update on public.stocksync_manutencoes for each row execute function public.set_updated_at();
drop trigger if exists set_stocksync_logs_updated_at on public.stocksync_logs;
create trigger set_stocksync_logs_updated_at before update on public.stocksync_logs for each row execute function public.set_updated_at();

alter table public.app_storage enable row level security;
alter table public.stocksync_empresas enable row level security;
alter table public.stocksync_funcionarios enable row level security;
alter table public.stocksync_solicitacoes_funcionarios enable row level security;
alter table public.stocksync_equipamentos enable row level security;
alter table public.stocksync_eventos enable row level security;
alter table public.stocksync_evento_equipamentos enable row level security;
alter table public.stocksync_locacoes enable row level security;
alter table public.stocksync_locacao_equipamentos enable row level security;
alter table public.stocksync_manutencoes enable row level security;
alter table public.stocksync_logs enable row level security;

-- O frontend não acessa diretamente essas tabelas.
-- Somente as APIs da Vercel usam a service role key guardada em variável de ambiente.
revoke all on table public.app_storage from anon, authenticated;
revoke all on table public.stocksync_empresas from anon, authenticated;
revoke all on table public.stocksync_funcionarios from anon, authenticated;
revoke all on table public.stocksync_solicitacoes_funcionarios from anon, authenticated;
revoke all on table public.stocksync_equipamentos from anon, authenticated;
revoke all on table public.stocksync_eventos from anon, authenticated;
revoke all on table public.stocksync_evento_equipamentos from anon, authenticated;
revoke all on table public.stocksync_locacoes from anon, authenticated;
revoke all on table public.stocksync_locacao_equipamentos from anon, authenticated;
revoke all on table public.stocksync_manutencoes from anon, authenticated;
revoke all on table public.stocksync_logs from anon, authenticated;
