-- Canonicalize public.field_log for Scout + War Room shared sync.
--
-- This is intentionally additive. Some environments may already have the
-- canonical username/client_id schema, while others may have picked up the
-- older user_id/event_type draft migration. The app only requires the columns
-- below and a unique client_id for idempotent upserts.

alter table if exists public.field_log
  add column if not exists client_id text,
  add column if not exists username text,
  add column if not exists ts bigint,
  add column if not exists category text default 'note',
  add column if not exists action_type text,
  add column if not exists players jsonb,
  add column if not exists context text,
  add column if not exists icon text default '📋',
  add column if not exists text text,
  add column if not exists source text default 'scout',
  add column if not exists created_at timestamptz default now();

create unique index if not exists field_log_client_id_uidx
  on public.field_log(client_id)
  where client_id is not null;

create index if not exists field_log_username_ts_idx
  on public.field_log(username, ts desc);

alter table if exists public.field_log enable row level security;

drop policy if exists field_log_select on public.field_log;
drop policy if exists field_log_insert on public.field_log;
drop policy if exists field_log_delete on public.field_log;
drop policy if exists "field_log_select_own" on public.field_log;
drop policy if exists "field_log_insert_own" on public.field_log;
drop policy if exists "field_log_update_own" on public.field_log;
drop policy if exists "field_log_delete_own" on public.field_log;

create policy "field_log_select_own"
  on public.field_log for select
  using (
    username = coalesce(
      auth.jwt() -> 'app_metadata' ->> 'sleeper_username',
      auth.jwt() ->> 'sub'
    )
  );

create policy "field_log_insert_own"
  on public.field_log for insert
  with check (
    username = coalesce(
      auth.jwt() -> 'app_metadata' ->> 'sleeper_username',
      auth.jwt() ->> 'sub'
    )
  );

create policy "field_log_update_own"
  on public.field_log for update
  using (
    username = coalesce(
      auth.jwt() -> 'app_metadata' ->> 'sleeper_username',
      auth.jwt() ->> 'sub'
    )
  )
  with check (
    username = coalesce(
      auth.jwt() -> 'app_metadata' ->> 'sleeper_username',
      auth.jwt() ->> 'sub'
    )
  );

create policy "field_log_delete_own"
  on public.field_log for delete
  using (
    username = coalesce(
      auth.jwt() -> 'app_metadata' ->> 'sleeper_username',
      auth.jwt() ->> 'sub'
    )
  );
