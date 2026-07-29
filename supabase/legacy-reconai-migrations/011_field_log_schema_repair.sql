-- Migration: 011_field_log_schema_repair
-- Compatibility repair for the shared War Room / ReconAI field_log schema.
--
-- 004_create_field_log.sql is the canonical create migration. This repair is
-- idempotent so fresh and partially migrated environments both expose the
-- columns shared/supabase-client.js reads and writes.

create table if not exists public.field_log (
  id         uuid primary key default gen_random_uuid()
);

alter table public.field_log add column if not exists client_id   text;
alter table public.field_log add column if not exists username    text;
alter table public.field_log add column if not exists league_id   text;
alter table public.field_log add column if not exists ts          bigint;
alter table public.field_log add column if not exists category    text default 'note';
alter table public.field_log add column if not exists action_type text;
alter table public.field_log add column if not exists players     jsonb;
alter table public.field_log add column if not exists context     text;
alter table public.field_log add column if not exists icon        text;
alter table public.field_log add column if not exists text        text;
alter table public.field_log add column if not exists source      text default 'scout';
alter table public.field_log add column if not exists created_at  timestamptz default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'field_log' and column_name = 'user_id'
  ) then
    alter table public.field_log alter column user_id drop not null;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'field_log' and column_name = 'event_type'
  ) then
    alter table public.field_log alter column event_type drop not null;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'field_log' and column_name = 'league_id'
  ) then
    alter table public.field_log alter column league_id drop not null;
  end if;
end $$;

drop policy if exists field_log_select on public.field_log;
drop policy if exists field_log_insert on public.field_log;
drop policy if exists field_log_delete on public.field_log;
alter table public.field_log disable row level security;

update public.field_log
set client_id = coalesce(client_id, id::text)
where client_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'field_log_client_id_key'
      and conrelid = 'public.field_log'::regclass
  ) then
    alter table public.field_log add constraint field_log_client_id_key unique (client_id);
  end if;
end $$;

create index if not exists field_log_username_ts_idx
  on public.field_log(username, ts desc);

create index if not exists field_log_league_ts_idx
  on public.field_log(username, league_id, ts desc);
