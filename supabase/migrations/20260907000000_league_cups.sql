create table if not exists public.league_cups (
 league_id text not null,
 season text not null,
 state jsonb not null,
 revision integer not null default 1,
 updated_by text not null,
 updated_at timestamptz not null default now(),
 primary key (league_id,season)
);
alter table public.league_cups enable row level security;
revoke all on public.league_cups from anon, authenticated;
grant all on public.league_cups to service_role;
