-- nfl_week_context — shared server-side cache for the ESPN NFL scoreboard
-- (schedule + odds + weather), written and read ONLY by the nfl-scoreboard
-- edge function via the service role. One row per (season, seasontype, week);
-- payload is the raw ESPN response, parsed client-side by nfl-context.js.
--
-- Idempotent by design: the deploy workflow's query endpoint is not atomic
-- across statements, so every statement must be safe to re-run.

create table if not exists public.nfl_week_context (
  season     integer     not null,
  seasontype integer     not null default 2,
  week       integer     not null,
  payload    jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (season, seasontype, week)
);

-- Service-role only: RLS on with no policies means anon/authenticated get
-- nothing; the edge function's service key bypasses RLS. Clients never touch
-- this table directly.
alter table public.nfl_week_context enable row level security;

revoke all on public.nfl_week_context from anon, authenticated;
