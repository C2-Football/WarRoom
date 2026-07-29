-- ══════════════════════════════════════════════════════════════════
-- 004_create_field_log.sql
-- Creates the field_log table used by War Room Scout and War Room.
--
-- Context: field_log stores the GM's in-app note/activity log. Entries
-- are written locally first and synced to Supabase for persistence
-- across devices. Both apps read/write via shared/supabase-client.js.
--
-- IMPORTANT: Run migrations in order. This depends on:
--   001_ai_rate_limits.sql     — no deps
--   002_add_tier_column.sql    — adds tier to users
--   003_rename_tier_reconai_to_scout.sql — renames reconai→scout tier
--   004_create_field_log.sql   ← this file
--
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.field_log (
  id         uuid        primary key default gen_random_uuid(),
  client_id  text        unique,
  username   text        not null references public.users(sleeper_username) on delete cascade,
  league_id  text,
  ts         bigint      not null,
  category   text        not null default 'note',
  action_type text,
  players    jsonb,
  context    text,
  icon       text        default '📋',
  text       text        not null,
  source     text        default 'scout',
  created_at timestamptz default now()
);

create index if not exists field_log_username_ts_idx
  on public.field_log(username, ts desc);
