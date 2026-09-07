create table if not exists public.cup_honours (
 league_root text not null,
 season text not null,
 result jsonb not null,
 revision integer not null default 1,
 updated_by text not null,
 updated_at timestamptz not null default now(),
 primary key (league_root,season)
);
alter table public.cup_honours enable row level security;
revoke all on public.cup_honours from anon,authenticated;
grant all on public.cup_honours to service_role;
