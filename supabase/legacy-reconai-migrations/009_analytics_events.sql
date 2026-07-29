-- Product analytics event stream shared by ReconAI Scout and War Room.
-- Tracks product behavior only: module/widget/player/action events. Do not store
-- raw chat prompt text or private league document content in metadata.

create table if not exists public.analytics_events (
  event_id text primary key,
  username text,
  user_id uuid,
  league_id text,
  session_id text not null,
  platform text not null,
  module text,
  widget text,
  event_name text not null,
  event_ts timestamptz not null default now(),
  duration_ms integer,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_username_ts_idx
  on public.analytics_events (username, event_ts desc);

create index if not exists analytics_events_league_ts_idx
  on public.analytics_events (league_id, event_ts desc);

create index if not exists analytics_events_name_ts_idx
  on public.analytics_events (event_name, event_ts desc);

create index if not exists analytics_events_session_ts_idx
  on public.analytics_events (session_id, event_ts desc);

alter table public.analytics_events disable row level security;
