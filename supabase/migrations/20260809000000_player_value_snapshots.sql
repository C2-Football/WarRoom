-- Per-player DHQ value history.
--
-- Values today are always computed live from current inputs — there is no
-- record of what a player was worth on a past draft/trade date, so trade
-- grading (tradeHistory in dhq-engine.js) silently re-prices every historical
-- trade at TODAY's market. This table freezes a value the moment it's
-- computed (draft pick, trade discovery, or a periodic per-league-open
-- capture) so later reads can show genuine movement over time instead of
-- recomputing history.
--
-- One row per (league, player, season, week, source): 'source' distinguishes
-- an event-triggered snapshot (draft/trade, frozen at that moment) from a
-- periodic capture (best-effort, only happens for weeks someone opened the
-- league in the app — there is no server-side cron in this project).
--
-- IDENTITY: follows the dual-identity model from
-- legacy-reconai-migrations/020_account_identity_rekey.sql — legacy Sleeper
-- sessions stamp `username` (from app_metadata.sleeper_username), account
-- sessions stamp `user_id` (from public.current_app_user_id()), exactly one
-- set per row, enforced by two separate INSERT policies.
--
-- RLS is widen-read / narrow-write: unlike the single-owner tables that
-- pattern is drawn from, a value snapshot is shared league data (the same
-- number regardless of who computed it), not private per-user data, and
-- there's no league-membership table to scope reads against — so SELECT is
-- open to any authenticated principal (legacy or account), while INSERT
-- still requires writing as yourself.
--
-- Idempotent / safe to re-run (applied via the Management API allowlist).

create table if not exists public.player_value_snapshots (
    id          uuid primary key default gen_random_uuid(),
    league_id   text not null,
    player_id   text not null,
    season      integer not null,
    week        integer not null,
    ts          timestamptz not null default now(),
    value       numeric not null,
    value_type  text not null check (value_type in ('dynasty', 'redraft')),
    source      text not null check (source in ('draft', 'trade', 'periodic')),
    context     jsonb default '{}'::jsonb,   -- e.g. {trade_key} or {pick_slot}
    username    text,                        -- legacy Sleeper-session writer
    user_id     uuid references public.app_users(id) on delete cascade,
    created_at  timestamptz not null default now(),
    unique (league_id, player_id, season, week, source)
);

create index if not exists idx_player_value_snapshots_league_player
    on public.player_value_snapshots (league_id, player_id, season, week);

alter table public.player_value_snapshots enable row level security;

drop policy if exists "player_value_snapshots_read" on public.player_value_snapshots;
drop policy if exists "player_value_snapshots_legacy_write" on public.player_value_snapshots;
drop policy if exists "player_value_snapshots_account_write" on public.player_value_snapshots;

create policy "player_value_snapshots_read" on public.player_value_snapshots
    for select
    using (
        (auth.jwt() -> 'app_metadata' ->> 'sleeper_username') is not null
        or public.current_app_user_id() is not null
    );

create policy "player_value_snapshots_legacy_write" on public.player_value_snapshots
    for insert
    with check (
        username = (auth.jwt() -> 'app_metadata' ->> 'sleeper_username')
        and username is not null
        and user_id is null
    );

create policy "player_value_snapshots_account_write" on public.player_value_snapshots
    for insert
    with check (
        user_id is not null
        and user_id = public.current_app_user_id()
        and username is null
    );

grant select, insert on table public.player_value_snapshots to authenticated, anon;
