# StockSync - deploy estavel

Arquitetura atual:

- GitHub: codigo.
- Vercel: frontend estatico + funcoes `/api`.
- Supabase: banco PostgreSQL real.
- Render/Railway: nao necessario para producao.

## 1. Criar banco no Supabase

No Supabase, abra `SQL Editor` e execute:

```text
supabase-schema.sql
```

Isso cria a tabela:

```text
public.app_storage
```

## 2. Variaveis na Vercel

Configure no projeto da Vercel:

```text
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY
ALLOWED_ORIGIN=https://SEU-DOMINIO.vercel.app
```

Importante: `SUPABASE_SERVICE_ROLE_KEY` fica somente na Vercel. Nunca coloque essa chave no frontend.

## 3. Migrar dados antigos do JSON

Se existir `data/stocksync-db.json`, rode localmente:

```bash
set SUPABASE_URL=https://SEU-PROJETO.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY
npm run migrate:supabase
```

## 4. Deploy

Suba o projeto para o GitHub e conecte o repositorio na Vercel.

Configuração:

```text
Framework Preset: Other
Build Command: vazio
Output Directory: vazio
Install Command: npm install
```

A Vercel vai publicar os HTML/CSS/JS e as funcoes da pasta `api`.

## 5. Testes rapidos

Depois do deploy, abra:

```text
https://SEU-DOMINIO.vercel.app/api/health
```

Deve retornar:

```json
{ "ok": true, "database": "supabase-postgres" }
```

Depois teste no sistema:

- criar empresa;
- fazer login;
- cadastrar equipamento;
- criar evento;
- enviar item para manutencao;
- atualizar a pagina e confirmar que os dados continuam.
