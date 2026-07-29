-- ══════════════════════════════════════════════════════════════════
-- 007_gm_strategy.sql
-- Cross-app GM strategy sync — shared between War Room Scout and War Room.
--
-- Context: the "GM strategy" object (mode, aggression, target positions,
-- sell rules, untouchables, etc.) used to live only in localStorage under
-- `dhq_gm_strategy_v1`. That meant Scout (mobile PWA) and War Room
-- (desktop) on different subdomains had disjoint strategies and edits
-- in one never reached the other.
--
-- This table holds one row per user. Both apps call the same
-- window.OD.saveStrategy / loadStrategy helpers (defined in
-- shared/supabase-client.js) and reconcile on boot + window focus via
-- shared/strategy.js:syncFromRemote(). Last-writer-wins by version.
--
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
-- Depends on: 001_ai_rate_limits.sql (creates public.users)
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.gm_strategy (
  username         text        primary key references public.users(sleeper_username) on delete cascade,
  strategy         jsonb       not null,
  version          int         not null default 1,    -- monotonic counter from the client
  last_synced_at   bigint      not null,              -- client Date.now() of the write
  last_synced_from text        default 'scout',       -- 'scout' | 'warroom'
  updated_at       timestamptz default now()
);

create index if not exists gm_strategy_updated_at_idx
  on public.gm_strategy(updated_at desc);

alter table public.gm_strategy enable row level security;

drop policy if exists "Users read own strategy"   on public.gm_strategy;
drop policy if exists "Users insert own strategy" on public.gm_strategy;
drop policy if exists "Users update own strategy" on public.gm_strategy;

create policy "Users read own strategy"
  on public.gm_strategy for select
  using (username = current_setting('request.jwt.claims', true)::json->>'sub');

create policy "Users insert own strategy"
  on public.gm_strategy for insert
  with check (username = current_setting('request.jwt.claims', true)::json->>'sub');

create policy "Users update own strategy"
  on public.gm_strategy for update
  using (username = current_setting('request.jwt.claims', true)::json->>'sub')
  with check (username = current_setting('request.jwt.claims', true)::json->>'sub');
