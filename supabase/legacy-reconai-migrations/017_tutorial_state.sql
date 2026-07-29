-- Cross-app assistant tutorial completion state for legacy Sleeper profiles.
-- App-account profile state is owned by the War Room app_users migration.

alter table if exists public.users
  add column if not exists tutorial_state jsonb not null default '{}'::jsonb;

do $$
begin
  if to_regclass('public.users') is not null and not exists (
    select 1
    from pg_constraint
    where conname = 'users_tutorial_state_object'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_tutorial_state_object
      check (jsonb_typeof(tutorial_state) = 'object');
  end if;
end $$;
