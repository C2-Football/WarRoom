-- Migration: 013_player_tags_policy_repair
-- Allows the app-issued Supabase session token to sync player tags.
--
-- get-session-token signs users with role='anon' and stores the Sleeper username
-- in app_metadata.sleeper_username. The prior player_tags policy was scoped to
-- role authenticated, so valid app sessions could not write tags.

create table if not exists public.player_tags (
  id         uuid primary key default gen_random_uuid(),
  username   text not null references public.users(sleeper_username) on delete cascade,
  league_id  text not null,
  tags       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'player_tags_username_league_key'
      and conrelid = 'public.player_tags'::regclass
  ) then
    alter table public.player_tags add constraint player_tags_username_league_key unique (username, league_id);
  end if;
end $$;

create index if not exists player_tags_username_league_idx
  on public.player_tags(username, league_id);

alter table public.player_tags enable row level security;

drop policy if exists player_tags_own on public.player_tags;
drop policy if exists "player_tags_own" on public.player_tags;

create policy player_tags_own
  on public.player_tags for all
  to public
  using (
    username = coalesce(
      auth.jwt() -> 'app_metadata' ->> 'sleeper_username',
      auth.jwt() ->> 'sleeper_username',
      auth.jwt() ->> 'sub'
    )
  )
  with check (
    username = coalesce(
      auth.jwt() -> 'app_metadata' ->> 'sleeper_username',
      auth.jwt() ->> 'sleeper_username',
      auth.jwt() ->> 'sub'
    )
  );
